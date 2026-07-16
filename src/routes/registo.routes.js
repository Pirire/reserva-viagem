// src/routes/reservas.routes.js
// ══════════════════════════════════════════════════════════════
// Rotas de reservas do cliente — SaaS-level
//
// Endpoints:
//   POST /api/reserva                       — criar reserva
//   POST /api/reserva/cancelar              — cancelar (autenticado)
//   POST /api/cancelar-reserva              — cancelar (público, legacy)
//   GET  /api/reservas/pendentes            — reservas ativas
//   GET  /api/reservas/motorista-atribuido  — polling de motorista
//   GET  /api/reservas/historico            — histórico paginado
//   GET  /api/reservas/:id                  — detalhe de uma reserva
//   GET  /api/paypal-client-id              — chave PayPal
//   GET  /api/stripe/public-key             — chave pública Stripe
//   POST /api/stripe/criar-intent           — PaymentIntent Stripe
// ══════════════════════════════════════════════════════════════

import { Router } from "express";
import jwt         from "jsonwebtoken";
import nodemailer   from "nodemailer";
import Colaborador  from "../models/colaboradores.js";
import Reserva          from "../models/Reserva.js";
import AdminQuoteConfig from "../models/AdminQuoteConfig.js";
import logger           from "../config/logger.js";

// ── Stripe — inicializado de forma lazy no primeiro pedido ──
// (não no topo do módulo para evitar problemas com dotenv hoisting)
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

/* ══════════════════════════════════════════════════════════════
   HELPERS DE AUTENTICAÇÃO
   Lê token do cookie httpOnly (rm_cliente_token) ou Bearer header.
   injetarCliente  — opcional (não bloqueia se sem token)
   requireCliente  — obrigatório (devolve 401 se sem token)
══════════════════════════════════════════════════════════════ */
function getClientePayload(req) {
  try {
    const secret = String(
      process.env.JWT_SECRET || process.env.CLIENT_JWT_SECRET || ""
    ).trim();
    if (!secret) return null;

    // ✅ Cookie correcto do sistema (httpOnly, definido no login)
    const cookieToken =
      req.cookies?.rm_cliente_token ||
      req.cookies?.cliente_token    ||
      req.cookies?.token            || "";

    // Fallback: Bearer header (para chamadas API sem cookie)
    const auth        = String(req.headers.authorization || "");
    const bearerToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

    const token = cookieToken || bearerToken;
    if (!token) return null;

    const payload = jwt.verify(token, secret);

    // Aceita tokens com typ:"cliente" ou sem typ (legacy)
    const typ = String(payload?.typ || "").toLowerCase();
    if (typ && typ !== "cliente") return null;

    return payload;
  } catch (_) {
    return null;
  }
}

function injetarCliente(req, _res, next) {
  const p = getClientePayload(req);
  req.clienteId    = p?.id    || null;
  req.clienteEmail = p?.email || null;
  next();
}

function requireCliente(req, res, next) {
  const p = getClientePayload(req);
  if (!p?.id) {
    return res.status(401).json({
      ok: false,
      code: "UNAUTHORIZED",
      message: "Sessão necessária. Por favor inicie sessão.",
    });
  }
  req.clienteId    = p.id;
  req.clienteEmail = p.email || null;
  next();
}

/* ══════════════════════════════════════════════════════════════
   GET /api/paypal-client-id
   Público
══════════════════════════════════════════════════════════════ */
router.get("/paypal-client-id", (_req, res) => {
  return res.json({ clientId: process.env.PAYPAL_CLIENT_ID || "" });
});

/* ══════════════════════════════════════════════════════════════
   POST /api/obter-valores
   Público — compatibilidade legacy
══════════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════════
   POST /api/reserva
   Público ou autenticado — cria nova reserva.
   Se autenticado (cookie rm_cliente_token), associa clienteId.
══════════════════════════════════════════════════════════════ */
router.post("/reserva", injetarCliente, async (req, res) => {
  try {
    const {
      nome, email, categoria, partida, destino, datahora,
      valor, portagens, km, contato, contacto,
      codigo, observacoes, origemGeo, destinoGeo, extras,
    } = req.body || {};

    // Validação
    if (!nome || !email || !categoria || !partida || !destino || !datahora || !codigo) {
      return res.status(400).json({
        ok: false, success: false,
        code: "MISSING_FIELDS",
        message: "Campos obrigatórios: nome, email, categoria, partida, destino, datahora, codigo.",
      });
    }

    const codigoNorm = String(codigo).trim().toUpperCase();
    const existe = await Reserva.findOne({ codigo: codigoNorm }).lean();
    if (existe) {
      return res.status(409).json({
        ok: false, success: false,
        code: "DUPLICATE_CODE",
        message: "Código de reserva já existe.",
      });
    }

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

/* ══════════════════════════════════════════════════════════════
   POST /api/reserva/cancelar
   Autenticado — cliente cancela pelo código (pertencente a si)
══════════════════════════════════════════════════════════════ */
router.post("/reserva/cancelar", requireCliente, async (req, res) => {
  try {
    const { tripId, codigo } = req.body || {};
    if (!tripId && !codigo) {
      return res.status(400).json({
        ok: false, code: "MISSING_FIELDS",
        message: "Indique tripId ou codigo.",
      });
    }

    const filtro = { clienteId: req.clienteId };
    if (tripId) filtro._id    = tripId;
    else        filtro.codigo = String(codigo).trim().toUpperCase();

    const reserva = await Reserva.findOne(filtro);
    if (!reserva) {
      return res.status(404).json({
        ok: false, code: "NOT_FOUND",
        message: "Reserva não encontrada ou não pertence a esta conta.",
      });
    }
    if (["concluida", "cancelada"].includes(reserva.status)) {
      return res.status(400).json({
        ok: false, code: "ALREADY_FINAL",
        message: `Esta reserva já está ${reserva.status}.`,
      });
    }

    reserva.status = "cancelada";
    await reserva.save();

    logger.info({ codigo: reserva.codigo, clienteId: req.clienteId }, "✅ Reserva cancelada (autenticado)");
    return res.json({ ok: true, message: "Reserva cancelada com sucesso.", codigo: reserva.codigo });
  } catch (err) {
    logger.error({ err }, "❌ /reserva/cancelar");
    return res.status(500).json({ ok: false, message: "Erro ao cancelar reserva." });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/cancelar-reserva
   Público (legacy) — cancela por email + código sem autenticação.
   Mantido para compatibilidade com reserva.html e formulários externos.
══════════════════════════════════════════════════════════════ */
router.post("/cancelar-reserva", async (req, res) => {
  try {
    const { email, codigo, contacto } = req.body || {};
    if (!email || !codigo) {
      return res.status(400).json({
        ok: false, success: false,
        code: "MISSING_FIELDS",
        message: "email e codigo são obrigatórios.",
      });
    }

    const reserva = await Reserva.findOne({
      email:  String(email).toLowerCase().trim(),
      codigo: String(codigo).trim().toUpperCase(),
    });

    if (!reserva) {
      return res.status(404).json({
        ok: false, success: false,
        code: "NOT_FOUND",
        message: "Reserva não encontrada. Verifique o email e o código.",
      });
    }
    if (["concluida", "cancelada"].includes(reserva.status)) {
      return res.status(400).json({
        ok: false, success: false,
        code: "ALREADY_FINAL",
        message: `Esta reserva já está ${reserva.status}.`,
      });
    }

    reserva.status = "cancelada";
    await reserva.save();

    logger.info({ codigo: reserva.codigo }, "✅ Reserva cancelada (público)");
    return res.json({ ok: true, success: true, message: "Reserva cancelada com sucesso." });
  } catch (err) {
    logger.error({ err }, "❌ /cancelar-reserva");
    return res.status(500).json({ ok: false, success: false, message: "Erro ao cancelar reserva." });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/reservas/pendentes
   Autenticado — reservas ativas do cliente
══════════════════════════════════════════════════════════════ */
router.get("/reservas/pendentes", requireCliente, async (req, res) => {
  try {
    const reservas = await Reserva.find({
      clienteId: req.clienteId,
      status:    { $in: ["pendente", "confirmada", "atribuida", "em_viagem"] },
    })
      .sort({ datahora: 1 })
      .select("codigo categoria partida destino datahora status valor pagamento")
      .lean();

    return res.json({ ok: true, reservas });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/pendentes");
    return res.status(500).json({ ok: false, message: "Erro ao obter reservas pendentes." });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/reservas/motorista-atribuido
   Autenticado — polling de motorista.
   Aceita ?codigo=RM-XXX para busca por código
   ou devolve a reserva ativa mais próxima do cliente.
══════════════════════════════════════════════════════════════ */
router.get("/reservas/motorista-atribuido", requireCliente, async (req, res) => {
  try {
    const { codigo } = req.query;

    // Filtro base — sempre pertence ao cliente autenticado
    const filtro = { clienteId: req.clienteId };

    if (codigo) {
      // Busca por código específico (polling após pagamento)
      filtro.codigo = String(codigo).trim().toUpperCase();
    } else {
      // Sem código: reserva ativa mais próxima
      filtro.status = { $in: ["atribuida", "em_viagem"] };
    }

    const reserva = await Reserva.findOne(filtro)
      .populate("motoristaId", "nome foto contacto veiculo matricula cor rating lat lng eta")
      .sort({ datahora: 1 })
      .lean();

    // Se busca por código e reserva ainda pendente → não atribuído
    if (!reserva) {
      return res.json({ ok: true, atribuido: false });
    }
    if (!["atribuida", "em_viagem"].includes(reserva.status) || !reserva.motoristaId) {
      return res.json({ ok: true, atribuido: false });
    }

    const m = reserva.motoristaId;
    return res.json({
      ok:        true,
      atribuido: true,
      tripId:    String(reserva._id),
      codigo:    reserva.codigo,
      motorista: {
        motoristaNome: m.nome      || "",
        nome:          m.nome      || "",
        foto:          m.foto      || "",
        contacto:      m.contacto  || "",
        veiculo:       m.veiculo   || "",
        matricula:     m.matricula || "",
        cor:           m.cor       || "",
        rating:        m.rating    || 5,
        lat:           m.lat       || null,
        lng:           m.lng       || null,
        eta:           m.eta       || null,
      },
    });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/motorista-atribuido");
    return res.status(500).json({ ok: false, message: "Erro ao verificar motorista." });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/reservas/historico
   Autenticado — histórico paginado
   Query: ?pagina=1&limite=10
══════════════════════════════════════════════════════════════ */
router.get("/reservas/historico", requireCliente, async (req, res) => {
  try {
    const pagina = Math.max(1, Number(req.query.pagina  || 1));
    const limite = Math.min(50, Math.max(1, Number(req.query.limite || 10)));
    const skip   = (pagina - 1) * limite;

    const [reservas, total] = await Promise.all([
      Reserva.find({ clienteId: req.clienteId })
        .sort({ datahora: -1 })
        .skip(skip)
        .limit(limite)
        .select("codigo categoria partida destino datahora status valor pagamento createdAt")
        .lean(),
      Reserva.countDocuments({ clienteId: req.clienteId }),
    ]);

    return res.json({
      ok: true,
      reservas,
      paginacao: {
        total,
        pagina,
        limite,
        totalPaginas: Math.ceil(total / limite),
      },
    });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/historico");
    return res.status(500).json({ ok: false, message: "Erro ao obter histórico." });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/reservas/:id
   Autenticado — detalhe de uma reserva do cliente
══════════════════════════════════════════════════════════════ */
router.get("/reservas/:id", requireCliente, async (req, res) => {
  try {
    const reserva = await Reserva.findOne({
      _id:       req.params.id,
      clienteId: req.clienteId,
    })
      .populate("motoristaId", "nome foto contacto veiculo matricula rating")
      .lean();

    if (!reserva) {
      return res.status(404).json({
        ok: false, code: "NOT_FOUND",
        message: "Reserva não encontrada.",
      });
    }
    return res.json({ ok: true, reserva });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/:id");
    return res.status(500).json({ ok: false, message: "Erro ao obter reserva." });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/stripe/public-key
   Público — chave pública Stripe para o frontend
══════════════════════════════════════════════════════════════ */
router.get("/stripe/public-key", (_req, res) => {
  const key = process.env.STRIPE_PUBLIC_KEY || "";
  if (!key) {
    logger.warn("⚠️ STRIPE_PUBLIC_KEY não definido");
    return res.json({ publicKey: null });
  }
  return res.json({ publicKey: key });
});

/* ══════════════════════════════════════════════════════════════
   POST /api/stripe/criar-intent
   Público — cria PaymentIntent para uma reserva.
   Devolve clientSecret usado pelo frontend (Stripe.js).
══════════════════════════════════════════════════════════════ */
router.post("/stripe/criar-intent", async (req, res) => {
  try {
    const stripe = await getStripe();
    if (!stripe) {
      return res.status(503).json({
        ok: false,
        code: "STRIPE_NOT_CONFIGURED",
        message: "Stripe não configurado. Adicione STRIPE_SECRET_KEY no .env.",
      });
    }

    const valor     = Number(req.body?.valor    || 0);
    const descricao = String(req.body?.descricao || "Reserva REALMETROPOLIS").slice(0, 127);

    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({
        ok: false,
        code: "INVALID_AMOUNT",
        message: "Valor inválido para pagamento.",
      });
    }

    const intent = await stripe.paymentIntents.create({
      amount:      Math.round(valor * 100), // em cêntimos
      currency:    "eur",
      description: descricao,
      automatic_payment_methods: { enabled: true },
    });

    logger.info({ valor, descricao }, "✅ Stripe PaymentIntent criado");
    return res.json({ ok: true, clientSecret: intent.client_secret });
  } catch (err) {
    logger.error({ err }, "❌ /stripe/criar-intent");
    return res.status(500).json({
      ok: false,
      code: "STRIPE_ERROR",
      message: err?.message || "Erro ao criar pagamento Stripe.",
    });
  }
});


/* ══════════════════════════════════════════════════════════════
   UTILITÁRIO: EMAIL DE CONFIRMAÇÃO (nodemailer)
══════════════════════════════════════════════════════════════ */

function createSmtp() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT  || 587);
  const user = String(process.env.SMTP_USER  || "").trim();
  const pass = String(process.env.SMTP_PASS  || "").trim();
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

function esc(t) {
  return String(t ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function fmtData(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-PT", {
    day:"2-digit", month:"2-digit", year:"numeric",
    hour:"2-digit", minute:"2-digit", timeZone:"Europe/Lisbon"
  });
}

async function enviarEmailTicketViagem({ to, reserva, assunto }) {
  const transporter = createSmtp();
  const from = String(process.env.SMTP_FROM || process.env.SMTP_USER || "").trim();
  if (!transporter || !from) {
    logger.warn("⚠️ SMTP não configurado — email de confirmação não enviado");
    return { sent: false };
  }
  const { codigo, nome, contacto, categoria, partida, destino, datahora, valor } = reserva;
  const portagens = reserva.extras?.portagens || reserva.portagens || 0;
  const km        = reserva.extras?.km        || reserva.km        || 0;

  const html = `<!DOCTYPE html>
<html lang="pt"><body style="margin:0;padding:0;background:#050507;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0"
  style="background:linear-gradient(180deg,#0e1012,#08090b);border:1px solid rgba(196,201,212,.18);border-radius:18px;overflow:hidden;max-width:580px;width:100%;">
  <tr>
    <td style="padding:24px 28px 18px;border-bottom:1px solid rgba(196,201,212,.10);">
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="width:44px;height:44px;border-radius:50%;border:1.5px solid rgba(196,201,212,.35);text-align:center;vertical-align:middle;background:#0a0c0f;color:#c4c9d4;font-weight:900;font-size:12px;">RM</td>
        <td style="padding-left:12px;color:#c4c9d4;font-size:15px;font-weight:900;letter-spacing:.12em;">REALMETROPOLIS</td>
      </tr></table>
    </td>
  </tr>
  <tr><td style="padding:28px 28px 24px;">
    <p style="font-size:28px;margin:0 0 10px;">✅</p>
    <p style="color:#edf0f5;font-size:20px;font-weight:900;margin:0 0 8px;">Reserva Confirmada</p>
    <p style="color:#8b95a2;font-size:13px;margin:0 0 22px;line-height:1.55;">
      Olá <b style="color:#c4c9d4;">${esc(nome)}</b>, o seu pagamento foi processado e a viagem está confirmada.
    </p>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:22px;background:rgba(25,214,139,.06);border:1px solid rgba(25,214,139,.22);border-radius:12px;">
      <tr><td style="padding:16px 20px;">
        <p style="margin:0 0 4px;color:#5f6874;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;">Código de Reserva</p>
        <p style="margin:0;color:#19d68b;font-size:22px;font-weight:900;letter-spacing:.16em;">${esc(codigo)}</p>
        <p style="margin:6px 0 0;color:#5f6874;font-size:11px;line-height:1.5;">Guarde este código — necessário para cancelar a reserva.</p>
      </td></tr>
    </table>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:22px;background:rgba(196,201,212,.05);border:1px solid rgba(196,201,212,.12);border-radius:12px;overflow:hidden;">
      ${contacto ? `<tr style="border-bottom:1px solid rgba(196,201,212,.08);">
        <td style="padding:11px 16px;width:38%;background:rgba(0,0,0,.15);"><p style="margin:0;color:#5f6874;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Contacto</p></td>
        <td style="padding:11px 16px;"><p style="margin:0;color:#edf0f5;font-size:13px;font-weight:700;">${esc(contacto)}</p></td>
      </tr>` : ""}
      <tr style="border-bottom:1px solid rgba(196,201,212,.08);">
        <td style="padding:11px 16px;background:rgba(0,0,0,.15);"><p style="margin:0;color:#5f6874;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Recolha</p></td>
        <td style="padding:11px 16px;"><p style="margin:0;color:#edf0f5;font-size:13px;font-weight:700;">${esc(partida)}</p></td>
      </tr>
      <tr style="border-bottom:1px solid rgba(196,201,212,.08);">
        <td style="padding:11px 16px;background:rgba(0,0,0,.15);"><p style="margin:0;color:#5f6874;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Destino</p></td>
        <td style="padding:11px 16px;"><p style="margin:0;color:#edf0f5;font-size:13px;font-weight:700;">${esc(destino)}</p></td>
      </tr>
      <tr style="border-bottom:1px solid rgba(196,201,212,.08);">
        <td style="padding:11px 16px;background:rgba(0,0,0,.15);"><p style="margin:0;color:#5f6874;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Data e Hora</p></td>
        <td style="padding:11px 16px;"><p style="margin:0;color:#edf0f5;font-size:13px;font-weight:700;">${fmtData(datahora)}</p></td>
      </tr>
      <tr style="border-bottom:1px solid rgba(196,201,212,.08);">
        <td style="padding:11px 16px;background:rgba(0,0,0,.15);"><p style="margin:0;color:#5f6874;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Categoria</p></td>
        <td style="padding:11px 16px;"><p style="margin:0;color:#edf0f5;font-size:13px;font-weight:700;">${esc(categoria)}</p></td>
      </tr>
      ${km ? `<tr style="border-bottom:1px solid rgba(196,201,212,.08);">
        <td style="padding:11px 16px;background:rgba(0,0,0,.15);"><p style="margin:0;color:#5f6874;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Distância</p></td>
        <td style="padding:11px 16px;"><p style="margin:0;color:#edf0f5;font-size:13px;font-weight:700;">${Number(km).toFixed(1)} km</p></td>
      </tr>` : ""}
      ${Number(portagens) > 0 ? `<tr style="border-bottom:1px solid rgba(196,201,212,.08);">
        <td style="padding:11px 16px;background:rgba(0,0,0,.15);"><p style="margin:0;color:#5f6874;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Portagens</p></td>
        <td style="padding:11px 16px;"><p style="margin:0;color:#edf0f5;font-size:13px;font-weight:700;">€${Number(portagens).toFixed(2)}</p></td>
      </tr>` : ""}
      <tr>
        <td style="padding:14px 16px;background:rgba(0,0,0,.25);"><p style="margin:0;color:#19d68b;font-size:10px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;">Total Pago</p></td>
        <td style="padding:14px 16px;background:rgba(0,0,0,.1);"><p style="margin:0;color:#19d68b;font-size:18px;font-weight:900;">€${Number(valor || 0).toFixed(2)}</p></td>
      </tr>
    </table>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:22px;background:rgba(255,159,67,.05);border:1px solid rgba(255,159,67,.2);border-radius:12px;">
      <tr><td style="padding:14px 18px;">
        <p style="margin:0 0 6px;color:#ffd09b;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">ℹ️ Cancelamento</p>
        <p style="margin:0;color:#8b95a2;font-size:12px;line-height:1.6;">
          Cancelamento gratuito até <b style="color:#c4c9d4;">30 minutos</b> antes da hora marcada.<br>
          Use o código <b style="color:#c4c9d4;">${esc(codigo)}</b> na área de cancelamento do portal.
        </p>
      </td></tr>
    </table>
    <p style="color:#434a55;font-size:11px;border-top:1px solid rgba(196,201,212,.08);padding-top:16px;margin:0;line-height:1.6;">
      Em caso de dúvidas contacte o nosso suporte.<br>Este email foi gerado automaticamente.
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  await transporter.sendMail({ from, to, subject: assunto || `✅ Reserva ${esc(codigo)} Confirmada | REALMETROPOLIS`, html });
  return { sent: true };
}

/* ══════════════════════════════════════════════════════════════
   POST /api/reservas/enviar-confirmacao
   Público — chamado após pagamento bem-sucedido no frontend.
   Aceita: { codigo } — envia email ao cliente com o ticket.
══════════════════════════════════════════════════════════════ */
router.post("/reservas/enviar-confirmacao", injetarCliente, async (req, res) => {
  try {
    const codigo = String(req.body?.codigo || "").trim().toUpperCase();
    if (!codigo) return res.status(400).json({ ok: false, message: "Código ausente." });

    const reserva = await Reserva.findOne({ codigo }).lean();
    if (!reserva) return res.status(404).json({ ok: false, message: "Reserva não encontrada." });

    // Actualizar pagamento como pago
    await Reserva.updateOne({ codigo }, {
      $set: {
        "pagamento.status": "pago",
        "pagamento.paidAt": new Date(),
        status: "confirmada",
      }
    });

    // Enviar email ao cliente
    const result = await enviarEmailTicketViagem({
      to:     reserva.email,
      reserva,
      assunto: `✅ Reserva ${codigo} Confirmada | REALMETROPOLIS`,
    });

    logger.info({ codigo, sent: result.sent }, "✅ Email de confirmação enviado (cliente)");
    return res.json({ ok: true, sent: result.sent });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/enviar-confirmacao");
    return res.status(500).json({ ok: false, message: "Erro ao enviar email." });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/reservas/confirmar-pagamento-ticket
   Chamado após o hóspede pagar o ticket gerado pelo hotel.
   Actualiza: reserva.extras.ticketPago = true, pagamento.status = "pago"
   Notifica: envia email ao hóspede + notifica hotel via status
══════════════════════════════════════════════════════════════ */
router.post("/reservas/confirmar-pagamento-ticket", async (req, res) => {
  try {
    const token = String(req.body?.token || req.query?.token || "").trim();
    if (!token) return res.status(400).json({ ok: false, message: "Token ausente." });

    const reserva = await Reserva.findOne({ "extras.tokenTicket": token });
    if (!reserva) return res.status(404).json({ ok: false, message: "Ticket não encontrado." });

    if (reserva.extras?.ticketPago) {
      return res.json({ ok: true, jaProcessado: true, message: "Ticket já foi pago." });
    }

    // Marcar como pago
    reserva.extras.ticketPago       = true;
    reserva.pagamento.status        = "pago";
    reserva.pagamento.paidAt        = new Date();
    reserva.status                  = "confirmada";
    await reserva.save();

    // Email ao hóspede
    try {
      await enviarEmailTicketViagem({
        to:     reserva.email,
        reserva,
        assunto: `✅ Viagem Confirmada — ${reserva.codigo} | REALMETROPOLIS`,
      });
    } catch (eErr) {
      logger.warn({ err: eErr }, "⚠️ Email hóspede falhou mas ticket marcado como pago");
    }

    logger.info({ codigo: reserva.codigo, token }, "✅ Pagamento de ticket confirmado");
    return res.json({ ok: true, codigo: reserva.codigo, message: "Pagamento confirmado. Email enviado ao hóspede." });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/confirmar-pagamento-ticket");
    return res.status(500).json({ ok: false, message: "Erro ao confirmar pagamento." });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/reservas/hotel
   Autenticado (parceiro) — lista reservas/tickets do hotel.
   Filtro por status: pago | pendente | cancelado
══════════════════════════════════════════════════════════════ */
router.get("/reservas/hotel", async (req, res) => {
  try {
    // Identificar colaborador pelo cookie de parceiro
    const cookieToken =
      req.cookies?.parceiro_token || req.cookies?.colaborador_token ||
      req.cookies?.rm_colaborador_token || req.cookies?.token || "";
    const bearerToken = String(req.headers.authorization || "").startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim() : "";
    const rawToken = cookieToken || bearerToken;
    if (!rawToken) return res.status(401).json({ ok: false, message: "Não autenticado." });

    const jwt = (await import("jsonwebtoken")).default;
    const secret = String(process.env.JWT_SECRET || "").trim();
    let payload;
    try { payload = jwt.verify(rawToken, secret); } catch {
      return res.status(401).json({ ok: false, message: "Sessão inválida." });
    }

    const colaboradorId = payload.id || payload._id;
    if (!colaboradorId) return res.status(401).json({ ok: false, message: "Sessão inválida." });

    const statusFiltro = req.query.status; // pago | pendente | cancelado | all
    const query = { colaboradorId };

    if (statusFiltro && statusFiltro !== "all") {
      if (statusFiltro === "pago")     query["extras.ticketPago"] = true;
      if (statusFiltro === "pendente") query["extras.ticketPago"] = { $ne: true };
      if (statusFiltro === "cancelado") query.status = "cancelada";
    }

    const reservas = await Reserva.find(query)
      .sort({ createdAt: -1 })
      .select("codigo nome email contacto categoria partida destino datahora valor status pagamento extras createdAt")
      .lean();

    // Normalizar status para o frontend
    const lista = reservas.map(r => ({
      ...r,
      statusPagamento:
        r.status === "cancelada"       ? "cancelado"
        : r.extras?.ticketPago          ? "pago"
        : r.pagamento?.status === "pago" ? "pago"
        : "pendente",
    }));

    return res.json({ ok: true, reservas: lista });
  } catch (err) {
    logger.error({ err }, "❌ /reservas/hotel");
    return res.status(500).json({ ok: false, message: "Erro ao carregar reservas." });
  }
});

export default router;