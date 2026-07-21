// src/routes/reservas.routes.js
// ══════════════════════════════════════════════════════════════
// SUBSTITUIR o ficheiro existente.
// Mantém TODOS os endpoints existentes.
// ADICIONA: chamada ao dispatch após pagamento confirmado.
// ══════════════════════════════════════════════════════════════

import { Router } from "express";
import mongoose from "mongoose";
import jwt         from "jsonwebtoken";
import Reserva          from "../models/Reserva.js";
import Trip              from "../models/Trip.js";
import Motorista         from "../models/Motorista.js";
import Veiculo           from "../models/Veiculo.js";
import AdminQuoteConfig from "../models/AdminQuoteConfig.js";
import logger           from "../config/logger.js";
import { liberarPar } from "../services/dispatch.service.js";
import { criarEDespacharViagem } from "../services/criarEDespacharViagem.service.js";
import { notificarConvite } from "../services/notificarConvite.service.js";
import { emitirFaturaAutomatica }       from "../services/frota-faturacao.service.js";
import { getClientePayload, injetarCliente, requireCliente } from "../utils/clienteAuth.js";

let _stripe = null;
async function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    const Stripe = (await import("stripe")).default;
    _stripe = new Stripe(key, { apiVersion: "2023-10-16" });
    logger.info("✅ Stripe inicializado");
  } catch (e) {
    logger.error({ err: e }, "❌ Falha ao inicializar Stripe");
  }
  return _stripe;
}

const router = Router();

/* ── Auth helpers — movidos para src/utils/clienteAuth.js, para
   ficarem partilhados com partilha.routes.js (e qualquer outro
   ficheiro que precise), em vez de viverem só aqui, duplicados
   cada vez que outro ficheiro precisasse do mesmo. ── */

/* ── Endpoints inalterados ──────────────────────────────────── */
router.get("/paypal-client-id", (_req, res) =>
  res.json({ clientId: process.env.PAYPAL_CLIENT_ID || "" })
);

router.post("/obter-valores", async (_req, res) => {
  try {
    const FALLBACK = { economica: 0.85, confort: 1.05, executive: 1.35, luxury: 1.75 };
    let valores = { ...FALLBACK, grupo: { 6: 1.20, 8: 1.35, 17: 1.60 } };
    const cfg = await AdminQuoteConfig.findOne({ key: "default" }).lean();
    if (cfg?.precoKm) {
      const km = cfg.precoKm;
      valores = {
        economica: Number(km.Economica || km.economica || FALLBACK.economica),
        confort:   Number(km.Confort   || km.confort   || FALLBACK.confort),
        executive: Number(km.Executive || km.executive || FALLBACK.executive),
        luxury:    Number(km.Luxury    || km.luxury    || FALLBACK.luxury),
        grupo:     { 6: 1.20, 8: 1.35, 17: 1.60 },
      };
    }
    return res.json({ success: true, valores });
  } catch (err) {
    logger.error({ err }, "❌ /obter-valores");
    return res.status(500).json({ success: false, message: "Erro ao obter valores." });
  }
});

router.post("/reserva", injetarCliente, async (req, res) => {
  try {
    const {
      nome, email, categoria, partida, destino, datahora,
      valor, portagens, km, contato, contacto,
      codigo, observacoes, origemGeo, destinoGeo, extras,
    } = req.body || {};

    if (!nome || !email || !categoria || !partida || !destino || !datahora || !codigo) {
      return res.status(400).json({
        ok: false, success: false, code: "MISSING_FIELDS",
        message: "Campos obrigatórios: nome, email, categoria, partida, destino, datahora, codigo.",
      });
    }

    const codigoNorm = String(codigo).trim().toUpperCase();
    const existe = await Reserva.findOne({ codigo: codigoNorm }).lean();
    if (existe) return res.status(409).json({ ok: false, success: false, code: "DUPLICATE_CODE", message: "Código já existe." });

    const nova = await Reserva.create({
      codigo:      codigoNorm,
      canal:       req.clienteId ? "cliente" : "publico",
      clienteId:   req.clienteId  || null,
      nome:        String(nome).trim(),
      email:       String(email).toLowerCase().trim(),
      contacto:    String(contacto || contato || "").trim(),
      categoria:   String(categoria).trim(),
      partida:     String(partida).trim(),
      destino:     String(destino).trim(),
      origemGeo:   origemGeo  || null,
      destinoGeo:  destinoGeo || null,
      datahora:    new Date(datahora),
      valor:       Number(valor    || 0),
      observacoes: String(observacoes || ""),
      extras: {
        ...(extras || {}),
        portagens: Number(portagens || 0),
        km:        Number(km        || 0),
      },
      status:   "pendente",
      pagamento: { provider: "nenhum", status: "nenhum" },
    });

    logger.info({ codigo: codigoNorm, clienteId: req.clienteId }, "✅ Reserva criada");
    return res.json({ ok: true, success: true, reserva: nova });
  } catch (err) {
    logger.error({ err }, "❌ /reserva POST");
    return res.status(500).json({ ok: false, success: false, message: "Erro ao criar reserva." });
  }
});

function getPublicBaseUrl() {
  const a = String(process.env.PUBLIC_BASE_URL || "").trim();
  if (a) return a.replace(/\/+$/, "");
  const b = String(process.env.FRONTEND_URL || "").trim();
  if (b) return b.replace(/\/+$/, "");
  return "http://localhost:10000";
}

/* ── Tempo estimado de chegada (ETA) do motorista até ao ponto de
   recolha — calculado a sério via OSRM (a mesma rota, mesmo motor
   que já desenha os mapas em todo o sistema), não um valor fixo
   nem um campo que nunca é preenchido. Chamado a cada vez que o
   cliente pergunta "já tenho motorista?" (polling a cada 5s nos
   três ecrãs — reserva.html, minha-conta.html, estou-pronto.html),
   dando uma estimativa sempre actualizada, quase em tempo real,
   sem precisar de nenhuma ligação de socket nova. Devolve minutos
   (arredondado) ou null se não for possível calcular. ── */
async function calcularEtaMinutos(motoristaLat, motoristaLng, destinoLat, destinoLng) {
  if (motoristaLat == null || motoristaLng == null || destinoLat == null || destinoLng == null) {
    return null;
  }
  try {
    const r = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${motoristaLng},${motoristaLat};${destinoLng},${destinoLat}?overview=false`
    );
    const d = await r.json();
    if (d?.routes?.[0]?.duration != null) {
      return Math.max(1, Math.round(d.routes[0].duration / 60));
    }
  } catch (err) {
    logger.warn({ err: err?.message }, "⚠️ calcularEtaMinutos: OSRM falhou");
  }
  return null;
}

/* ── Marca a reserva como paga e envia a confirmação (SMS+email).
   Extraído para função partilhada porque o frontend real usa DOIS
   nomes de rota diferentes para o mesmo efeito (ver nota abaixo) —
   sem isto, ficaríamos com a mesma lógica duplicada duas vezes,
   arriscando desalinhar uma da outra no futuro. ── */
async function marcarPagaEEnviarConfirmacao(reserva, { provider, paymentIntentId } = {}) {
  // Atómico — o frontend chama esta acção por DOIS caminhos
  // diferentes para o mesmo pagamento (confirmar-pagamento E
  // enviar-confirmacao), quase ao mesmo tempo (1ms de diferença,
  // visto nos logs). Uma verificação "ler o estado, depois decidir"
  // não chega — as duas chamadas podiam ler o estado ANTES de
  // qualquer uma gravar. findOneAndUpdate com a condição "ainda não
  // estava paga" é atómico a nível da base de dados: só uma das
  // duas chamadas ganha a corrida; a outra recebe null e sai sem
  // reenviar nada.
  const atualizada = await Reserva.findOneAndUpdate(
    { _id: reserva._id, "pagamento.status": { $ne: "pago" } },
    {
      $set: {
        pagamento: {
          provider:        provider || "stripe",
          status:          "pago",
          paymentIntentId: paymentIntentId || null,
          pagoEm:          new Date(),
        },
        status: "confirmada",
      },
    },
    { new: true }
  );

  if (!atualizada) {
    logger.info({ codigo: reserva.codigo }, "↩️ Confirmação já enviada antes — ignorado (evita duplicado)");
    return;
  }
  reserva = atualizada;

  // Best effort — não bloqueia quem chamou.
  try {
    const dataFmt = reserva.datahora
      ? new Date(reserva.datahora).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
      : "—";
    // Link real, clicável, sem login — identificado só pelo código
    // (mesmo princípio dos convites/eventos, sem precisar de conta).
    // Sem isto, o SMS/email dizia "toque para chamar" sem nada para
    // tocar — só quem estivesse fisicamente à frente do computador
    // do hotel via o botão no ecrã, o que não serve ao hóspede.
    const linkPronto = `${getPublicBaseUrl()}/estou-pronto.html?codigo=${encodeURIComponent(reserva.codigo)}`;
    // Nome pode vir em falta (reserva antiga, ou campo deixado em
    // branco no formulário) — nesse caso a saudação cai para "Olá!"
    // em vez de deixar um espaço em branco estranho ("Olá !").
    const primeiroNome = String(reserva.nome || "").trim().split(/\s+/)[0] || "";
    const saudacao = primeiroNome ? `Olá ${primeiroNome}` : "Olá";
    const smsBody =
      `De Realmetropolis.\n${saudacao}, o seu pagamento foi confirmado!\n` +
      `Previsto para: ${dataFmt}\n` +
      `Quando estiver pronto, toque no link abaixo para que enviaremos o seu motorista:\n${linkPronto}`;
    const emailHtml = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;background:#f5f5f5;color:#222">
      <div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,.06)">
        <p style="margin:0 0 4px;font-size:12px;color:#888;text-align:center">De Realmetropolis</p>
        <h2 style="margin:0 0 12px;font-size:20px;color:#050507;text-align:center">${saudacao} ✅</h2>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.5;text-align:center">O seu pagamento foi confirmado.</p>

        <div style="background:#050507;border-radius:10px;padding:22px 24px;text-align:center">
          <div style="font-size:10px;font-weight:900;letter-spacing:.32em;color:#8b95a2;margin-bottom:6px">RESERVA</div>
          <div style="font-size:12px;color:#8b95a2;margin-bottom:14px">Previsto para</div>
          <div style="font-size:24px;font-weight:800;color:#f4f6f8;margin-bottom:20px">${dataFmt}</div>

          <a href="${linkPronto}" style="display:block;padding:14px;background:#c4c9d4;color:#0a0a0b;font-weight:800;font-size:14px;border-radius:10px;text-decoration:none;letter-spacing:.02em;margin-bottom:20px">
            CHAMAR O MEU MOTORISTA
          </a>

          <p style="margin:0;padding-top:16px;border-top:1px solid rgba(196,201,212,.15);font-size:11px;color:#8b95a2;line-height:1.6">
            Toque no botão acima quando estiver pronto para ser recolhido.
          </p>

          <p style="margin:14px 0 0;font-size:10px;color:#6b7280;word-break:break-all;line-height:1.5">
            Ou copie este link: ${linkPronto}
          </p>
        </div>

        <div style="background:#f7f7f8;border-radius:10px;padding:16px;font-size:13px;line-height:1.8;margin-top:16px">
          <div><b>De:</b> ${reserva.partida}</div>
          <div><b>Para:</b> ${reserva.destino}</div>
          <div><b>Código:</b> ${reserva.codigo}</div>
        </div>
      </div>
      <p style="text-align:center;color:#888;font-size:11px;margin-top:20px">REALMETROPOLIS &copy; ${new Date().getFullYear()}</p>
    </body></html>`;

    const nRes = await notificarConvite({
      metodo: "ambos",
      contacto: reserva.contacto || "",
      email:    reserva.email    || null,
      smsBody,
      emailSubject: "Pagamento confirmado — REALMETROPOLIS",
      emailHtml,
    });
    logger.info({ codigo: reserva.codigo, sms: nRes?.smsEnviado, email: nRes?.emailEnviado }, "📩 Confirmação de reserva enviada");
  } catch (errN) {
    logger.error({ err: errN, codigo: reserva.codigo }, "⚠️ Falha ao enviar confirmação de reserva");
  }
}

/* ══════════════════════════════════════════════════════════════
   POST /api/reservas/confirmar-pagamento
   Body: { codigo, provider, paymentIntentId? }
══════════════════════════════════════════════════════════════ */
router.post("/reservas/confirmar-pagamento", async (req, res) => {
  try {
    const { codigo, provider, paymentIntentId } = req.body || {};
    if (!codigo) return res.status(400).json({ ok: false, message: "codigo obrigatório." });

    const reserva = await Reserva.findOne({ codigo: String(codigo).trim().toUpperCase() });
    if (!reserva) return res.status(404).json({ ok: false, message: "Reserva não encontrada." });

    await marcarPagaEEnviarConfirmacao(reserva, { provider, paymentIntentId });

    return res.json({ ok: true, message: "Pagamento confirmado. Toque em \"Estou Pronto\" quando quiser chamar o motorista." });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/confirmar-pagamento");
    return res.status(500).json({ ok: false, message: "Erro ao confirmar pagamento." });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/reservas/reservas/enviar-confirmacao
   POST /api/reservas/enviar-confirmacao
   IMPORTANTE: existem DOIS frontends diferentes a chamar esta mesma
   acção, com convenções de caminho diferentes — hotel-dashboard.html
   (via js/rm-payment.js) chama a versão com "reservas" duplicado;
   minha-conta.html (que tem a sua própria cópia interna do módulo
   de pagamento, não usa o rm-payment.js externo) chama a versão
   simples. Registada nos dois sítios para cobrir ambos, em vez de
   escolher um e deixar o outro a dar 404 em silêncio — foi
   exactamente isso (o 404 nunca visto, engolido por um catch vazio
   no frontend) que fez esta funcionalidade parecer "pronta" sem
   nunca ter corrido.

   Body: { codigo, emailPassageiro }
══════════════════════════════════════════════════════════════ */
async function handlerEnviarConfirmacao(req, res) {
  try {
    const { codigo } = req.body || {};
    if (!codigo) return res.status(400).json({ ok: false, message: "codigo obrigatório." });

    const reserva = await Reserva.findOne({ codigo: String(codigo).trim().toUpperCase() });
    if (!reserva) return res.status(404).json({ ok: false, message: "Reserva não encontrada." });

    await marcarPagaEEnviarConfirmacao(reserva, {});

    return res.json({ ok: true, message: "Confirmação enviada." });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/enviar-confirmacao");
    return res.status(500).json({ ok: false, message: "Erro ao enviar confirmação." });
  }
}
router.post("/reservas/enviar-confirmacao", handlerEnviarConfirmacao);
router.post("/enviar-confirmacao", handlerEnviarConfirmacao);

/* ══════════════════════════════════════════════════════════════
   POST /api/reservas/reservas/estou-pronto
   POST /api/reservas/estou-pronto
   Mesma razão da dupla-rota acima — dois frontends, duas convenções
   de caminho. O cliente confirma que está pronto para ser
   recolhido — só agora o despacho automático corre de facto (motor
   unificado, criarEDespacharViagem: cria a Trip, raio de 7km, fila
   de ofertas com incentivo de comissão). Mesma mecânica já usada na
   Reserva Flexível (partilha.routes.js → /evento/estou-pronto).

   Body: { codigo }
══════════════════════════════════════════════════════════════ */
async function handlerEstouPronto(req, res) {
  try {
    const { codigo } = req.body || {};
    if (!codigo) return res.status(400).json({ ok: false, message: "codigo obrigatório." });

    const reserva = await Reserva.findOne({ codigo: String(codigo).trim().toUpperCase() });
    if (!reserva) return res.status(404).json({ ok: false, message: "Reserva não encontrada." });

    if (reserva.pagamento?.status !== "pago") {
      return res.status(409).json({ ok: false, message: "Esta reserva ainda não foi paga." });
    }

    // Idempotência — já foi despachada, devolve a referência existente
    // em vez de despachar em duplicado.
    if (reserva.tripRefId) {
      return res.json({ ok: true, message: "Motorista já foi requisitado.", tripId: String(reserva.tripRefId), jaDespachado: true });
    }

    const io = req.app.get("io");
    let dispatched;
    try {
      dispatched = await criarEDespacharViagem({
        tripId:   reserva.codigo,
        canal:    reserva.canal || "publico",
        subcanal: "reserva",
        pickup:  reserva.partida,
        dropoff: reserva.destino,
        when:    new Date(), // "estou pronto" = agora, não a hora inicialmente prevista
        origemGeo:  reserva.origemGeo,
        destinoGeo: reserva.destinoGeo,
        customer: { nome: reserva.nome, email: reserva.email, contacto: reserva.contacto },
        quote:    { categoria: reserva.categoria, total: reserva.valor, currency: "EUR" },
        paymentStatus: "paid",
        meta: { origemReserva: true, reservaId: String(reserva._id) },
      }, io);
    } catch (errDispatch) {
      logger.error({ err: errDispatch, codigo: reserva.codigo }, "❌ /reservas/estou-pronto: dispatch falhou");
      return res.status(500).json({ ok: false, message: "Não foi possível despachar o motorista neste momento. Tente novamente em alguns segundos." });
    }

    reserva.tripRefId = dispatched.viagem._id;
    await reserva.save();

    logger.info({ codigo: reserva.codigo, tripId: String(dispatched.viagem._id) }, "✅ Reserva despachada (estou-pronto)");
    return res.json({ ok: true, message: "Motorista requisitado. A procurar disponibilidade próxima.", tripId: String(dispatched.viagem._id) });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/estou-pronto");
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
}
router.post("/reservas/estou-pronto", handlerEstouPronto);
router.post("/estou-pronto", handlerEstouPronto);

/* ══════════════════════════════════════════════════════════════
   POST /api/reservas/finalizar
   NOVO — marca a viagem como concluída e liberta o par.
   Body: { codigo } ou { reservaId }
══════════════════════════════════════════════════════════════ */
router.post("/reservas/finalizar", async (req, res) => {
  try {
    const { codigo, reservaId } = req.body || {};
    const filtro = codigo
      ? { codigo: String(codigo).trim().toUpperCase() }
      : { _id: reservaId };

    const reserva = await Reserva.findOne(filtro);
    if (!reserva) return res.status(404).json({ ok: false, message: "Reserva não encontrada." });

    reserva.status = "concluida";
    reserva.concluidaEm = new Date();

    // Snapshot do motorista
    if (reserva.motoristaId) {
      try {
        const Motorista = (await import("../models/Motorista.js")).default;
        const mot = await Motorista.findById(reserva.motoristaId).lean();
        if (mot) reserva.snapshotMotorista = {
          nome: mot.nome||"", contacto: mot.contacto||"",
          email: mot.email||"", rating: mot.rating||null,
          matricula: mot.matricula||"", categoria: mot.categoria||"",
        };
      } catch(_) {}
    }

    await reserva.save();

    // ── FATURA AUTOMÁTICA ─────────────────────────────────
    // Assíncrono — não bloqueia a resposta ao motorista
    emitirFaturaAutomatica(reserva).catch(err =>
      logger.warn({ err, reservaId: reserva._id }, "⚠️ Fatura automática falhou")
    );

    // Libertar motorista e veículo
    if (reserva.motoristaId && reserva.veiculoId) {
      await liberarPar(reserva.motoristaId, reserva.veiculoId);
    }

    logger.info({ codigo: reserva.codigo }, "✅ Viagem finalizada — par libertado + fatura a emitir");
    return res.json({ ok: true, message: "Viagem finalizada." });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/finalizar");
    return res.status(500).json({ ok: false, message: "Erro ao finalizar viagem." });
  }
});

/* ── Endpoints inalterados ──────────────────────────────────── */
router.post("/reserva/cancelar", requireCliente, async (req, res) => {
  try {
    const { tripId, codigo } = req.body || {};
    if (!tripId && !codigo) return res.status(400).json({ ok: false, message: "Indique tripId ou codigo." });
    const filtro = { clienteId: req.clienteId };
    if (tripId) filtro._id    = tripId;
    else        filtro.codigo = String(codigo).trim().toUpperCase();
    const reserva = await Reserva.findOne(filtro);
    if (!reserva) return res.status(404).json({ ok: false, message: "Reserva não encontrada." });
    if (["concluida","cancelada"].includes(reserva.status))
      return res.status(400).json({ ok: false, message: `Reserva já está ${reserva.status}.` });
    reserva.status = "cancelada";
    await reserva.save();
    // Libertar par se estava atribuída
    if (reserva.motoristaId && reserva.veiculoId)
      await liberarPar(reserva.motoristaId, reserva.veiculoId).catch(() => {});
    return res.json({ ok: true, message: "Reserva cancelada.", codigo: reserva.codigo });
  } catch (err) {
    logger.error({ err }, "❌ /reserva/cancelar");
    return res.status(500).json({ ok: false, message: "Erro ao cancelar." });
  }
});

router.post("/cancelar-reserva", async (req, res) => {
  try {
    const { email, codigo } = req.body || {};
    if (!email || !codigo) return res.status(400).json({ ok: false, message: "email e codigo obrigatórios." });
    const reserva = await Reserva.findOne({
      email:  String(email).toLowerCase().trim(),
      codigo: String(codigo).trim().toUpperCase(),
    });
    if (!reserva) return res.status(404).json({ ok: false, message: "Reserva não encontrada." });
    if (["concluida","cancelada"].includes(reserva.status))
      return res.status(400).json({ ok: false, message: `Reserva já está ${reserva.status}.` });
    reserva.status = "cancelada";
    await reserva.save();
    if (reserva.motoristaId && reserva.veiculoId)
      await liberarPar(reserva.motoristaId, reserva.veiculoId).catch(() => {});
    return res.json({ ok: true, success: true, message: "Reserva cancelada." });
  } catch (err) {
    logger.error({ err }, "❌ /cancelar-reserva");
    return res.status(500).json({ ok: false, message: "Erro ao cancelar." });
  }
});

router.get("/reservas/pendentes", requireCliente, async (req, res) => {
  try {
    const reservas = await Reserva.find({
      clienteId: req.clienteId,
      status:    { $in: ["pendente","confirmada","atribuida","em_viagem"] },
    }).sort({ datahora: 1 }).select("codigo categoria partida destino datahora status valor pagamento").lean();
    return res.json({ ok: true, reservas });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/pendentes");
    return res.status(500).json({ ok: false, message: "Erro." });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/reservas/avaliar
   O hóspede classifica o motorista depois da viagem — sem login,
   identificado só pelo código (mesmo princípio do "Estou Pronto").
   Chamado a partir de avaliar.html, cujo link chega por SMS/email
   quando a viagem termina (ver /api/tracking/finalizar).
══════════════════════════════════════════════════════════════ */
router.post("/reservas/avaliar", async (req, res) => {
  try {
    const { codigo, rating, comentario } = req.body || {};
    const notaNum = Number(rating);
    if (!codigo) return res.status(400).json({ ok: false, message: "Código obrigatório." });
    if (!notaNum || notaNum < 1 || notaNum > 5) {
      return res.status(400).json({ ok: false, message: "Classificação inválida — escolha entre 1 e 5 estrelas." });
    }

    const codigoNorm = String(codigo).trim().toUpperCase();
    const reserva = await Reserva.findOne({ codigo: codigoNorm }).lean();
    if (!reserva) return res.status(404).json({ ok: false, message: "Reserva não encontrada." });
    if (reserva.avaliacao?.avaliadoEm) {
      return res.status(409).json({ ok: false, message: "Esta viagem já foi avaliada." });
    }

    // Motorista — Reserva (sistema antigo) OU Trip (motor
    // unificado), mesmo padrão de todas as outras correções de
    // hoje. Sem isto, a nota gravava-se na reserva mas nunca
    // chegava a actualizar a média do motorista certo para
    // viagens despachadas pelo sistema novo.
    let motoristaId = reserva.motoristaId || null;
    if (!motoristaId && reserva.tripRefId) {
      const trip = await Trip.findById(reserva.tripRefId).select("driver.driverId").lean();
      motoristaId = trip?.driver?.driverId || null;
    }

    const avaliacao = {
      rating: notaNum,
      comentario: String(comentario || "").trim().slice(0, 500),
      avaliadoEm: new Date(),
    };
    // Coleção em bruto, não Reserva.save() — o schema é estrito e
    // "avaliacao" nunca foi declarado nele; gravar via .save() num
    // campo não declarado é silenciosamente ignorado pelo Mongoose,
    // sem erro nenhum (já vimos este exacto problema hoje noutros
    // sítios). updateOne na coleção bruta ignora o schema por
    // completo, grava sempre.
    await mongoose.connection.db.collection("reservas").updateOne(
      { _id: reserva._id },
      { $set: { avaliacao } }
    );

    // Actualizar a média do motorista — recalculada a partir de
    // TODAS as avaliações reais dele (não um contador incremental
    // que podia desalinhar se alguma gravação falhasse a meio).
    if (motoristaId) {
      const todasAvaliadas = await Reserva.find({
        motoristaId,
        "avaliacao.rating": { $exists: true },
      }).select("avaliacao.rating").lean();
      if (todasAvaliadas.length) {
        const media = todasAvaliadas.reduce((s, r) => s + r.avaliacao.rating, 0) / todasAvaliadas.length;
        await Motorista.findByIdAndUpdate(motoristaId, {
          rating: Number(media.toFixed(2)),
          totalAvaliacoes: todasAvaliadas.length,
        });
      }
    }

    logger.info({ codigo: codigoNorm, rating: notaNum }, "⭐ Viagem avaliada");
    return res.json({ ok: true, message: "Obrigado pela sua avaliação!" });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/avaliar");
    return res.status(500).json({ ok: false, message: "Erro ao gravar avaliação." });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/reservas/classificacoes
   Lista de avaliações das viagens deste hotel/cliente — usado pelo
   popup "CLASSIFICAÇÕES" do hotel-dashboard.html. Suporta filtro
   por período, ordenação, e paginação simples.
   Query: periodo=all|ano|mes|semana|dia, ordem=recente|melhor|pior,
          skip=0, limit=20
══════════════════════════════════════════════════════════════ */
router.get("/reservas/classificacoes", requireCliente, async (req, res) => {
  try {
    const periodo = String(req.query?.periodo || "all");
    const ordem   = String(req.query?.ordem   || "recente");
    const skip    = Math.max(0, parseInt(req.query?.skip, 10) || 0);
    const limit   = Math.min(50, Math.max(1, parseInt(req.query?.limit, 10) || 20));

    const filtro = {
      clienteId: req.clienteId,
      "avaliacao.avaliadoEm": { $exists: true },
    };
    if (periodo !== "all") {
      const agora = new Date();
      const desde = new Date(agora);
      if (periodo === "dia")     desde.setDate(agora.getDate() - 1);
      else if (periodo === "semana") desde.setDate(agora.getDate() - 7);
      else if (periodo === "mes")    desde.setMonth(agora.getMonth() - 1);
      else if (periodo === "ano")    desde.setFullYear(agora.getFullYear() - 1);
      filtro["avaliacao.avaliadoEm"] = { $gte: desde };
    }

    const ordenacao =
      ordem === "melhor" ? { "avaliacao.rating": -1, "avaliacao.avaliadoEm": -1 } :
      ordem === "pior"   ? { "avaliacao.rating": 1,  "avaliacao.avaliadoEm": -1 } :
      { "avaliacao.avaliadoEm": -1 };

    const [total, avaliadas, distribuicaoRaw] = await Promise.all([
      Reserva.countDocuments(filtro),
      Reserva.find(filtro)
        .sort(ordenacao).skip(skip).limit(limit)
        .select("codigo nome categoria partida destino datahora avaliacao")
        .lean(),
      // Distribuição por estrela (1 a 5) — sobre TODO o período
      // filtrado, não só a página actual, para o gráfico ficar
      // correcto mesmo com paginação.
      Reserva.aggregate([
        { $match: filtro },
        { $group: { _id: "$avaliacao.rating", total: { $sum: 1 } } },
      ]),
    ]);

    const distribuicao = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let somaTotal = 0, contagemTotal = 0;
    distribuicaoRaw.forEach((d) => {
      const estrela = Number(d._id);
      if (estrela >= 1 && estrela <= 5) {
        distribuicao[estrela] = d.total;
        somaTotal += estrela * d.total;
        contagemTotal += d.total;
      }
    });
    const media = contagemTotal ? Number((somaTotal / contagemTotal).toFixed(2)) : null;

    const lista = avaliadas.map((r) => ({
      codigo: r.codigo,
      nome: r.nome || "Hóspede",
      categoria: r.categoria || "",
      partida: r.partida || "",
      destino: r.destino || "",
      datahora: r.datahora,
      rating: r.avaliacao?.rating || null,
      comentario: r.avaliacao?.comentario || "",
      avaliadoEm: r.avaliacao?.avaliadoEm || null,
    }));

    return res.json({
      ok: true,
      media,
      total: contagemTotal,
      distribuicao,
      avaliacoes: lista,
      temMais: skip + lista.length < total,
    });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/classificacoes");
    return res.status(500).json({ ok: false, message: "Erro ao carregar classificações." });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/reservas/stats/semana
   Estatísticas dos últimos 7 dias deste hotel — alimenta o gráfico
   do RELATÓRIO SLA (finalizadas, canceladas e faturado por dia).
   Substitui os dados de exemplo (SLA_WEEK_MOCK) por dados reais.
   Devolve no formato que o rm-sla.js espera: { labels, fin, can, fat }.
══════════════════════════════════════════════════════════════ */
router.get("/reservas/stats/semana", requireCliente, async (req, res) => {
  try {
    const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const reservas = await Reserva.find({
      clienteId: req.clienteId,
      status: { $in: ["concluida", "cancelada"] },
      $or: [
        { concluidaEm: { $gte: seteDiasAtras } },
        { canceladaEm: { $gte: seteDiasAtras } },
        { datahora:    { $gte: seteDiasAtras } },
      ],
    }).select("status valor datahora concluidaEm canceladaEm").lean();

    const nomesDia = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const labels = [];
    const idxPorData = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      labels.push(nomesDia[d.getDay()]);
      idxPorData[`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`] = 6 - i;
    }

    const fin = new Array(7).fill(0);
    const can = new Array(7).fill(0);
    const fat = new Array(7).fill(0);

    for (const r of reservas) {
      const quando =
        r.status === "concluida" ? (r.concluidaEm || r.datahora) :
        r.status === "cancelada" ? (r.canceladaEm || r.datahora) :
        r.datahora;
      if (!quando) continue;

      const d = new Date(quando);
      d.setHours(0, 0, 0, 0);
      const chave = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const idx = idxPorData[chave];
      if (idx == null) continue;

      if (r.status === "concluida") {
        fin[idx] += 1;
        fat[idx] += Number(r.valor || 0);
      } else if (r.status === "cancelada") {
        can[idx] += 1;
      }
    }

    const fatRound = fat.map((v) => Math.round(v * 100) / 100);
    return res.json({ labels, fin, can, fat: fatRound });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/stats/semana");
    return res.status(500).json({ message: "Erro ao calcular estatísticas." });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/reservas/sla/lista
   Lista compacta de viagens finalizadas deste hotel — para o
   seletor no popup "RELATÓRIO SLA" (escolher qual viagem ver).
══════════════════════════════════════════════════════════════ */
router.get("/reservas/sla/lista", requireCliente, async (req, res) => {
  try {
    const reservas = await Reserva.find({
      clienteId: req.clienteId,
      status: "concluida",
    })
      .sort({ datahora: -1 })
      .limit(200)
      .select("codigo partida destino datahora nome")
      .lean();

    return res.json({
      ok: true,
      viagens: reservas.map((r) => ({
        codigo: r.codigo,
        nome: r.nome || "Hóspede",
        partida: r.partida || "",
        destino: r.destino || "",
        datahora: r.datahora,
      })),
    });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/sla/lista");
    return res.status(500).json({ ok: false, message: "Erro ao carregar lista." });
  }
});

/* ── Monta o relatório SLA completo de uma reserva — reaproveitado
   pela rota de visualização e pela de email, para nunca desalinhar
   os dois. ── */
async function montarRelatorioSLA(reserva, clienteId) {
  // Motorista/veículo — Reserva (sistema antigo) OU Trip (motor
  // unificado), mesmo padrão de sempre hoje.
  let motoristaNome = "", motoristaId = reserva.motoristaId || null;
  let veiculoTxt = "", matricula = "";
  if (!motoristaId && reserva.tripRefId) {
    const trip = await Trip.findById(reserva.tripRefId).select("driver.driverId").lean();
    motoristaId = trip?.driver?.driverId || null;
  }
  if (motoristaId) {
    const m = await Motorista.findById(motoristaId).select("nome").lean();
    motoristaNome = m?.nome || "";
    const v = await Veiculo.findOne({ motoristaId }).select("marca modelo matricula").lean();
    if (v) { veiculoTxt = `${v.marca || ""} ${v.modelo || ""}`.trim(); matricula = v.matricula || ""; }
  }

  const inicio = reserva.iniciadoEm || null;
  const fim = reserva.finalizadoEm || null;
  const duracaoMin = (inicio && fim) ? Math.round((new Date(fim) - new Date(inicio)) / 60000) : null;

  const base = Number(reserva.valor || 0) - Number(reserva.extras?.portagens || 0);
  const portagens = Number(reserva.extras?.portagens || 0);

  // Estatísticas semanais do hotel (últimos 7 dias) — para o
  // gráfico, independente da viagem seleccionada.
  const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const semanaReservas = await Reserva.find({
    clienteId,
    datahora: { $gte: seteDiasAtras },
    status: { $in: ["concluida", "cancelada"] },
  }).select("status valor datahora").lean();

  const diasSemana = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const porDia = diasSemana.map(() => ({ fin: 0, can: 0, fat: 0 }));
  semanaReservas.forEach((r) => {
    const dia = new Date(r.datahora).getDay();
    if (r.status === "concluida") { porDia[dia].fin++; porDia[dia].fat += Number(r.valor || 0); }
    else if (r.status === "cancelada") { porDia[dia].can++; }
  });

  return {
    codigo: reserva.codigo,
    km: reserva.extras?.km != null ? Number(reserva.extras.km) : null,
    duracaoMin,
    valor: reserva.valor != null ? Number(reserva.valor) : null,
    categoria: reserva.categoria || "",
    datahora: reserva.datahora,
    passageiro: reserva.nome || "",
    partida: reserva.partida || "",
    destino: reserva.destino || "",
    origemGeo: reserva.origemGeo || null,
    destinoGeo: reserva.destinoGeo || null,
    inicio, fim,
    motorista: motoristaNome,
    veiculo: veiculoTxt,
    matricula,
    portagens,
    estado: reserva.status,
    base: Number(base.toFixed(2)),
    extras: 0,
    total: Number((reserva.valor || 0).toFixed(2)),
    semana: {
      labels: diasSemana,
      fin: porDia.map((d) => d.fin),
      can: porDia.map((d) => d.can),
      fat: porDia.map((d) => Number(d.fat.toFixed(2))),
      totalFin: porDia.reduce((s, d) => s + d.fin, 0),
      totalCan: porDia.reduce((s, d) => s + d.can, 0),
      totalFat: Number(porDia.reduce((s, d) => s + d.fat, 0).toFixed(2)),
    },
  };
}

/* ══════════════════════════════════════════════════════════════
   GET /api/reservas/sla/:codigo
   Relatório SLA completo de uma viagem — mapa, KPIs, detalhes,
   despesas, estatísticas semanais do hotel.
══════════════════════════════════════════════════════════════ */
router.get("/reservas/sla/:codigo", requireCliente, async (req, res) => {
  try {
    const codigoNorm = String(req.params.codigo || "").trim().toUpperCase();
    const reserva = await Reserva.findOne({ codigo: codigoNorm, clienteId: req.clienteId }).lean();
    if (!reserva) return res.status(404).json({ ok: false, message: "Viagem não encontrada." });

    const relatorio = await montarRelatorioSLA(reserva, req.clienteId);
    return res.json({ ok: true, relatorio });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/sla/:codigo");
    return res.status(500).json({ ok: false, message: "Erro ao gerar relatório." });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/reservas/sla/:codigo/email
   Envia o relatório por email — como resumo em HTML com link para
   ver/imprimir a versão completa, não um PDF binário anexado (não
   há nenhuma dependência de geração de PDF no servidor hoje; gerar
   PDF a sério do lado do servidor precisaria de uma peça nova,
   pesada, tipo Puppeteer — evitado de propósito). O botão "PDF" no
   ecrã em si usa a função de imprimir do próprio browser, que
   qualquer browser já sabe "Guardar como PDF" sozinho.
══════════════════════════════════════════════════════════════ */
router.post("/reservas/sla/:codigo/email", requireCliente, async (req, res) => {
  try {
    const { destinatario } = req.body || {};
    if (!destinatario) return res.status(400).json({ ok: false, message: "Email de destino obrigatório." });

    const codigoNorm = String(req.params.codigo || "").trim().toUpperCase();
    const reserva = await Reserva.findOne({ codigo: codigoNorm, clienteId: req.clienteId }).lean();
    if (!reserva) return res.status(404).json({ ok: false, message: "Viagem não encontrada." });

    const relatorio = await montarRelatorioSLA(reserva, req.clienteId);
    // Aponta de volta para o próprio painel do hotel (com sessão já
    // iniciada) em vez de criar uma página pública nova só para
    // isto — abre directamente no relatório certo.
    const linkVer = `${getPublicBaseUrl()}/hotel-dashboard.html?slaCodigo=${encodeURIComponent(codigoNorm)}`;
    const dataFmt = relatorio.datahora ? new Date(relatorio.datahora).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

    await notificarConvite({
      metodo: "email",
      contacto: "",
      email: destinatario,
      emailSubject: `Relatório de Viagem ${relatorio.codigo} — REALMETROPOLIS`,
      emailHtml: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;background:#f5f5f5;color:#222">
        <div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,.06)">
          <p style="margin:0 0 4px;font-size:12px;color:#888;text-align:center">De Realmetropolis</p>
          <h2 style="margin:0 0 16px;font-size:18px;color:#050507;text-align:center">Relatório de Viagem</h2>
          <div style="background:#f7f7f8;border-radius:10px;padding:16px;font-size:13px;line-height:1.9">
            <div><b>Código:</b> ${relatorio.codigo}</div>
            <div><b>Passageiro:</b> ${relatorio.passageiro}</div>
            <div><b>De:</b> ${relatorio.partida}</div>
            <div><b>Para:</b> ${relatorio.destino}</div>
            <div><b>Data:</b> ${dataFmt}</div>
            <div><b>Motorista:</b> ${relatorio.motorista || "—"}</div>
            <div><b>Total:</b> €${relatorio.total.toFixed(2)}</div>
          </div>
          <div style="text-align:center;margin-top:20px">
            <a href="${linkVer}" style="display:inline-block;padding:14px 32px;background:#050507;color:#c4c9d4;font-weight:800;font-size:14px;border-radius:10px;text-decoration:none">VER RELATÓRIO COMPLETO</a>
          </div>
        </div>
      </body></html>`,
    });

    logger.info({ codigo: codigoNorm, destinatario }, "📧 Relatório SLA enviado por email");
    return res.json({ ok: true, message: "Relatório enviado por email." });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/sla/:codigo/email");
    return res.status(500).json({ ok: false, message: "Erro ao enviar email." });
  }
});

async function handlerMotoristaAtribuido(req, res) {
  try {
    const { codigo } = req.query;
    // CORREÇÃO: antes exigia SEMPRE clienteId no filtro — mas com
    // código, a reserva já está identificada de forma inequívoca,
    // sem precisar de saber quem pergunta (mesmo padrão dos
    // convites/eventos, sem login). Reservas feitas pelo hotel em
    // nome de um hóspede (sem sessão de cliente) nunca tinham
    // clienteId — o filtro anterior fazia esta consulta devolver
    // sempre vazio para esses casos, silenciosamente.
    const filtro = {};
    // Alargado (antes só "atribuida"/"em_viagem"): com o motor
    // unificado, a Reserva pode ficar "confirmada" para sempre — é a
    // Trip associada (reserva.tripRefId) que sabe o estado real da
    // atribuição, não este campo. Sem alargar, o polling nunca
    // encontrava a reserva para verificar o caminho novo abaixo.
    if (codigo) {
      filtro.codigo = String(codigo).trim().toUpperCase();
    } else {
      filtro.clienteId = req.clienteId;
      filtro.status = { $in: ["atribuida","em_viagem","confirmada"] };
    }
    const reserva = await Reserva.findOne(filtro)
      .populate("motoristaId", "nome foto contacto rating lat lng eta")
      .sort({ datahora: 1 }).lean();

    if (!reserva) return res.json({ ok: true, atribuido: false });

    // ── Caminho ANTIGO (dispatch.service.js) — a Reserva já tem
    // motoristaId preenchido directamente por esse motor. Mantido
    // para reservas ainda em curso nesse sistema. Usa snapshotVeiculo
    // (campo simples, gravado no momento do despacho) em vez de
    // popular "veiculoId" — esse campo nunca existiu no schema da
    // Reserva; tentar populá-lo rebentava esta rota inteira, sempre,
    // desde sempre (StrictPopulateError). ──
    if (["atribuida","em_viagem"].includes(reserva.status) && reserva.motoristaId) {
      const m = reserva.motoristaId;
      const v = reserva.snapshotVeiculo || {};
      const etaMin = await calcularEtaMinutos(
        m.lat, m.lng,
        reserva.origemGeo?.lat, reserva.origemGeo?.lng
      );
      return res.json({
        ok: true, atribuido: true,
        tripId:  String(reserva._id),
        codigo:  reserva.codigo,
        motorista: {
          motoristaNome: m.nome     || "",
          nome:          m.nome     || "",
          foto:          m.foto     || "",
          contacto:      m.contacto || "",
          veiculo:       v.marca ? `${v.marca} ${v.modelo}` : (m.veiculo   || ""),
          matricula:     v.matricula || m.matricula || "",
          cor:           v.cor       || m.cor       || "",
          rating:        m.rating    || 5,
          lat:           m.lat       || null,
          lng:           m.lng       || null,
          eta:           etaMin,
        },
      });
    }

    // ── Caminho NOVO (motor unificado, criarEDespacharViagem) — a
    // atribuição real está na Trip (reserva.tripRefId), gravada por
    // dispatch.events.js quando o motorista aceita. ──
    if (reserva.tripRefId) {
      const trip = await Trip.findById(reserva.tripRefId)
        .populate("driver.driverId", "nome foto contacto rating lat lng eta")
        .lean();

      if (trip?.driver?.driverId && trip.status === "assigned") {
        const m = trip.driver.driverId;
        // Veículo procurado dinamicamente por motoristaId — a mesma
        // fonte de verdade única já usada em todo o resto do
        // sistema (não um snapshot, que desatualizaria se o
        // motorista trocasse de veículo a meio).
        const v = await Veiculo.findOne({ motoristaId: m._id })
          .select("marca modelo matricula cor")
          .lean();
        const etaMin = await calcularEtaMinutos(
          m.lat, m.lng,
          trip.origemGeo?.lat, trip.origemGeo?.lng
        );

        return res.json({
          ok: true, atribuido: true,
          tripId:  String(trip._id),
          codigo:  reserva.codigo,
          motorista: {
            motoristaNome: m.nome     || "",
            nome:          m.nome     || "",
            foto:          m.foto     || "",
            contacto:      m.contacto || "",
            veiculo:       v ? `${v.marca} ${v.modelo}` : "",
            matricula:     v?.matricula || "",
            cor:           v?.cor       || "",
            rating:        m.rating    || 5,
            lat:           m.lat       || null,
            lng:           m.lng       || null,
            eta:           etaMin,
          },
        });
      }
    }

    return res.json({ ok: true, atribuido: false });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/motorista-atribuido");
    return res.status(500).json({ ok: false, message: "Erro." });
  }
}
// Dois frontends, duas convenções de caminho — ver nota em
// handlerEnviarConfirmacao acima, mesma razão.
// Sessão de cliente só é exigida quando NÃO há código na consulta
// ("quais são as minhas reservas activas" precisa de saber quem
// pergunta). Com código, a reserva já está identificada — não faz
// sentido bloquear reservas feitas pelo hotel em nome de um
// hóspede, que nunca têm sessão de cliente própria.
function clienteOpcionalSeTiverCodigo(req, res, next) {
  if (req.query?.codigo) return next();
  return requireCliente(req, res, next);
}
router.get("/reservas/motorista-atribuido", clienteOpcionalSeTiverCodigo, handlerMotoristaAtribuido);
router.get("/motorista-atribuido", clienteOpcionalSeTiverCodigo, handlerMotoristaAtribuido);

router.get("/reservas/historico", requireCliente, async (req, res) => {
  try {
    const pagina = Math.max(1, Number(req.query.pagina  || 1));
    const limite = Math.min(50, Math.max(1, Number(req.query.limite || 10)));
    const [reservas, total] = await Promise.all([
      Reserva.find({ clienteId: req.clienteId }).sort({ datahora: -1 })
        .skip((pagina-1)*limite).limit(limite)
        .select("codigo categoria partida destino datahora status valor pagamento createdAt snapshotMotorista snapshotVeiculo").lean(),
      Reserva.countDocuments({ clienteId: req.clienteId }),
    ]);
    return res.json({ ok: true, reservas, paginacao: { total, pagina, limite, totalPaginas: Math.ceil(total/limite) } });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/historico");
    return res.status(500).json({ ok: false, message: "Erro." });
  }
});

router.get("/reservas/:id", requireCliente, async (req, res) => {
  try {
    const reserva = await Reserva.findOne({ _id: req.params.id, clienteId: req.clienteId })
      .populate("motoristaId", "nome foto contacto rating")
      .lean();
    if (!reserva) return res.status(404).json({ ok: false, message: "Não encontrada." });
    return res.json({ ok: true, reserva });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/:id");
    return res.status(500).json({ ok: false, message: "Erro." });
  }
});

router.get("/stripe/public-key", (_req, res) => {
  const key = process.env.STRIPE_PUBLIC_KEY || "";
  if (!key) logger.warn("⚠️ STRIPE_PUBLIC_KEY não definido");
  return res.json({ publicKey: key || null });
});

router.post("/stripe/criar-intent", async (req, res) => {
  try {
    const stripe = await getStripe();
    if (!stripe) return res.status(503).json({ ok: false, code: "STRIPE_NOT_CONFIGURED", message: "Stripe não configurado." });
    const valor     = Number(req.body?.valor    || 0);
    const descricao = String(req.body?.descricao || "Reserva REALMETROPOLIS").slice(0, 127);
    if (!Number.isFinite(valor) || valor <= 0)
      return res.status(400).json({ ok: false, code: "INVALID_AMOUNT", message: "Valor inválido." });
    const intent = await stripe.paymentIntents.create({
      amount:   Math.round(valor * 100),
      currency: "eur",
      description: descricao,
      automatic_payment_methods: { enabled: true },
    });
    logger.info({ valor }, "✅ Stripe intent criado");
    return res.json({ ok: true, clientSecret: intent.client_secret });
  } catch (err) {
    logger.error({ err }, "❌ /stripe/criar-intent");
    return res.status(500).json({ ok: false, code: "STRIPE_ERROR", message: err?.message || "Erro Stripe." });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/reservas/motoristas-historico
   Devolve os motoristas das últimas viagens concluídas
   do cliente autenticado — para o sistema de preferências.
   Máx. 10 motoristas únicos.
══════════════════════════════════════════════════════════════ */
router.get("/motoristas-historico", requireCliente, async (req, res) => {
  try {
    // Buscar últimas 20 viagens concluídas do cliente
    const reservas = await Reserva.find({
      clienteId: req.clienteId,
      status:    "concluida",
      motoristaId: { $ne: null },
    })
    .sort({ datahora: -1 })
    .limit(20)
    .populate("motoristaId", "nome contacto email rating foto")
    .lean();

    // Deduplica por motoristaId — máx 10 motoristas únicos
    const vistos   = new Set();
    const resultado = [];

    for (const r of reservas) {
      if (!r.motoristaId) continue;
      const mid = String(r.motoristaId._id || r.motoristaId);
      if (vistos.has(mid)) continue;
      vistos.add(mid);

      resultado.push({
        motoristaId: mid,
        nome:        r.motoristaId.nome     || "Motorista",
        contacto:    r.motoristaId.contacto || "",
        email:       r.motoristaId.email    || "",
        rating:      Number(r.motoristaId.rating || 5).toFixed(1),
        // Última viagem com este motorista
        ultimaViagem: {
          reservaId: String(r._id),
          codigo:    r.codigo,
          partida:   r.partida,
          destino:   r.destino,
          datahora:  r.datahora,
          valor:     r.valor,
          categoria: r.categoria,
        },
      });

      if (resultado.length >= 10) break;
    }

    return res.json({ ok: true, motoristas: resultado, total: resultado.length });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/motoristas-historico");
    return res.status(500).json({ ok: false, message: "Erro ao carregar histórico de motoristas." });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/reservas/preferencias/motorista
   Guarda um motorista como preferência do cliente.
   Body: { motoristaId }
══════════════════════════════════════════════════════════════ */
router.post("/preferencias/motorista", requireCliente, async (req, res) => {
  try {
    const { motoristaId } = req.body || {};
    if (!motoristaId) return res.status(400).json({ ok: false, message: "motoristaId obrigatório." });

    // Verificar que o motorista existe na reserva do cliente
    const existe = await Reserva.findOne({
      clienteId:   req.clienteId,
      motoristaId: motoristaId,
      status:      "concluida",
    }).lean();

    if (!existe) {
      return res.status(403).json({ ok: false, message: "Motorista não encontrado no histórico de viagens." });
    }

    // Guardar preferência no cliente (array de IDs, sem duplicados)
    const mongoose = (await import("mongoose")).default;
    await mongoose.connection.db.collection("clientes").updateOne(
      { _id: new mongoose.Types.ObjectId(String(req.clienteId)) },
      {
        $addToSet: { "preferencias.motoristas": String(motoristaId) },
        $set:      { updatedAt: new Date() },
      }
    );

    return res.json({ ok: true, message: "Motorista guardado como preferência." });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/preferencias/motorista");
    return res.status(500).json({ ok: false, message: "Erro ao guardar preferência." });
  }
});


export default router;