// src/routes/tracking.routes.js
// ══════════════════════════════════════════════════════════════
// Sistema de tracking de segurança em tempo real
//
// POST /api/tracking/iniciar          — motorista inicia viagem
// POST /api/tracking/motorista/pos    — atualiza posição do motorista
// POST /api/tracking/cliente/pos      — atualiza posição do cliente
// POST /api/tracking/finalizar        — finaliza viagem
// GET  /api/tracking/viagem/:id       — estado actual da viagem
// GET  /api/tracking/alertas          — alertas activos (admin/segurança)
// POST /api/tracking/alertas/sos      — alerta MANUAL do motorista (botão de ajuda)
// POST /api/tracking/alertas/:id/resolver — resolve alerta
// ══════════════════════════════════════════════════════════════

import { Router }       from "express";
import path              from "path";
import fs                from "fs";
import { fileURLToPath } from "url";
import multer             from "multer";
import Reserva          from "../models/Reserva.js";
import Trip              from "../models/Trip.js";
import ShareTrip        from "../models/ShareTrip.js";
import ShareInvite      from "../models/ShareInvite.js";
import Motorista        from "../models/Motorista.js";
import Veiculo          from "../models/Veiculo.js";
import SecurityAlert    from "../models/SecurityAlert.js";
import logger           from "../config/logger.js";
import { extractToken }       from "../utils/authUtils.js";
import { isSegurancaActiva } from "../services/regiaoSeguranca.service.js";
import jwt              from "jsonwebtoken";
import { notificarConvite } from "../services/notificarConvite.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const SEGURANCA_UPLOADS_DIR = path.join(__dirname, "..", "..", "public", "uploads", "seguranca");

function getPublicBaseUrl() {
  const a = String(process.env.PUBLIC_BASE_URL || "").trim();
  if (a) return a.replace(/\/+$/, "");
  const b = String(process.env.FRONTEND_URL || "").trim();
  if (b) return b.replace(/\/+$/, "");
  return "http://localhost:10000";
}
fs.mkdirSync(SEGURANCA_UPLOADS_DIR, { recursive: true });

const uploadImagemSeguranca = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, SEGURANCA_UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "") || ".jpg";
      cb(null, `seg_${req.params.id}_${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error("Apenas imagens são permitidas."));
    cb(null, true);
  },
});

const router = Router();

// ── Estado em memória das viagens activas ─────────────────────
// { reservaId: { motorista: {lat,lng,ts}, cliente: {lat,lng,ts},
//                desvioInicio: Date|null, alertaEmitido: bool } }
const viagensActivas = new Map();

// ── Haversine (metros) ────────────────────────────────────────
function distM(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat/2)**2 +
    Math.cos(a.lat*Math.PI/180) * Math.cos(b.lat*Math.PI/180) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ── Emitir alerta via Socket.io ───────────────────────────────
function emitirAlerta(req, alerta) {
  try {
    const io = req.app.get('io');
    if (io) io.to('seguranca').emit('alerta_seguranca', alerta);
  } catch(_) {}
}
function emitirPosicao(req, dados) {
  try {
    const io = req.app.get('io');
    if (io) io.to('seguranca').emit('posicao_atualizada', dados);
  } catch(_) {}
}

// ── Auth simples (motorista ou cliente) ──────────────────────
function getPayload(req) {
  try {
    const token = extractToken(req, 'rm_cliente_token', ['rm_motorista_token','token']);
    if (!token) return null;
    const secret = process.env.JWT_SECRET || '';
    return jwt.verify(token, secret);
  } catch { return null; }
}

// Middleware — exigia sessão de motorista/cliente, mas nunca era
// aplicado a nenhuma rota; getPayload() existia, mas estava por
// ligar. Sem isto, qualquer pessoa sem sessão conseguia chamar
// /motorista/pos, /cliente/pos, /check-in, /iniciar e /finalizar.
function requireMotoristaOuCliente(req, res, next) {
  const payload = getPayload(req);
  if (!payload) return res.status(401).json({ ok: false, message: "Sessão necessária." });
  req.authPayload = payload;
  next();
}

// Middleware — operador de segurança / admin. As rotas de alertas
// (/alertas, /alertas/:id/resolver, /assumir, /solicitar-imagem,
// /imagem) e /viagens-ativas e /regioes não tinham NENHUMA
// autenticação — qualquer pedido conseguia resolver/assumir um
// alerta de segurança ou pedir uma foto a um motorista.
function requireOperador(req, res, next) {
  try {
    const token = extractToken(req, 'rm_operador_token', ['admin_token', 'token']);
    if (!token) return res.status(401).json({ ok: false, message: "Sessão de operador necessária." });
    const secret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || '';
    const payload = jwt.verify(token, secret);
    req.authPayload = payload;
    next();
  } catch {
    return res.status(401).json({ ok: false, message: "Sessão de operador necessária." });
  }
}

/* ══════════════════════════════════════════════════════════════
   POST /api/tracking/iniciar
   Motorista inicia viagem — activa tracking automático
══════════════════════════════════════════════════════════════ */
router.post("/iniciar", requireMotoristaOuCliente, async (req, res) => {
  try {
    const { reservaId, motoristaId } = req.body || {};
    if (!reservaId) return res.status(400).json({ ok:false, message:"reservaId obrigatório." });

    // ── Reserva (sistema antigo) OU Trip (motor de despacho
    // unificado) — desde a migração de hoje, uma viagem despachada
    // pelo motor novo só existe como Trip, nunca como Reserva com
    // motoristaId preenchido. Sem este segundo caminho, o tracking
    // de segurança nunca activava para nenhuma viagem despachada
    // pelo sistema novo — procurava sempre só em Reserva, e como
    // "Reserva não encontrada" (id era de uma Trip), a chamada
    // falhava sempre em silêncio para essas viagens.
    let destinoGeo = null, origemGeo = null, nomeCliente = "", contactoCliente = "";
    let concelhoViagem = "", paisViagem = "pt";
    let motoristaNome = "", motoristaContacto = "", motoristaFoto = "";
    let partidaTxt = "", destinoTxt = "", categoriaViagem = "", valorViagem = null, matriculaViagem = "", veiculoViagem = "";
    let encontrada = false;

    const reserva = await Reserva.findById(reservaId)
      .populate("motoristaId", "nome contacto documentos.fotoRosto")
      .lean();

    if (reserva) {
      encontrada = true;
      destinoGeo = reserva.destinoGeo || null;
      origemGeo  = reserva.origemGeo  || null;
      concelhoViagem = String(reserva.extras?.concelho || reserva.cidade || "").trim().toLowerCase();
      paisViagem = reserva.extras?.pais || "pt";
      nomeCliente = reserva.nome || "";
      contactoCliente = reserva.contacto || "";
      partidaTxt  = reserva.partida  || "";
      destinoTxt  = reserva.destino  || "";
      categoriaViagem = reserva.categoria || "";
      valorViagem = reserva.valor != null ? Number(reserva.valor) : null;
      motoristaNome     = reserva.motoristaId?.nome || "";
      motoristaContacto = reserva.motoristaId?.contacto || "";
      motoristaFoto     = reserva.motoristaId?.documentos?.fotoRosto?.file?.url || "";
      await Reserva.findByIdAndUpdate(reservaId, { status: "em_viagem" });
      // Carimbo de início — via coleção em bruto, "iniciadoEm" nunca
      // foi declarado no schema. Precisamos disto para o Relatório
      // SLA calcular a duração real da viagem (fim - início), que
      // hoje não existe em lado nenhum.
      await mongoose.connection.db.collection("reservas").updateOne(
        { _id: reserva._id }, { $set: { iniciadoEm: new Date() } }
      );
    } else {
      const trip = await Trip.findById(reservaId)
        .populate("driver.driverId", "nome contacto documentos.fotoRosto")
        .lean();
      if (trip) {
        encontrada = true;
        destinoGeo = trip.destinoGeo || null;
        origemGeo  = trip.origemGeo  || null;
        nomeCliente = trip.customer?.nome || trip.nome || "";
        contactoCliente = trip.customer?.contacto || trip.contacto || "";
        partidaTxt  = trip.partida  || trip.origem  || "";
        destinoTxt  = trip.destino  || "";
        categoriaViagem = trip.categoria || "";
        valorViagem = trip.valor != null ? Number(trip.valor) : null;
        const m = trip.driver?.driverId;
        motoristaNome     = m?.nome || "";
        motoristaContacto = m?.contacto || "";
        motoristaFoto     = m?.documentos?.fotoRosto?.file?.url || "";
        await Trip.findByIdAndUpdate(reservaId, { status: "em_viagem" });
        await mongoose.connection.db.collection("viagens").updateOne(
          { _id: trip._id }, { $set: { iniciadoEm: new Date() } }
        );
      }
    }

    if (!encontrada) return res.status(404).json({ ok:false, message:"Viagem não encontrada." });

    // Verificar se a segurança está activa para esta região
    const segActiva = concelhoViagem ? await isSegurancaActiva(concelhoViagem) : true;
    if (!segActiva) {
      logger.warn({ reservaId, concelhoViagem }, "⚠️ Tracking iniciado mas segurança inactiva nesta região");
    }

    // Veículo do motorista — procurado dinamicamente por
    // motoristaId (a mesma fonte de verdade única já usada no resto
    // do sistema), não um snapshot que podia desatualizar.
    if (motoristaId) {
      const veiculo = await Veiculo.findOne({ motoristaId }).select("marca modelo matricula cor").lean();
      if (veiculo) {
        veiculoViagem   = veiculo.marca ? `${veiculo.marca} ${veiculo.modelo}` : "";
        matriculaViagem = veiculo.matricula || "";
      }
    }

    // Activar estado de tracking. motoristaId vem do corpo do
    // pedido (o motorista já sabe o seu próprio id) — mais fiável
    // do que depender de qualquer populate, que só funciona no
    // caminho Reserva, nunca no caminho Trip.
    viagensActivas.set(String(reservaId), {
      reservaId: String(reservaId),
      motorista: { lat: null, lng: null, ts: null },
      cliente:   { lat: null, lng: null, ts: null },
      destinoLat: destinoGeo?.lat || null,
      destinoLng: destinoGeo?.lng || null,
      origemLat:  origemGeo?.lat  || null,
      origemLng:  origemGeo?.lng  || null,
      regiao:    concelhoViagem || "global",
      pais:      paisViagem,
      desvioInicio: null,
      alertaEmitido: false,
      viagemInfo: {
        partida:   partidaTxt,
        destino:   destinoTxt,
        categoria: categoriaViagem,
        valor:     valorViagem,
        veiculo:   veiculoViagem,
        matricula: matriculaViagem,
      },
      motoristaInfo: {
        id:       String(motoristaId || ""),
        nome:     motoristaNome,
        contacto: motoristaContacto,
        foto:     motoristaFoto,
      },
      clienteInfo: {
        nome:     nomeCliente,
        contacto: contactoCliente,
      },
    });

    logger.info({ reservaId }, "🚗 Tracking iniciado");
    return res.json({ ok:true, message:"Viagem iniciada. Tracking activo." });
  } catch(err) {
    logger.error({ err }, "❌ /tracking/iniciar");
    return res.status(500).json({ ok:false, message:"Erro ao iniciar tracking." });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/tracking/motorista/pos
   Motorista envia posição a cada 15s
══════════════════════════════════════════════════════════════ */
router.post("/motorista/pos", requireMotoristaOuCliente, async (req, res) => {
  try {
    const { reservaId, lat, lng, heading, speed } = req.body || {};
    if (!reservaId || lat == null || lng == null) {
      return res.status(400).json({ ok:false, message:"reservaId, lat e lng obrigatórios." });
    }

    const estado = viagensActivas.get(String(reservaId));
    if (!estado) return res.json({ ok:true, tracking:false });

    const agora = Date.now();
    estado.motorista = { lat: Number(lat), lng: Number(lng), ts: agora, heading, speed };

    // ── Verificar desvio de rota — threshold adaptativo pela gravidade ──
    // Em vez de esperar sempre 5 minutos fixos, calcula-se a cada
    // actualização a gravidade do desvio: a velocidade com que a
    // distância ao destino está a crescer (m/min) e a distância total
    // já acumulada na direcção errada. Um desvio brusco e grande
    // dispara o alerta em segundos; um desvio leve e ambíguo (trânsito,
    // imprecisão normal de GPS) continua a aguardar até aos 5 minutos
    // originais antes de soar, para não gerar falsos positivos.
    if (estado.destinoLat && estado.destinoLng) {
      const distDestino = distM(
        { lat: Number(lat), lng: Number(lng) },
        { lat: estado.destinoLat, lng: estado.destinoLng }
      );

      const posAnterior = estado._ultimaPosMotorista;
      if (posAnterior) {
        const distAnterior = distM(posAnterior, { lat: estado.destinoLat, lng: estado.destinoLng });
        const deltaDist = distDestino - distAnterior; // +: afastou-se, -: aproximou-se
        const deltaTempoMin = Math.max(
          (agora - (estado._ultimaPosMotoristaTs || agora)) / 60000,
          1 / 60 // mínimo de 1s, evita divisão por zero em chamadas muito próximas
        );
        const taxaAfastamentoMPorMin = deltaDist / deltaTempoMin;
        const estaAAfastar = deltaDist > 50; // afastou-se >50m desde a última posição

        if (estaAAfastar) {
          if (!estado.desvioInicio) {
            estado.desvioInicio = agora;
            estado.desvioDistAcumulada = 0;
          }
          estado.desvioDistAcumulada = (estado.desvioDistAcumulada || 0) + deltaDist;
        } else {
          estado.desvioInicio = null; // voltou ao caminho
          estado.desvioDistAcumulada = 0;
        }

        if (estado.desvioInicio && !estado.alertaEmitido) {
          const minutosDesviado = (agora - estado.desvioInicio) / 60000;
          const distAcumulada = estado.desvioDistAcumulada || 0;

          // Gravidade → quanto tempo esperar antes de disparar.
          // Quanto mais rápido/maior o afastamento, mais cedo dispara.
          let limiteMin, gravidade;
          if (taxaAfastamentoMPorMin > 800 || distAcumulada > 1500) {
            limiteMin = 0.5;  gravidade = "critica";   // ~30s
          } else if (taxaAfastamentoMPorMin > 400 || distAcumulada > 800) {
            limiteMin = 1.5;  gravidade = "alta";       // ~1m30
          } else if (taxaAfastamentoMPorMin > 150 || distAcumulada > 400) {
            limiteMin = 3;    gravidade = "moderada";   // 3 min
          } else {
            limiteMin = 5;    gravidade = "leve";       // 5 min (comportamento original)
          }

          if (minutosDesviado >= limiteMin) {
            estado.alertaEmitido = true;
            const alerta = await SecurityAlert.create({
              reservaId:           estado.reservaId,
              tipo:                "DESVIO_ROTA",
              regiao:              estado.regiao || "global",
              pais:                estado.pais   || "pt",
              status:              "ativo",
              motoristaNome:       estado.motoristaInfo.nome,
              motoristaContacto:   estado.motoristaInfo.contacto,
              motoristaLat:        Number(lat),
              motoristaLng:        Number(lng),
              clienteNome:         estado.clienteInfo.nome,
              clienteContacto:     estado.clienteInfo.contacto,
              clienteLat:          estado.cliente.lat,
              clienteLng:          estado.cliente.lng,
              destinoLat:          estado.destinoLat,
              destinoLng:          estado.destinoLng,
              distanciaDestino:    Math.round(distDestino),
              minutosDesvio:       Math.round(minutosDesviado * 10) / 10,
              gravidade,
            });
            emitirAlerta(req, alerta.toObject());
            logger.warn(
              { reservaId, distDestino, taxaAfastamentoMPorMin: Math.round(taxaAfastamentoMPorMin), distAcumulada: Math.round(distAcumulada), minutosDesviado: minutosDesviado.toFixed(1), gravidade },
              "🚨 ALERTA: Desvio de rota"
            );
            setTimeout(() => { estado.alertaEmitido = false; }, 10 * 60 * 1000);
          }
        }

        // <500m do destino e cliente desconectou → alerta
        if (distDestino < 500 && estado.cliente.ts &&
            (agora - estado.cliente.ts) > 60000 && !estado._alertaDesconexao) {
          estado._alertaDesconexao = true;
          const alerta = await SecurityAlert.create({
            reservaId:         estado.reservaId,
            tipo:              "CLIENTE_DESCONECTADO",
            regiao:             estado.regiao || "global",
            pais:               estado.pais   || "pt",
            status:            "ativo",
            motoristaNome:     estado.motoristaInfo.nome,
            motoristaContacto: estado.motoristaInfo.contacto,
            motoristaLat:      Number(lat),
            motoristaLng:      Number(lng),
            clienteNome:       estado.clienteInfo.nome,
            clienteContacto:   estado.clienteInfo.contacto,
            destinoLat:        estado.destinoLat,
            destinoLng:        estado.destinoLng,
            distanciaDestino:  Math.round(distDestino),
          });
          emitirAlerta(req, alerta.toObject());
          logger.warn({ reservaId }, "🚨 ALERTA: Cliente desconectado perto do destino");
        }
      }
      estado._ultimaPosMotorista = { lat: Number(lat), lng: Number(lng) };
      estado._ultimaPosMotoristaTs = agora;

    // ── Verificar motorista parado >5min ────────────────────
    const speed_val = Number(speed) || 0;
    const posActual = { lat: Number(lat), lng: Number(lng) };

    if (!estado._paradoInicio) {
      // Inicializar referência de posição
      estado._paradoRefPos = posActual;
      estado._paradoInicio = null;
    }

    const distParado = distM(estado._paradoRefPos || posActual, posActual);

    if (speed_val < 2 && distParado < 30) {
      // Veículo parado (velocidade <2km/h e não moveu >30m)
      if (!estado._paradoInicio) {
        estado._paradoInicio = agora;
      } else if (
        (agora - estado._paradoInicio) > 5 * 60 * 1000 &&
        !estado._alertaParado
      ) {
        // Parado há mais de 5 minutos → alerta
        estado._alertaParado = true;
        const alertaParado = await SecurityAlert.create({
          reservaId:         estado.reservaId,
          tipo:              "MOTORISTA_PARADO",
          regiao:            estado.regiao || "global",
          pais:              estado.pais   || "pt",
          status:            "ativo",
          motoristaNome:     estado.motoristaInfo.nome,
          motoristaContacto: estado.motoristaInfo.contacto,
          motoristaLat:      Number(lat),
          motoristaLng:      Number(lng),
          clienteNome:       estado.clienteInfo.nome,
          clienteContacto:   estado.clienteInfo.contacto,
          clienteLat:        estado.cliente.lat,
          clienteLng:        estado.cliente.lng,
          destinoLat:        estado.destinoLat,
          destinoLng:        estado.destinoLng,
          minutosDesvio:     Math.floor((agora - estado._paradoInicio) / 60000),
        });
        emitirAlerta(req, alertaParado.toObject());
        logger.warn({ reservaId }, "🚨 ALERTA: Motorista parado >5min");
        // Reset após 10min para não spammar
        setTimeout(() => { estado._alertaParado = false; }, 10 * 60 * 1000);
      }
    } else {
      // Motorista voltou a mover
      estado._paradoInicio = null;
      estado._alertaParado = false;
      estado._paradoRefPos = posActual;
    }
    }

    // Emitir posição para o painel de segurança
    emitirPosicao(req, {
      reservaId, tipo:"motorista",
      lat: Number(lat), lng: Number(lng),
      heading, speed, ts: agora,
      nome: estado.motoristaInfo.nome,
      foto: estado.motoristaInfo.foto,
    });

    return res.json({ ok:true });
  } catch(err) {
    logger.error({ err }, "❌ /tracking/motorista/pos");
    return res.status(500).json({ ok:false });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/tracking/cliente/pos
   Cliente partilha posição voluntariamente
══════════════════════════════════════════════════════════════ */
router.post("/cliente/pos", requireMotoristaOuCliente, async (req, res) => {
  try {
    const { reservaId, lat, lng } = req.body || {};
    if (!reservaId || lat == null || lng == null) {
      return res.status(400).json({ ok:false, message:"reservaId, lat e lng obrigatórios." });
    }

    const estado = viagensActivas.get(String(reservaId));
    if (!estado) return res.json({ ok:true, tracking:false });

    estado.cliente = { lat: Number(lat), lng: Number(lng), ts: Date.now() };

    emitirPosicao(req, {
      reservaId, tipo:"cliente",
      lat: Number(lat), lng: Number(lng),
      ts: Date.now(),
      nome: estado.clienteInfo.nome,
    });

    return res.json({ ok:true });
  } catch(err) {
    logger.error({ err }, "❌ /tracking/cliente/pos");
    return res.status(500).json({ ok:false });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/tracking/finalizar
   Finaliza viagem e para tracking
══════════════════════════════════════════════════════════════ */
router.post("/finalizar", requireMotoristaOuCliente, async (req, res) => {
  try {
    const { reservaId } = req.body || {};
    if (!reservaId) return res.status(400).json({ ok:false, message:"reservaId obrigatório." });

    // Guardar dados do cliente ANTES de apagar o estado em memória —
    // precisamos deles para enviar o SMS/email de classificação.
    const estado = viagensActivas.get(String(reservaId));
    viagensActivas.delete(String(reservaId));

    // Reserva (sistema antigo) OU Trip (motor unificado) — mesmo
    // motivo das outras correções de hoje: sem isto, finalizar uma
    // viagem despachada pelo motor novo nunca marcava nada como
    // concluído (procurava sempre só em Reserva).
    let codigo = null, nomeCliente = "", contactoCliente = "", emailCliente = "";
    const reserva = await Reserva.findById(reservaId).lean();
    if (reserva) {
      await Reserva.findByIdAndUpdate(reservaId, { status: "concluida" });
      // Carimbo de fim — mesma técnica de "iniciadoEm" no /iniciar,
      // via coleção em bruto. É a subtracção destes dois carimbos
      // que dá a duração real da viagem no Relatório SLA.
      await mongoose.connection.db.collection("reservas").updateOne(
        { _id: reserva._id }, { $set: { finalizadoEm: new Date() } }
      );
      codigo = reserva.codigo;
      nomeCliente = reserva.nome || "";
      contactoCliente = reserva.contacto || "";
      emailCliente = reserva.email || "";
    } else {
      const trip = await Trip.findById(reservaId).lean();
      if (trip) {
        await Trip.findByIdAndUpdate(reservaId, { status: "concluida" });
        await mongoose.connection.db.collection("viagens").updateOne(
          { _id: trip._id }, { $set: { finalizadoEm: new Date() } }
        );
        codigo = trip.codigo || String(trip._id);
        nomeCliente = trip.customer?.nome || trip.nome || "";
        contactoCliente = trip.customer?.contacto || trip.contacto || "";
        emailCliente = trip.customer?.email || trip.email || "";
      }
    }

    const io = req.app.get('io');
    if (io) io.to('seguranca').emit('viagem_finalizada', { reservaId });

    // Link de classificação — enviado por SMS/email assim que a
    // viagem termina, best effort (não bloqueia a resposta ao
    // motorista se falhar). Usa o código da reserva, sem login —
    // mesmo princípio já usado no "Estou Pronto".
    if (codigo && (contactoCliente || emailCliente)) {
      const linkAvaliar = `${getPublicBaseUrl()}/avaliar.html?codigo=${encodeURIComponent(codigo)}`;
      const primeiroNome = String(nomeCliente || "").trim().split(/\s+/)[0] || "";
      const saudacao = primeiroNome ? `Olá ${primeiroNome}` : "Olá";
      notificarConvite({
        metodo: "ambos",
        contacto: contactoCliente || "",
        email:    emailCliente    || null,
        smsBody:  `De Realmetropolis.\n${saudacao}, espero que tenha corrido tudo bem!\nAvalie o seu motorista, demora 10 segundos:\n${linkAvaliar}`,
        emailSubject: "Avalie a sua viagem — REALMETROPOLIS",
        emailHtml: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;background:#f5f5f5;color:#222">
          <div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,.06)">
            <p style="margin:0 0 4px;font-size:12px;color:#888;text-align:center">De Realmetropolis</p>
            <h2 style="margin:0 0 12px;font-size:20px;color:#050507;text-align:center">${saudacao} ✅</h2>
            <p style="margin:0 0 20px;font-size:14px;line-height:1.5;text-align:center">Espero que tenha corrido tudo bem. Avalie o seu motorista — demora só 10 segundos.</p>
            <div style="text-align:center">
              <a href="${linkAvaliar}" style="display:inline-block;padding:14px 32px;background:#050507;color:#c4c9d4;font-weight:800;font-size:14px;border-radius:10px;text-decoration:none">AVALIAR VIAGEM</a>
            </div>
          </div>
        </body></html>`,
      }).catch((err) => logger.warn({ err: err?.message, reservaId }, "⚠️ Falha ao enviar link de classificação"));
    }

    logger.info({ reservaId }, "✅ Viagem finalizada — tracking parado");
    return res.json({ ok:true, message:"Viagem finalizada com sucesso." });
  } catch(err) {
    logger.error({ err }, "❌ /tracking/finalizar");
    return res.status(500).json({ ok:false });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/tracking/viagem/:reservaId
   Estado actual da viagem (para o painel)
══════════════════════════════════════════════════════════════ */
router.get("/viagem/:reservaId", (req, res) => {
  const estado = viagensActivas.get(req.params.reservaId);
  if (!estado) return res.json({ ok:true, activa:false });
  return res.json({ ok:true, activa:true, ...estado });
});

/* ══════════════════════════════════════════════════════════════
   GET /api/tracking/alertas
   Lista alertas activos (para o painel de segurança)
══════════════════════════════════════════════════════════════ */
router.get("/alertas", requireOperador, async (req, res) => {
  try {
    const { regiao, pais } = req.query;
    const filtro = { status: "ativo" };
    if (regiao) filtro.regiao = String(regiao).toLowerCase();
    if (pais)   filtro.pais   = String(pais).toLowerCase();

    const alertas = await SecurityAlert.find(filtro)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.json({ ok:true, alertas });
  } catch(err) {
    logger.error({ err }, "❌ /tracking/alertas");
    return res.status(500).json({ ok:false });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/tracking/alertas/sos
   Alerta MANUAL, disparado pelo próprio motorista (botão "Ajuda" /
   escudo no motorista.html) — ao contrário dos outros tipos
   (DESVIO_ROTA, MOTORISTA_PARADO, ...), que são automáticos, este é
   sempre tratado com prioridade máxima pelo painel de segurança.
══════════════════════════════════════════════════════════════ */
router.post("/alertas/sos", requireMotoristaOuCliente, async (req, res) => {
  try {
    const { reservaId, lat, lng } = req.body || {};
    if (!reservaId) return res.status(400).json({ ok:false, message:"reservaId obrigatório." });

    const estado = viagensActivas.get(String(reservaId));

    // Dados do motorista/cliente — usa o estado em memória da viagem
    // (já populado por /tracking/iniciar); se por algum motivo a
    // viagem não estiver em memória (ex: servidor reiniciou), vai
    // buscar à Reserva como reserva.
    let motoristaInfo = estado?.motoristaInfo;
    let clienteInfo   = estado?.clienteInfo;
    let destinoLat    = estado?.destinoLat ?? null;
    let destinoLng    = estado?.destinoLng ?? null;
    let regiao        = estado?.regiao || "global";
    let pais          = estado?.pais   || "pt";

    if (!motoristaInfo || !motoristaInfo.nome) {
      const reserva = await Reserva.findById(reservaId)
        .populate("motoristaId", "nome contacto")
        .lean();
      if (!reserva) return res.status(404).json({ ok:false, message:"Viagem não encontrada." });

      motoristaInfo = {
        id:       String(reserva.motoristaId?._id || ""),
        nome:     reserva.motoristaId?.nome     || "",
        contacto: reserva.motoristaId?.contacto || "",
      };
      clienteInfo = { nome: reserva.nome || "", contacto: reserva.contacto || "" };
      destinoLat  = reserva.destinoGeo?.lat || null;
      destinoLng  = reserva.destinoGeo?.lng || null;
      regiao      = String(reserva.extras?.concelho || reserva.cidade || "global").toLowerCase();
      pais        = reserva.extras?.pais || "pt";
    }

    const motLat = lat != null ? Number(lat) : (estado?.motorista?.lat ?? null);
    const motLng = lng != null ? Number(lng) : (estado?.motorista?.lng ?? null);

    const alerta = await SecurityAlert.create({
      reservaId:         String(reservaId),
      tipo:              "SOS_MOTORISTA",
      regiao,
      pais,
      status:            "ativo",
      motoristaNome:     motoristaInfo.nome,
      motoristaContacto: motoristaInfo.contacto,
      motoristaLat:      motLat,
      motoristaLng:      motLng,
      clienteNome:       clienteInfo?.nome     || "",
      clienteContacto:   clienteInfo?.contacto || "",
      clienteLat:        estado?.cliente?.lat  ?? null,
      clienteLng:        estado?.cliente?.lng  ?? null,
      destinoLat,
      destinoLng,
    });

    emitirAlerta(req, alerta.toObject());

    logger.warn({ reservaId, motoristaId: motoristaInfo.id }, "🆘 ALERTA: Motorista pediu ajuda (SOS manual)");
    return res.json({ ok:true, message:"Alerta enviado ao centro de segurança.", alertaId: String(alerta._id) });
  } catch(err) {
    logger.error({ err }, "❌ /tracking/alertas/sos");
    return res.status(500).json({ ok:false, message:"Erro ao criar alerta." });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/tracking/alertas/:id/resolver
   Resolve um alerta
══════════════════════════════════════════════════════════════ */
router.post("/alertas/:id/resolver", requireOperador, async (req, res) => {
  try {
    const { resolvidoPor, observacoes, tipo } = req.body || {};
    const alerta = await SecurityAlert.findByIdAndUpdate(
      req.params.id,
      {
        status:       tipo === "falso_alarme" ? "falso_alarme" : "resolvido",
        resolvidoPor: resolvidoPor || "Admin",
        resolvidoEm:  new Date(),
        observacoes:  observacoes || "",
      },
      { new: true }
    );
    if (!alerta) return res.status(404).json({ ok:false, message:"Alerta não encontrado." });

    const io = req.app.get('io');
    if (io) io.to('seguranca').emit('alerta_resolvido', { id: String(alerta._id), status: alerta.status });

    return res.json({ ok:true, alerta });
  } catch(err) {
    logger.error({ err }, "❌ /tracking/alertas/:id/resolver");
    return res.status(500).json({ ok:false });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/tracking/alertas/:id/assumir
   Operador assume responsabilidade pelo alerta (evita duplicação)
══════════════════════════════════════════════════════════════ */
router.post("/alertas/:id/assumir", requireOperador, async (req, res) => {
  try {
    const { operador } = req.body || {};
    const alerta = await SecurityAlert.findById(req.params.id);
    if (!alerta) return res.status(404).json({ ok:false, message:"Alerta não encontrado." });
    if (alerta.assumidoPor) {
      return res.status(409).json({
        ok: false,
        code: "JA_ASSUMIDO",
        message: `Alerta já está a ser tratado por ${alerta.assumidoPor}.`,
        assumidoPor: alerta.assumidoPor,
      });
    }
    alerta.assumidoPor = operador || "Operador";
    alerta.assumidoEm  = new Date();
    await alerta.save();

    const io = req.app.get("io");
    if (io) io.to("seguranca").emit("alerta_assumido", {
      id: String(alerta._id), assumidoPor: alerta.assumidoPor
    });

    logger.info({ id: req.params.id, operador }, "✅ Alerta assumido");
    return res.json({ ok:true, alerta });
  } catch(err) {
    logger.error({ err }, "❌ /alertas/:id/assumir");
    return res.status(500).json({ ok:false });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/tracking/alertas/:id/solicitar-imagem
   Operador pede ao motorista para activar a câmara e tirar uma
   foto da situação. Notifica o motorista via socket, na sala
   driver_${driverId} (ver motorista.html → solicitar_imagem_seguranca).
══════════════════════════════════════════════════════════════ */
router.post("/alertas/:id/solicitar-imagem", requireOperador, async (req, res) => {
  try {
    const { operador } = req.body || {};
    const alerta = await SecurityAlert.findById(req.params.id).lean();
    if (!alerta) return res.status(404).json({ ok:false, message:"Alerta não encontrado." });

    // Descobrir o driverId: 1) estado em memória da viagem (o
    // caminho normal, preenchido pelo /iniciar corrigido acima);
    // 2) Reserva.motoristaId (sistema antigo); 3) Trip.driver.driverId
    // (motor de despacho unificado) — sem este terceiro caminho,
    // viagens despachadas pelo sistema novo nunca encontravam
    // motorista aqui, mesmo com a memória entretanto perdida.
    let driverId = viagensActivas.get(String(alerta.reservaId))?.motoristaInfo?.id || null;
    if (!driverId) {
      const reserva = await Reserva.findById(alerta.reservaId).select("motoristaId").lean();
      driverId = reserva?.motoristaId ? String(reserva.motoristaId) : null;
    }
    if (!driverId) {
      const trip = await Trip.findById(alerta.reservaId).select("driver.driverId").lean();
      driverId = trip?.driver?.driverId ? String(trip.driver.driverId) : null;
    }
    if (!driverId) {
      return res.status(404).json({ ok:false, message:"Não foi possível identificar o motorista desta viagem." });
    }

    const io = req.app.get("io");
    if (io) {
      io.to(`driver_${driverId}`).emit("solicitar_imagem_seguranca", {
        reservaId: String(alerta.reservaId),
        alertaId:  String(alerta._id),
        operador:  operador || "Operador",
      });
    }

    logger.info({ alertaId: req.params.id, driverId, operador }, "📷 Imagem de segurança solicitada ao motorista");
    return res.json({ ok:true, message:"Pedido de imagem enviado ao motorista." });
  } catch(err) {
    logger.error({ err }, "❌ /tracking/alertas/:id/solicitar-imagem");
    return res.status(500).json({ ok:false, message:"Erro ao solicitar imagem." });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/tracking/alertas/:id/imagem
   Motorista envia a foto pedida (multipart/form-data, campo "foto").
   Guarda em /public/uploads/seguranca e notifica os operadores
   (sala "seguranca") via imagem_seguranca_recebida.
══════════════════════════════════════════════════════════════ */
router.post("/alertas/:id/imagem", requireMotoristaOuCliente, uploadImagemSeguranca.single("foto"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok:false, message:"Nenhuma imagem recebida." });

    const fotoUrl = `/uploads/seguranca/${req.file.filename}`;
    const agora = new Date();

    const alerta = await SecurityAlert.findByIdAndUpdate(
      req.params.id,
      { imagemUrl: fotoUrl, imagemRecebidaEm: agora },
      { new: true }
    ).lean();

    const reservaId = alerta?.reservaId || req.body?.reservaId || null;

    const io = req.app.get("io");
    if (io) {
      io.to("seguranca").emit("imagem_seguranca_recebida", {
        reservaId: reservaId ? String(reservaId) : null,
        alertaId:  req.params.id,
        fotoUrl,
        createdAt: agora,
      });
    }

    logger.info({ alertaId: req.params.id, fotoUrl }, "📷 Imagem de segurança recebida do motorista");
    return res.json({ ok:true, message:"Imagem enviada com sucesso.", fotoUrl });
  } catch(err) {
    logger.error({ err }, "❌ /tracking/alertas/:id/imagem");
    return res.status(500).json({ ok:false, message:"Erro ao guardar imagem." });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/tracking/regioes
   Lista regiões com segurança activa
══════════════════════════════════════════════════════════════ */
router.get("/regioes", async (req, res) => {
  try {
    const { getRegioesActivas } = await import("../services/regiaoSeguranca.service.js");
    const regioes = await getRegioesActivas();
    return res.json({ ok:true, regioes });
  } catch(err) {
    logger.error({ err }, "❌ /tracking/regioes");
    return res.status(500).json({ ok:false });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/tracking/viagens-ativas
   Lista todas as viagens activas com posições para o painel
══════════════════════════════════════════════════════════════ */
router.get("/viagens-ativas", requireOperador, (req, res) => {
  try {
    const lista = [];
    for (const [reservaId, estado] of viagensActivas.entries()) {
      lista.push({
        reservaId,
        regiao:    estado.regiao,
        pais:      estado.pais,
        motorista: {
          ...estado.motoristaInfo,
          lat:     estado.motorista.lat,
          lng:     estado.motorista.lng,
          ts:      estado.motorista.ts,
          heading: estado.motorista.heading,
          speed:   estado.motorista.speed,
        },
        cliente: {
          ...estado.clienteInfo,
          lat: estado.cliente.lat,
          lng: estado.cliente.lng,
          ts:  estado.cliente.ts,
        },
        destino: {
          lat: estado.destinoLat,
          lng: estado.destinoLng,
        },
        origem: {
          lat: estado.origemLat,
          lng: estado.origemLng,
        },
        viagem: estado.viagemInfo || {},
        desvioInicio:  estado.desvioInicio,
        alertaEmitido: estado.alertaEmitido,
        _alertaParado: estado._alertaParado,
      });
    }
    return res.json({ ok: true, viagens: lista });
  } catch(err) {
    logger.error({ err }, "❌ /tracking/viagens-ativas");
    return res.status(500).json({ ok: false });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/tracking/partilhas-ativas
   Reservas de grupo (Reserva Flexível / Partilha) já confirmadas
   mas ainda NÃO despachadas — sem tripRefId, ainda não viraram
   uma Trip a sério. Diferente de /viagens-ativas: aqui não há
   posição em tempo real para mostrar (a viagem ainda não começou),
   só o ponto de partida partilhado, o destino de cada participante,
   e quem já confirmou/pagou. Um cartão por grupo.
══════════════════════════════════════════════════════════════ */
router.get("/partilhas-ativas", requireOperador, async (req, res) => {
  try {
    const grupos = await ShareTrip.find({
      status: { $nin: ["cancelado", "canceled", "concluido", "concluida"] },
      tripRefId: { $exists: false },
    }).sort({ scheduledAt: 1 }).lean();

    const lista = [];
    for (const g of grupos) {
      const invites = await ShareInvite.find({ shareId: g.shareId }).lean();
      const participantes = invites.map((inv) => ({
        inviteId:    inv.inviteId,
        nome:        inv.nome || "",
        contacto:    inv.contacto || "",
        pago:        !!inv.pago,
        destino:     inv.destinoParticipante?.address || null,
        destinoGeo:  inv.destinoParticipante
          ? { lat: inv.destinoParticipante.lat, lng: inv.destinoParticipante.lng }
          : null,
      }));

      lista.push({
        shareId:         g.shareId,
        nomeOrganizador: g.nomeOrganizador || "",
        categoria:       g.categoria || "",
        scheduledAt:     g.scheduledAt || null,
        // "destino" no ShareTrip é, confusamente, o ponto de
        // PARTIDA partilhado do grupo (mesma convenção já usada em
        // /partilha/evento/status — mantida aqui para não introduzir
        // uma segunda leitura diferente do mesmo campo).
        partida: g.destino
          ? { address: g.destino.address, lat: g.destino.lat, lng: g.destino.lng }
          : null,
        recolha: g.recolha
          ? { address: g.recolha.address, lat: g.recolha.lat, lng: g.recolha.lng }
          : null,
        participantes,
        totalParticipantes: participantes.length,
        totalPago: participantes.filter((p) => p.pago).length,
      });
    }

    return res.json({ ok: true, partilhas: lista });
  } catch (err) {
    logger.error({ err }, "❌ /tracking/partilhas-ativas");
    return res.status(500).json({ ok: false });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/tracking/check-in
   Motorista confirma chegada ao destino (ponto 5 do plano)
══════════════════════════════════════════════════════════════ */
router.post("/check-in", requireMotoristaOuCliente, async (req, res) => {
  try {
    const { reservaId, lat, lng } = req.body || {};
    if (!reservaId) return res.status(400).json({ ok: false, message: "reservaId obrigatório." });

    const estado = viagensActivas.get(String(reservaId));

    const io = req.app.get("io");
    if (io) {
      io.to("seguranca").emit("check_in_destino", {
        reservaId,
        lat: lat ? Number(lat) : estado?.motorista?.lat,
        lng: lng ? Number(lng) : estado?.motorista?.lng,
        motoristaNome: estado?.motoristaInfo?.nome || "",
        clienteNome:   estado?.clienteInfo?.nome   || "",
        ts: Date.now(),
      });
    }

    // Resolver alertas activos desta viagem automaticamente
    await SecurityAlert.updateMany(
      { reservaId, status: "ativo" },
      { status: "resolvido", resolvidoPor: "check-in automático", resolvidoEm: new Date() }
    );

    logger.info({ reservaId }, "✅ Check-in no destino confirmado");
    return res.json({ ok: true, message: "Chegada confirmada." });
  } catch(err) {
    logger.error({ err }, "❌ /tracking/check-in");
    return res.status(500).json({ ok: false });
  }
});

export default router;