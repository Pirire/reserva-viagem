// src/server.js
import { createServer } from "http";
import { Server as SocketIO } from "socket.io";
import cron from "node-cron";
import dotenv from "dotenv";
dotenv.config();

import logger from "./config/logger.js";

import { connectDB } from "./config/db.js";
import { closeWeekSnapshot, closeMonthSnapshot } from "./modules/faturacao/financeSnapshot.service.js";
import { runExpiryNotifications } from "./services/expiryNotifier.service.js";
import { refreshRegioes } from "./services/regiaoSeguranca.service.js";
import { processarPagamentosSemanais } from "./services/pagamentosGestores.service.js";
import { verificarConvitesVencidos } from "./services/expirarConvitesVencidos.service.js";
import { verificarAvisosUrgentes } from "./services/avisarConvitesUrgentes.service.js";
import { registerDispatchEvents } from "./modules/dispatch/dispatch.events.js";

import * as appModule from "./app.js";
const app = appModule.default ?? appModule.app;

if (!app || typeof app.listen !== "function") {
  logger.fatal("❌ app.js não exporta uma aplicação Express válida.");
  process.exit(1);
}

const PORT = Number(process.env.PORT || 10000);
const TZ = "Europe/Lisbon";

let server;
let io;

async function start() {
  await connectDB();
  await refreshRegioes();

  // ─────────────────────────────────────────────
  // CRONS
  // ─────────────────────────────────────────────

  cron.schedule("0 9 * * *", async () => {
    try {
      await runExpiryNotifications(new Date());
    } catch (err) {
      logger.error({ err }, "Erro expiry notifications");
    }
  }, { timezone: TZ });

  // Vencimento de convites (Evento/Ticket com prazo de confirmação,
  // ex: "regresso às 00:00, válido até às 04:00") — verificado a
  // cada 5 minutos: avisa 1h antes do prazo, e cancela+reembolsa
  // automaticamente quem não confirmou a tempo. `io` é capturado por
  // referência (let, definido mais abaixo) — seguro porque o cron só
  // dispara depois do servidor estar totalmente arrancado.
  cron.schedule("*/5 * * * *", async () => {
    try {
      await verificarConvitesVencidos(io);
    } catch (err) {
      logger.error({ err }, "Erro ao verificar convites vencidos");
    }
  }, { timezone: TZ });

  // Avisos urgentes de Reserva Flexível — corre a cada minuto porque
  // as janelas de disparo (60±5 min e 15±5 min antes da validade)
  // são estreitas. Se corresse a cada 5 min, no pior caso o aviso
  // podia sair 5 min tarde — o de 15 min já ficaria em cima da hora.
  cron.schedule("* * * * *", async () => {
    try {
      await verificarAvisosUrgentes();
    } catch (err) {
      logger.error({ err }, "Erro ao verificar avisos urgentes");
    }
  }, { timezone: TZ });

  cron.schedule("0 10 * * 1", async () => {
    try {
      await processarPagamentosSemanais();
    } catch (err) {
      logger.error({ err }, "Erro pagamentos semanais");
    }
  }, { timezone: TZ });

  cron.schedule("5 0 * * 1", async () => {
    try {
      await closeWeekSnapshot(new Date());
    } catch (err) {
      logger.error({ err }, "Erro fecho semana");
    }
  }, { timezone: TZ });

  cron.schedule("55 23 28-31 * *", async () => {
    const hoje = new Date();
    const amanha = new Date(hoje);
    amanha.setDate(hoje.getDate() + 1);

    if (amanha.getMonth() !== hoje.getMonth()) {
      try {
        await closeMonthSnapshot(hoje);
      } catch (err) {
        logger.error({ err }, "Erro fecho mês");
      }
    }
  }, { timezone: TZ });

  // ─────────────────────────────────────────────
  // HTTP + SOCKET
  // ─────────────────────────────────────────────

  const httpServer = createServer(app);

  io = new SocketIO(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    pingTimeout: 20000,
    pingInterval: 15000,
  });

  // tornar socket global
  app.set("io", io);

  // ─────────────────────────────────────────────
  // MOTOR DE DESPACHO — aceitar/rejeitar oferta, entrar na sala da
  // viagem. Tinha uma versão "base" mais simples registada aqui
  // directamente (mais abaixo), que NUNCA chamava esta função —
  // dispatch.events.js (a versão completa: bloqueio da
  // DispatchSession contra aceitação em duplicado, gravação do
  // motorista na própria Trip, evento "dispatch_accepted") ficava
  // como código morto, nunca corria. Registada ANTES do
  // io.on("connection") principal para não ficar aninhada lá dentro.
  // ─────────────────────────────────────────────
  registerDispatchEvents(io);

  // ─────────────────────────────────────────────
  // SOCKET EVENTS
  // ─────────────────────────────────────────────

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "Socket conectado");

    // motorista entra na sala dele
    socket.on("driver_join", ({ driverId }) => {
      if (driverId) {
        socket.join(`driver_${driverId}`);
      }
    });

    // organizador entra na sala da sua partilha — para receber em
    // tempo real avisos de pagamento falhado, recálculo, finalização
    // (ver partilha.routes.js / rm-share.js).
    socket.on("share_join", ({ shareId }) => {
      if (shareId) socket.join(`share_${shareId}`);
    });

    // operador de segurança entra na sala "seguranca" — sem isto,
    // io.to('seguranca').emit(...) (alertas, imagens, posições) não
    // chega a ninguém (ver tracking.routes.js).
    socket.on("entrar_seguranca", () => {
      socket.join("seguranca");
    });

    // cliente entra na viagem
    socket.on("trip_join", ({ tripId }) => {
      if (tripId) {
        socket.join(`trip_${tripId}`);
      }
    });

    // motorista sai da sala da viagem (concluída/cancelada) — deixa
    // de fazer sentido continuar a reencaminhar driver_location.
    socket.on("trip_leave", ({ tripId }) => {
      if (tripId) {
        socket.leave(`trip_${tripId}`);
      }
    });

    // LOCALIZAÇÃO DO MOTORISTA EM TEMPO REAL
    // Substitui o polling HTTP a cada 6s do lado do utilizador —
    // o motorista emite a sua posição assim que o GPS actualiza
    // (motorista.html, watchPosition), o servidor reencaminha
    // imediatamente para todos os clientes na sala da viagem
    // (trip_${tripId}), que já estão à escuta de "driver_location"
    // desde que entraram com trip_join. Sem isto, cada actualização
    // de posição só chegaria ao utilizador no próximo ciclo de
    // polling (até 6s de atraso); com socket, chega no instante em
    // que é emitida.
    socket.on("driver_location", ({ tripId, driverId, lat, lng, accuracy, speed, heading, eta }) => {
      if (!tripId || lat == null || lng == null) return;
      io.to(`trip_${tripId}`).emit("driver_location", {
        tripId, driverId, lat, lng, accuracy, speed, heading, eta,
        ts: Date.now(),
      });
    });

    // ACEITAR / REJEITAR VIAGEM — tratado por registerDispatchEvents()
    // acima (dispatch.events.js), que faz o bloqueio correcto contra
    // aceitação em duplicado e grava o motorista na Trip. As versões
    // "base" que estavam aqui (só reenviavam um evento sem gravar
    // nada) foram removidas — estavam a competir em silêncio com a
    // versão completa, sem nunca ganhar (a completa nunca corria,
    // por não estar ligada), mas na mesma a confundir qualquer
    // depuração futura por haver dois handlers para o mesmo evento.

    socket.on("disconnect", () => {
      logger.info({ socketId: socket.id }, "Socket desconectado");
    });
  });

  // ─────────────────────────────────────────────
  // START SERVER
  // ─────────────────────────────────────────────

  server = httpServer.listen(PORT, () => {
    logger.info(`🚀 Backend a correr em http://localhost:${PORT}`);
    logger.info(`🔌 Socket.io ativo`);
  });
}

// shutdown seguro
process.on("SIGTERM", () => {
  if (!server) return process.exit(0);

  server.close(() => {
    process.exit(0);
  });
});

start().catch((err) => {
  logger.fatal({ err }, "Erro crítico no servidor");
  process.exit(1);
});