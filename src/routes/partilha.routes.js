// src/routes/partilha.routes.js
import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import Cliente from "../models/Cliente.js";
import Motorista from "../models/Motorista.js";
import ShareInvite from "../models/ShareInvite.js";
import ShareTrip from "../models/ShareTrip.js";
import Trip from "../models/Trip.js";
import Veiculo from "../models/Veiculo.js";
import { getConfig, calcularPreco } from "./quote.routes.js";
// Sem chave Google Maps configurada (GOOGLE_MAPS_API_KEY), e sem
// custos/configuração extra: o resto da aplicação (reserva.html,
// rm-core.js) já usa OSRM (router.project-osrm.org) para distância
// de condução real, gratuito e sem chave. Esta rota usava o Google
// Directions, que falhava sempre sem a chave e caía para linha
// recta — subestimando sempre o preço (causa real da diferença de
// valores vista em produção: ~€56 estimado vs ~€36 cobrado).
//
// rotaOsrm() é o ÚNICO ponto de cálculo de distância de condução
// nesta rota — nunca duplicar esta chamada; reutilizar sempre esta
// função para que uma eventual correcção futura (timeout, fallback,
// etc.) se aplique a todos os cálculos de uma só vez.
const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";
const OSRM_TIMEOUT_MS = 8000;

async function rotaOsrm(pontosLatLng) {
  // pontosLatLng: array de { lat, lng }, na ordem origem→...→destino
  if (!Array.isArray(pontosLatLng) || pontosLatLng.length < 2) {
    throw new Error("rotaOsrm requer pelo menos 2 pontos.");
  }
  const coordsStr = pontosLatLng.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `${OSRM_BASE}/${coordsStr}?overview=false`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: controller.signal });
    const data = await r.json();
    if (data.code !== "Ok" || !data.routes?.length) {
      throw new Error(`OSRM devolveu code="${data.code}"`);
    }
    const route = data.routes[0];
    return {
      kmTotal: Number((route.distance / 1000).toFixed(2)),
      // distância de cada perna (origem→p1, p1→p2, ..., últ→destino),
      // necessária para o split multi-paragem.
      legsKm: route.legs.map((l) => Number((l.distance / 1000).toFixed(2))),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// Nunca falhar — se o OSRM estiver em baixo, lento, ou devolver erro,
// cai para linha recta. O projecto NUNCA deve parar por causa disto;
// um valor aproximado é sempre melhor do que nenhum valor.
async function distanciaComFallback(pontosLatLng) {
  try {
    const r = await rotaOsrm(pontosLatLng);
    return { kmTotal: r.kmTotal, legsKm: r.legsKm, viaCondução: true };
  } catch (err) {
    console.warn("⚠️ [partilha] OSRM falhou, a usar linha recta como reserva:", err.message);
    const legsKm = [];
    for (let i = 0; i < pontosLatLng.length - 1; i++) {
      legsKm.push(haversineKm(pontosLatLng[i], pontosLatLng[i + 1]));
    }
    return { kmTotal: legsKm.reduce((a, b) => a + b, 0), legsKm, viaCondução: false };
  }
}
import { finalizeSharedTrip } from "../services/shareFinalize.service.js";
import { criarEDespacharViagem } from "../services/criarEDespacharViagem.service.js";
import { notificarConvite } from "../services/notificarConvite.service.js";
import { criarShortLink } from "./shortlink.js";
import { paypalRefundCapture } from "./payments.routes.js";

// ✅ IMPORT "safe" (não quebra se teu smsTwilio.js não exportar canSendSms)
import * as smsModule from "../modules/notifications/smsTwilio.js";
import { requireCliente, requireClienteOuParceiro } from "../utils/clienteAuth.js";

const router = Router();
console.log("✅ partilha.routes.js carregado");

/* ==============================
   HELPERS
============================== */

// ✅ Canonicaliza contactos para formato único (E.164)
function normContact(raw) {
  let s = String(raw || "").trim().replace(/\s+/g, "");
  if (!s) return "";

  if (s.startsWith("00")) s = "+" + s.slice(2);
  s = s.replace(/[^\d+]/g, "");

  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return "";

  if (!s.startsWith("+")) {
    if (digits.length === 9 && (digits.startsWith("9") || digits.startsWith("2"))) {
      return "+351" + digits;
    }
    if (digits.startsWith("351")) return "+" + digits;
    return "+" + digits;
  }
  return "+" + digits;
}

function contactVariants(raw) {
  const c = normContact(raw);
  if (!c) return [];

  const digits = c.replace(/[^\d]/g, "");
  const variants = new Set([
    c,
    digits,
  ]);

  if (digits.startsWith("351") && digits.length === 12) {
    const local9 = digits.slice(3);
    variants.add(local9);
    variants.add("+351" + local9);
    variants.add("+" + digits);
  }

  return Array.from(variants);
}

const CONTACT_FIELDS = ["contacto", "telefone", "telemovel", "phone", "whatsapp"];

async function findPersonByContact(raw) {
  const variants = contactVariants(raw);
  if (!variants.length) return null;

  const buildOr = () =>
    CONTACT_FIELDS.flatMap((field) => variants.map((v) => ({ [field]: v })));

  const [cliente, motorista] = await Promise.all([
    Cliente.findOne({ $or: buildOr() }).lean(),
    Motorista.findOne({ $or: buildOr() }).lean(),
  ]);

  if (cliente) {
    return {
      tipo: "cliente",
      nome: cliente.nome || cliente.name || "Cliente",
      contacto:
        cliente.contacto ||
        cliente.telefone ||
        cliente.telemovel ||
        cliente.phone ||
        raw,
      raw: cliente,
    };
  }

  if (motorista) {
    return {
      tipo: "motorista",
      nome: motorista.nome || motorista.name || "Motorista",
      contacto:
        motorista.contacto ||
        motorista.telefone ||
        motorista.telemovel ||
        motorista.phone ||
        raw,
      raw: motorista,
    };
  }

  return null;
}

function money2(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function getInviteSecret() {
  const secret = String(process.env.INVITE_JWT_SECRET || process.env.JWT_SECRET || "").trim();
  if (!secret) throw new Error("INVITE_JWT_SECRET (ou JWT_SECRET) não definido.");
  return secret;
}

function genShareId() {
  return "SHR-" + crypto.randomBytes(6).toString("hex").toUpperCase();
}

function genInviteId() {
  return "INV-" + crypto.randomBytes(10).toString("hex");
}

function genOtp6() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function parseDateTime(dtRaw) {
  const s = String(dtRaw || "").trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return t;
}

function requireMin1h(tMillis) {
  // ⚠️⚠️⚠️ MODO DE TESTE — limite baixado de 1 HORA para 1 MINUTO ⚠️⚠️⚠️
  // Para testar o despacho sem esperar 1 hora. REPOR ANTES DE PRODUÇÃO:
  //   const min = Date.now() + 60 * 60 * 1000;   // <-- valor REAL (1 hora)
  const min = Date.now() + 1 * 60 * 1000;         // <-- TESTE (1 minuto)
  return tMillis >= min;
}

function hasLocation(d) {
  // IMPORTANTE: Number(null) === 0 e Number.isFinite(0) === true.
  // Sem esta verificação explícita, um convite que NUNCA recebeu uma
  // actualização de GPS (lat/lng ainda no valor default: null do schema)
  // era erradamente tratado como "tem localização válida em (0,0)".
  // É por isso que o estado "localizado" podia aparecer para convidados
  // que nunca abriram o link, nunca aceitaram, e cujo contacto pode nem
  // corresponder a uma conta real — o bug era de tipo, não de dados.
  if (d?.lat == null || d?.lng == null) return false;
  const lat = Number(d.lat);
  const lng = Number(d.lng);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function statusUi(d) {
  const s = String(d?.status || "").toLowerCase();
  if (s === "cancelado" || s === "canceled") return "cancelado";
  if (s === "aceitou") return "aceitou";
  if (d?.usedAt) return "aceitou";
  if (hasLocation(d)) return "localizado";
  return "pendente";
}

// ✅ base URL público (para link do SMS)
function getPublicBaseUrl() {
  const a = String(process.env.PUBLIC_BASE_URL || "").trim();
  if (a) return a.replace(/\/+$/, "");

  const b = String(process.env.FRONTEND_URL || "").trim();
  if (b) return b.replace(/\/+$/, "");

  return "http://localhost:10000";
}

// ✅ envio de SMS "safe"
function canSendSms() {
  const flag = String(process.env.SMS_ENABLED || "").trim();
  if (flag && (flag === "0" || flag.toLowerCase() === "false")) return false;

  const sid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const tok = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const from = String(process.env.TWILIO_FROM || "").trim();
  return !!(sid && tok && from);
}

async function sendSmsSafe(to, body) {
  const fn = smsModule.sendSms || smsModule.default;
  if (typeof fn !== "function") {
    console.warn("⚠️ smsTwilio.js não tem sendSms(). SMS não enviado.");
    return;
  }
  await fn(to, body);
}

/* ==============================
   MIDDLEWARE: validar sessionToken (convidado)
============================== */
// ── Stripe (só para reembolsos — a criação de payment intents já
// existe em reservas.routes.js) ──────────────────────────────────
let _stripe = null;
async function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    const Stripe = (await import("stripe")).default;
    _stripe = new Stripe(key, { apiVersion: "2023-10-16" });
  } catch (e) {
    console.error("❌ [partilha] Falha ao inicializar Stripe:", e?.message);
  }
  return _stripe;
}

function requireShareSession(req, res, next) {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  if (!token) {
    return res.status(401).json({
      ok: false,
      message: "Bearer sessionToken em falta.",
    });
  }

  let payload;
  try {
    payload = jwt.verify(token, getInviteSecret());
  } catch {
    return res.status(401).json({
      ok: false,
      message: "sessionToken expirado ou inválido.",
    });
  }

  if (payload?.typ !== "share_session") {
    return res.status(401).json({
      ok: false,
      message: "sessionToken inválido.",
    });
  }

  req.shareSession = payload;
  return next();
}

/* ==============================
   PROBES
============================== */
router.get("/__partilha_ok", (_req, res) =>
  res.json({ ok: true, where: "partilha.routes.js" })
);

router.get("/ping", (_req, res) =>
  res.json({ ok: true, pong: true })
);

/* ==============================
   1) CONFIRMAR CONTACTO
============================== */
router.post("/confirmar-contacto", async (req, res) => {
  try {
    const contacto = normContact(req.body?.contacto);

    if (!contacto) {
      return res.status(400).json({
        ok: false,
        message: "contacto obrigatório.",
      });
    }

    const pessoa = await findPersonByContact(contacto);

    if (!pessoa) {
  return res.json({
    ok: true,
    contacto,
    nome: "Participante",
    tipo: "externo",
    isNew: true
  });
}

    return res.json({
      ok: true,
      contacto: normContact(pessoa.contacto || contacto),
      nome: pessoa.nome,
      tipo: pessoa.tipo,
    });
  } catch (err) {
    console.error("❌ confirmar-contacto:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro interno.",
    });
  }
});

/* ==============================
   2) CRIAR PARTILHA + ENVIAR SMS (com LINK)
============================== */
router.post("/criar", async (req, res) => {
  try {
    const destino = req.body?.destino;
    const totalPessoas = Number(req.body?.totalPessoas || 0);
    const list = Array.isArray(req.body?.participantes) ? req.body.participantes : [];
    const categoria = String(req.body?.categoria || "economica");
    const dateTimeRaw = req.body?.dateTime;

    // Página onde o link de aceitação do convite deve abrir — a
    // partilha pode ser criada tanto em minha-conta.html como em
    // hotel-dashboard.html (ou outras futuras), por isso o link tem
    // de respeitar a origem do pedido em vez de estar fixo num só
    // ficheiro. Validado contra uma lista branca por segurança
    // (nunca usar o valor recebido sem validar — evita open redirect).
    const PAGINAS_PARTILHA_VALIDAS = ["minha-conta.html", "hotel-dashboard.html"];
    const paginaOrigemRaw = String(req.body?.origemPagina || "").trim();
    const paginaOrigem = PAGINAS_PARTILHA_VALIDAS.includes(paginaOrigemRaw)
      ? paginaOrigemRaw
      : "minha-conta.html";

    // Nome de quem está a solicitar a partilha, para aparecer no SMS
    // ("Carlos convidou-o para uma viagem"). Limitado a 60 caracteres
    // e sem quebras de linha — é texto livre vindo do cliente, nunca
    // deve ser inserido sem sanitizar num SMS.
    const nomeOrganizador = String(req.body?.nomeOrganizador || "")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, 60);

    const emailOrganizador = String(req.body?.emailOrganizador || "")
      .trim()
      .toLowerCase()
      .slice(0, 120);

    // Canal de notificação — default "sms" para não partir chamadas
    // antigas do minha-conta.html (que só enviavam por SMS antes).
    const notifMethod = ["sms", "email", "ambos"].includes(req.body?.notifMethod)
      ? req.body.notifMethod
      : "sms";

    if (!destino?.lat || !destino?.lng) {
      return res.status(400).json({
        ok: false,
        message: "destino (lat/lng) obrigatório.",
      });
    }

    if (!Number.isFinite(totalPessoas) || totalPessoas < 1 || totalPessoas > 17) {
      return res.status(400).json({
        ok: false,
        message: "totalPessoas inválido (1..17).",
      });
    }

    if (list.length !== totalPessoas) {
      return res.status(400).json({
        ok: false,
        message: "participantes deve ter o mesmo tamanho de totalPessoas.",
      });
    }

    const t = parseDateTime(dateTimeRaw);
    if (!t) {
      return res.status(400).json({
        ok: false,
        message: "dateTime obrigatório (formato ISO).",
      });
    }

    if (!requireMin1h(t)) {
      return res.status(400).json({
        ok: false,
        message: "A reserva deve ter no mínimo 1h de antecedência.",
      });
    }

    const secret = getInviteSecret();
    const shareId = genShareId();

    await ShareTrip.create({
      shareId,
      destino: {
        address: String(destino.address || ""),
        lat: Number(destino.lat),
        lng: Number(destino.lng),
      },
      recolha: {
        address: String(req.body?.recolha || ""),
        lat: req.body?.recolhaLat != null ? Number(req.body.recolhaLat) : null,
        lng: req.body?.recolhaLng != null ? Number(req.body.recolhaLng) : null,
      },
      nomeOrganizador,
      emailOrganizador,
      categoria,
      status: "active",
      scheduledAt: t,
      createdAt: Date.now(),
    });

    const publicBase = getPublicBaseUrl();
    const out = [];

    for (const p of list) {
      const contacto = normContact(p?.contacto);
      const nome = String(p?.nome || "Participante").trim() || "Participante";
      if (!contacto) continue;

      const inviteId = genInviteId();
      const otp = genOtp6();
      const otpHash = await bcrypt.hash(otp, 10);
      const contactoNorm = normContact(contacto);

      await ShareInvite.updateOne(
        { shareId, contactoNorm },
        {
          $set: {
            inviteId,
            shareId,
            contacto,
            contactoNorm,
            nome,
            otpHash,
            otpExpiresAt: Date.now() + 10 * 60 * 1000,
            inviteExpiresAt: Date.now() + 2 * 60 * 60 * 1000,
            attempts: 0,
            usedAt: null,
            status: "pendente",
            createdAt: Date.now(),
            scheduledAt: t,
          },
        },
        { upsert: true }
      );

      const inviteToken = jwt.sign(
        { typ: "share_invite", inviteId, shareId, contacto },
        secret,
        { expiresIn: "2h" }
      );

      const link = `${publicBase}/${paginaOrigem}?invite=${encodeURIComponent(inviteToken)}&shareId=${encodeURIComponent(shareId)}`;
      console.log("🔗 LINK GERADO:", link);
      const smsBody =
        `De ${nomeOrganizador || "REALMETROPOLIS"}. Convite para partilhar uma viagem.\n` +
        `CLIQUE AQUI PARA PARTICIPAR:\n` +
        `${link}\n` +
        `Código de acesso: ${otp}`;
      const emailHtml =
        `<p>De <b>${nomeOrganizador || "REALMETROPOLIS"}</b>.</p>` +
        `<p>Foi convidado para partilhar uma viagem.</p>` +
        `<p><a href="${link}">Clique aqui para participar</a></p>` +
        `<p>Código de acesso: <b>${otp}</b></p>`;

      const emailParticipante = String(p?.email || "").trim().toLowerCase();
      const nRes = await notificarConvite({
        metodo:      notifMethod,
        contacto:    contactoNorm,   // E.164, não o input bruto
        email:       emailParticipante,
        smsBody,
        emailSubject: "Convite — Partilhar viagem REALMETROPOLIS",
        emailHtml,
      });

      if (!nRes.entregue) {
        console.warn(`⚠️ [partilha] NENHUM canal entregou para ${nome} — motivos:`,
          nRes.erros.map(e => `${e.canal}: ${e.motivo}`).join(" | "));
      }

      out.push({
        contacto,
        nome,
        status:       nRes.entregue ? "pendente" : "erro_envio",
        link,
        smsEnviado:   nRes.smsEnviado,
        emailEnviado: nRes.emailEnviado,
        erros:        nRes.erros,
      });
    }

    const totalEnviados  = out.filter(p => p.status === "pendente").length;
    const totalFalharam  = out.length - totalEnviados;
    const totalSmsEnviados   = out.filter(p => p.smsEnviado).length;
    const totalEmailEnviados = out.filter(p => p.emailEnviado).length;

    // Bloqueio de "sucesso mudo" — se ninguém recebeu, é 502
    // com os motivos para diagnóstico.
    if (totalEnviados === 0 && out.length > 0) {
      const motivosUnicos = [...new Set(out.flatMap(p => (p.erros || []).map(e => `${e.canal}: ${e.motivo}`)))];
      return res.status(502).json({
        ok: false,
        shareId,
        message: "Nenhum convite foi entregue. Verifique a configuração do serviço de SMS/email.",
        motivos: motivosUnicos,
        participantes: out,
      });
    }

    return res.json({
      ok: true,
      shareId,
      participantes: out,
      totalEnviados,
      totalFalharam,
      totalSmsEnviados,
      totalEmailEnviados,
      publicLinkHint: `${publicBase}/${paginaOrigem}?shareId=${encodeURIComponent(shareId)}`,
    });
  } catch (err) {
    console.error("❌ criar partilha:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro interno.",
    });
  }
});

/* ==============================
   3) STATUS (para polling UI)
============================== */
router.get("/status", async (req, res) => {
  try {
    const shareId = String(req.query?.shareId || "").trim();
    if (!shareId) {
      return res.status(400).json({
        ok: false,
        message: "shareId obrigatório.",
      });
    }

    const docs = await ShareInvite.find({ shareId }).sort({ createdAt: -1 }).lean();

    const map = new Map();
    for (const d of docs) {
      const key = normContact(d.contactoNorm || d.contacto);
      if (!map.has(key)) map.set(key, d);
    }

    const participantes = Array.from(map.values()).map((d) => ({
      contacto: d.contacto,
      nome: d.nome || "Participante",
      status: statusUi(d),
      valor: money2(d.amountDue ?? d.valorFinal ?? 0),
      paymentUrl: d.paymentUrl || "",
    }));

    return res.json({ ok: true, shareId, participantes });
  } catch (err) {
    console.error("❌ status:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro interno.",
    });
  }
});

/* ==============================
   4) CANCELAR
============================== */
router.post("/cancelar", async (req, res) => {
  try {
    const shareId = String(req.body?.shareId || "").trim();
    if (!shareId) {
      return res.status(400).json({
        ok: false,
        message: "shareId obrigatório.",
      });
    }

    await ShareTrip.updateOne(
      { shareId },
      { $set: { status: "canceled", canceledAt: Date.now() } }
    );

    await ShareInvite.updateMany(
      { shareId },
      { $set: { status: "cancelado", canceledAt: Date.now() } }
    );

    return res.json({ ok: true, shareId });
  } catch (err) {
    console.error("❌ cancelar:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro interno.",
    });
  }
});

/* ==============================
   VERIFY (convidado)
============================== */
router.post("/invite/verify", async (req, res) => {
  try {
    const invite = String(req.body?.invite || "").trim();
    const otp = String(req.body?.otp || "").trim();

    if (!invite || !otp) {
      return res.status(400).json({
        ok: false,
        message: "invite e otp são obrigatórios.",
      });
    }

    const secret = getInviteSecret();

    let payload;
    try {
      payload = jwt.verify(invite, secret);
    } catch (e) {
      const isExpired = e?.name === "TokenExpiredError";
      return res.status(401).json({
        ok: false,
        message: isExpired ? "Convite expirado." : "Convite inválido.",
      });
    }

    if (payload?.typ !== "share_invite") {
      return res.status(401).json({
        ok: false,
        message: "Convite inválido.",
      });
    }

    const inviteId = String(payload?.inviteId || "").trim();
    const shareId = String(payload?.shareId || "").trim();
    const contactoToken = normContact(payload?.contacto);

    const inv = await ShareInvite.findOne({ inviteId });
    if (!inv) {
      return res.status(404).json({
        ok: false,
        message: "Convite não encontrado.",
      });
    }

    if (inv.inviteExpiresAt && Date.now() > Number(inv.inviteExpiresAt)) {
      return res.status(410).json({
        ok: false,
        message: "Convite expirado (BD).",
      });
    }

    if (inv.otpExpiresAt && Date.now() > Number(inv.otpExpiresAt)) {
      return res.status(410).json({
        ok: false,
        message: "Código expirado.",
      });
    }

    const okOtp = await bcrypt.compare(otp, String(inv.otpHash || ""));
    if (!okOtp) {
      inv.attempts = Number(inv.attempts || 0) + 1;
      await inv.save();
      return res.status(401).json({
        ok: false,
        message: "Código incorreto.",
      });
    }

    inv.contacto = contactoToken;
    inv.contactoNorm = normContact(contactoToken);
    inv.status = "aceitou";
    inv.usedAt = Date.now();
    await inv.save();

    const sessionToken = jwt.sign(
      { typ: "share_session", shareId, contacto: contactoToken },
      secret,
      { expiresIn: "2h" }
    );

    // Dados da viagem para mostrar ao convidado — sem isto, o ecrã
    // do convidado ficava sem nenhuma informação após validar o
    // código (só recebia shareId/sessionToken).
    const trip = await ShareTrip.findOne({ shareId }).lean();

    return res.json({
      ok: true,
      shareId,
      sessionToken,
      viagem: trip ? {
        nomeOrganizador: trip.nomeOrganizador || "",
        partida:         trip.recolha?.address || "",
        destino:         trip.destino?.address || "",
        // Coordenadas — necessárias para desenhar a rota deste
        // convidado no mapa depois de o pagamento ser confirmado.
        recolhaGeo: (trip.recolha?.lat != null) ? { lat: trip.recolha.lat, lng: trip.recolha.lng } : null,
        destinoGeo: (trip.destino?.lat != null) ? { lat: trip.destino.lat, lng: trip.destino.lng } : null,
        categoria:       trip.categoria || "",
        scheduledAt:     trip.scheduledAt || null,
      } : null,
    });
  } catch (err) {
    console.error("❌ invite/verify:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro interno.",
    });
  }
});

/* ==============================
   CÁLCULO IMEDIATO DO VALOR (convidado)
   Estimativa individual — distância do ponto de recolha deste
   convidado até ao destino da viagem, dividida pelo nº total de
   participantes. Corre logo após validar o código, sem esperar que
   o organizador calcule a divisão final (rota mais abaixo). Quando
   essa divisão final existir, substitui esta estimativa.
============================== */
router.post("/invite/calcular-meu-valor", async (req, res) => {
  try {
    const sessionToken = String(req.body?.sessionToken || "").trim();
    if (!sessionToken) {
      return res.status(400).json({ ok: false, message: "sessionToken obrigatório." });
    }

    const secret = getInviteSecret();
    let payload;
    try { payload = jwt.verify(sessionToken, secret); }
    catch { return res.status(401).json({ ok: false, message: "Sessão inválida ou expirada." }); }

    if (payload?.typ !== "share_session") {
      return res.status(401).json({ ok: false, message: "Sessão inválida." });
    }

    const { shareId, contacto } = payload;
    const inv = await ShareInvite.findOne({ shareId, contactoNorm: normContact(contacto) });
    if (!inv) return res.status(404).json({ ok: false, message: "Convite não encontrado." });

    // Já há um valor calculado (estimativa ou final) — não recalcular.
    if (inv.amountDue) {
      return res.json({ ok: true, amountDue: inv.amountDue, distanciaKm: inv.distanciaKm, currency: inv.currency || "EUR" });
    }

    const trip = await ShareTrip.findOne({ shareId }).lean();
    if (!trip?.destino?.lat) {
      return res.status(404).json({ ok: false, message: "Viagem não encontrada." });
    }

    // Distância da VIAGEM real (recolha → destino) — não da
    // localização actual do convidado. O custo é o da viagem
    // planeada, dividido por igual entre os participantes; usar a
    // posição do telemóvel do convidado para isto não tem sentido
    // (e foi a causa de valores completamente disparatados quando a
    // geolocalização do convidado estava imprecisa/distante).
    if (!Number.isFinite(Number(trip.recolha?.lat)) || !Number.isFinite(Number(trip.recolha?.lng))) {
      return res.json({ ok: true, amountDue: null, message: "Local de recolha da viagem não disponível ainda." });
    }

    // Distância de condução REAL (OSRM) — não linha recta. A linha
    // recta subestima sempre a distância (estradas não são rectas),
    // o que faria o convidado pagar menos do que o custo real da
    // viagem. distanciaComFallback() nunca lança erro — se o OSRM
    // falhar, recorre a linha recta automaticamente.
    const { kmTotal: distanciaKm } = await distanciaComFallback([
      { lat: Number(trip.recolha.lat), lng: Number(trip.recolha.lng) },
      { lat: Number(trip.destino.lat), lng: Number(trip.destino.lng) },
    ]);

    const totalParticipantes = Math.max(1, await ShareInvite.countDocuments({ shareId }));

    // Motor de preços REAL (o mesmo de /api/quotes/quote) — lê os
    // €/km configurados pelo admin (KmConfig) em vez de uma tabela
    // fixa e desligada. Single source of truth.
    const cfg = await getConfig();
    const cotacao = calcularPreco({
      categoria: trip.categoria,
      distanciaKm,
      directionsRoute: null, // portagens reais exigiam Google Directions; sem chave configurada, calcularPreco() simplesmente não soma portagens (comportamento seguro, nunca falha)
      contexto: {
        origemTexto:  trip.recolha?.address || "",
        destinoTexto: trip.destino?.address || "",
        datahora:     trip.scheduledAt || null,
      },
      cfg,
    });

    if (!cotacao.ok) {
      return res.status(400).json({ ok: false, message: cotacao.message || "Não foi possível calcular o preço." });
    }

    const amountDue = money2(cotacao.total / totalParticipantes);

    // Diagnóstico — para comparar directamente com a estimativa que
    // o organizador viu ao criar a partilha (mesma categoria/rota
    // deveriam dar valores próximos; se não derem, a diferença está
    // aqui: na categoria usada, na distância, ou no método de rota).
    console.log(
      `💰 [calcular-meu-valor] shareId=${shareId} categoria="${trip.categoria}" ` +
      `distanciaKm=${distanciaKm.toFixed(2)} ` +
      `valorKm=${cotacao.valorKm} base=€${cotacao.base} portagens=€${cotacao.portagens} ` +
      `total=€${cotacao.total} ÷ ${totalParticipantes} participante(s) = €${amountDue}`
    );

    inv.amountDue = amountDue;
    inv.distanciaKm = money2(distanciaKm);
    inv.currency = "EUR";
    inv.calcAt = Date.now();
    await inv.save();

    return res.json({ ok: true, amountDue, distanciaKm: money2(distanciaKm), currency: "EUR", categoria: trip.categoria, valorKm: cotacao.valorKm, total: cotacao.total });
  } catch (err) {
    console.error("❌ invite/calcular-meu-valor:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

/* ==============================
   CANCELAR PARTICIPAÇÃO (convidado)
   O próprio convidado desiste da viagem partilhada — diferente de
   /cancelar, que é o organizador a cancelar a viagem toda.
============================== */
router.post("/invite/cancelar-participacao", async (req, res) => {
  try {
    const sessionToken = String(req.body?.sessionToken || "").trim();
    if (!sessionToken) {
      return res.status(400).json({ ok: false, message: "sessionToken obrigatório." });
    }

    const secret = getInviteSecret();
    let payload;
    try { payload = jwt.verify(sessionToken, secret); }
    catch { return res.status(401).json({ ok: false, message: "Sessão inválida ou expirada." }); }

    if (payload?.typ !== "share_session") {
      return res.status(401).json({ ok: false, message: "Sessão inválida." });
    }

    const { shareId, contacto } = payload;
    const inv = await ShareInvite.findOne({ shareId, contactoNorm: normContact(contacto) });
    if (!inv) return res.status(404).json({ ok: false, message: "Convite não encontrado." });

    if (inv.status === "pagou") {
      return res.status(409).json({ ok: false, message: "Já pagou a sua parte — contacte o organizador para cancelar." });
    }

    inv.status = "cancelado";
    inv.canceledAt = Date.now();
    await inv.save();

    return res.json({ ok: true, message: "Participação cancelada." });
  } catch (err) {
    console.error("❌ invite/cancelar-participacao:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

/* ==============================
   VALOR A PAGAR (convidado)
   Consulta o valor já calculado (amountDue) para este participante.
   Sessão obtida em /invite/verify (sessionToken). Devolve null
   enquanto o organizador ainda não tiver corrido o cálculo da rota
   (endpoint que já existia, mais abaixo neste ficheiro).
============================== */
router.post("/invite/meu-valor", async (req, res) => {
  try {
    const sessionToken = String(req.body?.sessionToken || "").trim();
    if (!sessionToken) {
      return res.status(400).json({ ok: false, message: "sessionToken obrigatório." });
    }

    const secret = getInviteSecret();
    let payload;
    try { payload = jwt.verify(sessionToken, secret); }
    catch { return res.status(401).json({ ok: false, message: "Sessão inválida ou expirada." }); }

    if (payload?.typ !== "share_session") {
      return res.status(401).json({ ok: false, message: "Sessão inválida." });
    }

    const { shareId, contacto } = payload;
    const inv = await ShareInvite.findOne({ shareId, contactoNorm: normContact(contacto) }).lean();
    if (!inv) return res.status(404).json({ ok: false, message: "Convite não encontrado." });

    return res.json({
      ok: true,
      amountDue:   inv.amountDue ?? null,
      distanciaKm: inv.distanciaKm ?? null,
      currency:    inv.currency || "EUR",
      status:      inv.status || "pendente",
    });
  } catch (err) {
    console.error("❌ invite/meu-valor:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

/* ==============================
   CONFIRMAR PAGAMENTO (convidado)
   Chamado depois de o pagamento Stripe ter sido confirmado no
   cliente (mesmo fluxo de /api/reservas/stripe/criar-intent +
   confirmCardPayment já usado no resto da app — não duplicado aqui).
   Body: { sessionToken, provider, ref }
============================== */
/* ── Lógica partilhada de "pagamento confirmado" para Partilha —
   extraída para função reutilizável, para o MB Way (mais abaixo)
   conseguir chamar exactamente o mesmo caminho que o Stripe/PayPal
   já usam, sem duplicar nada. ── */
async function confirmarPagamentoPartilha(shareId, contacto, provider, ref, io) {
  const inv = await ShareInvite.findOne({ shareId, contactoNorm: normContact(contacto) });
  if (!inv) return { ok: false, message: "Convite não encontrado." };
  if (!inv.amountDue) return { ok: false, message: "Valor ainda não calculado para esta viagem." };
  if (inv.status === "pagou") return { ok: true, message: "Já estava pago.", jaPago: true };

  inv.status = "pagou";
  inv.paidAt = Date.now();
  inv.payProvider = provider;
  inv.payRef = ref;
  inv.paidAmount = Number(inv.amountDue || 0);
  await inv.save();

  // Se este foi o último a pagar, finaliza a viagem (cria a Reserva
  // real e despacha um motorista) — sem isto, pagamentos confirmados
  // nunca apareciam em "Viagens Ativas".
  finalizeSharedTrip(shareId, io).catch((err) =>
    console.error("⚠️ finalizeSharedTrip falhou:", err?.message)
  );

  return { ok: true, message: "Pagamento confirmado." };
}

router.post("/invite/confirmar-pagamento", async (req, res) => {
  try {
    const sessionToken = String(req.body?.sessionToken || "").trim();
    const provider = String(req.body?.provider || "stripe").trim();
    const ref = String(req.body?.ref || "").trim();
    if (!sessionToken) {
      return res.status(400).json({ ok: false, message: "sessionToken obrigatório." });
    }

    const secret = getInviteSecret();
    let payload;
    try { payload = jwt.verify(sessionToken, secret); }
    catch { return res.status(401).json({ ok: false, message: "Sessão inválida ou expirada." }); }

    if (payload?.typ !== "share_session") {
      return res.status(401).json({ ok: false, message: "Sessão inválida." });
    }

    const { shareId, contacto } = payload;
    const resultado = await confirmarPagamentoPartilha(shareId, contacto, provider, ref, req.app.get("io"));
    if (!resultado.ok) return res.status(resultado.message === "Convite não encontrado." ? 404 : 400).json(resultado);
    return res.json(resultado);
  } catch (err) {
    console.error("❌ invite/confirmar-pagamento:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /invite/pagamento-falhou
   O convidado chama isto quando o pagamento (Stripe/PayPal) falha
   ou é cancelado no próprio ecrã de pagamento. Marca a saída da
   partilha e avisa o organizador em tempo real, para decidir se
   quer recalcular com os restantes ou cancelar tudo.
══════════════════════════════════════════════════════════════ */
router.post("/invite/pagamento-falhou", requireShareSession, async (req, res) => {
  try {
    const shareId = String(req.shareSession?.shareId || "").trim();
    const contactoToken = normContact(req.shareSession?.contacto);
    const inv = await ShareInvite.findOne({ shareId, contactoNorm: contactoToken });
    if (!inv) return res.status(404).json({ ok: false, message: "Convite não encontrado." });

    if (inv.status === "pagou") {
      return res.json({ ok: true, definitivo: false, tentativasRestantes: 3 });
    }

    // Só sai da partilha (e o organizador só é avisado) à 3ª falha —
    // antes disso, é só um erro de cartão pontual, não uma desistência.
    const MAX_TENTATIVAS = 3;
    inv.falhasPagamento = Number(inv.falhasPagamento || 0) + 1;
    const definitivo = inv.falhasPagamento >= MAX_TENTATIVAS;

    if (definitivo) {
      inv.status = "falhou";
    }
    await inv.save();

    if (definitivo) {
      const io = req.app.get("io");
      if (io) {
        io.to(`share_${shareId}`).emit("pagamento_falhou", {
          shareId,
          nome: inv.nome || inv.contacto,
          contacto: inv.contacto,
        });
      }
    }

    return res.json({
      ok: true,
      definitivo,
      tentativasRestantes: Math.max(0, MAX_TENTATIVAS - inv.falhasPagamento),
      message: definitivo
        ? "Pagamento falhou 3 vezes — saiu da partilha."
        : `Pagamento falhou. Tem mais ${MAX_TENTATIVAS - inv.falhasPagamento} tentativa(s).`,
    });
  } catch (err) {
    console.error("❌ invite/pagamento-falhou:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /organizador/recalcular
   Chamado quando o organizador escolhe "SIM" após uma falha de
   pagamento — recalcula o valor entre os participantes restantes
   (ainda activos) e ajusta quem já tinha pago:
     · pagou menos do que o novo valor → fica marcado "pendente"
       novamente, com o valor em falta, e é avisado por SMS para
       pagar a diferença (não é possível cobrar automaticamente
       sem o cartão guardado, por segurança).
     · pagou mais do que o novo valor → reembolso automático da
       diferença via Stripe (PayPal fica pendente de confirmação
       manual — ver nota no final da função).
   Body: { shareId }
══════════════════════════════════════════════════════════════ */
router.post("/organizador/recalcular", async (req, res) => {
  try {
    const shareId = String(req.body?.shareId || "").trim();
    if (!shareId) return res.status(400).json({ ok: false, message: "shareId obrigatório." });

    const trip = await ShareTrip.findOne({ shareId });
    if (!trip) return res.status(404).json({ ok: false, message: "Viagem não encontrada." });
    if (trip.tripRefId) return res.status(400).json({ ok: false, message: "Esta viagem já foi finalizada." });

    const todos = await ShareInvite.find({ shareId });
    const ativos = todos.filter((i) => i.status !== "falhou" && i.status !== "cancelado");
    if (!ativos.length) return res.status(400).json({ ok: false, message: "Não restam participantes activos." });

    if (!Number.isFinite(Number(trip.recolha?.lat)) || !Number.isFinite(Number(trip.recolha?.lng))) {
      return res.status(400).json({ ok: false, message: "Local de recolha não disponível." });
    }

    const { kmTotal: distanciaKm } = await distanciaComFallback([
      { lat: Number(trip.recolha.lat), lng: Number(trip.recolha.lng) },
      { lat: Number(trip.destino.lat), lng: Number(trip.destino.lng) },
    ]);

    const cfg = await getConfig();
    const cotacao = calcularPreco({
      categoria: trip.categoria,
      distanciaKm,
      directionsRoute: null,
      contexto: { origemTexto: trip.recolha?.address || "", destinoTexto: trip.destino?.address || "", datahora: trip.scheduledAt || null },
      cfg,
    });
    if (!cotacao.ok) return res.status(400).json({ ok: false, message: cotacao.message });

    const novoValorPorPessoa = money2(cotacao.total / ativos.length);
    const stripe = await getStripe();
    const resultados = [];

    for (const inv of ativos) {
      const antesPagou = inv.status === "pagou";
      const pagoAntes = Number(inv.paidAmount || 0);
      const diff = money2(novoValorPorPessoa - pagoAntes);

      if (!antesPagou) {
        // Ainda não tinha pago — só actualiza o valor a pagar.
        inv.amountDue = novoValorPorPessoa;
        await inv.save();
        resultados.push({ contacto: inv.contacto, accao: "valor_actualizado", novoValor: novoValorPorPessoa });
        continue;
      }

      if (Math.abs(diff) < 0.01) {
        resultados.push({ contacto: inv.contacto, accao: "sem_alteracao" });
        continue;
      }

      if (diff < 0) {
        // Pagou mais do que o novo valor → reembolsar a diferença.
        const valorReembolso = Math.abs(diff);
        if (inv.payProvider === "stripe" && inv.payRef && stripe) {
          try {
            await stripe.refunds.create({
              payment_intent: inv.payRef,
              amount: Math.round(valorReembolso * 100),
            });
            resultados.push({ contacto: inv.contacto, accao: "reembolsado", valor: valorReembolso });
          } catch (errRef) {
            console.error("❌ [recalcular] reembolso Stripe falhou:", errRef?.message);
            resultados.push({ contacto: inv.contacto, accao: "reembolso_falhou", valor: valorReembolso });
          }
        } else if (inv.payProvider === "paypal" && inv.payRef) {
          try {
            await paypalRefundCapture(inv.payRef, valorReembolso);
            resultados.push({ contacto: inv.contacto, accao: "reembolsado", valor: valorReembolso });
          } catch (errRef) {
            console.error("❌ [recalcular] reembolso PayPal falhou:", errRef?.message);
            resultados.push({ contacto: inv.contacto, accao: "reembolso_falhou", valor: valorReembolso });
          }
        } else {
          resultados.push({ contacto: inv.contacto, accao: "reembolso_manual_necessario", valor: valorReembolso, provider: inv.payProvider });
        }
        inv.amountDue = novoValorPorPessoa;
        inv.paidAmount = novoValorPorPessoa;
        await inv.save();
      } else {
        // Pagou menos do que o novo valor → tem de pagar a diferença.
        // Não cobramos automaticamente (sem cartão guardado) — volta
        // a "pendente" com o novo valor e é avisado por SMS.
        inv.status = "pendente";
        inv.amountDue = novoValorPorPessoa;
        await inv.save();
        try {
          if (canSendSms()) {
            await sendSmsSafe(
              inv.contacto,
              `REALMETROPOLIS: o valor da viagem partilhada foi actualizado. Falta pagar €${diff.toFixed(2)}. Aceda ao link que recebeu antes para concluir o pagamento.`
            );
          }
        } catch (_) {}
        resultados.push({ contacto: inv.contacto, accao: "falta_pagar_diferenca", valor: diff });
      }
    }

    const io = req.app.get("io");
    if (io) io.to(`share_${shareId}`).emit("partilha_recalculada", { shareId, novoValorPorPessoa, resultados });

    return res.json({ ok: true, novoValorPorPessoa, resultados });
  } catch (err) {
    console.error("❌ organizador/recalcular:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /organizador/cancelar-tudo
   Chamado quando o organizador escolhe "NÃO" após uma falha de
   pagamento — cancela a partilha inteira e reembolsa, na totalidade,
   quem já tinha pago.
   Body: { shareId }
══════════════════════════════════════════════════════════════ */
router.post("/organizador/cancelar-tudo", async (req, res) => {
  try {
    const shareId = String(req.body?.shareId || "").trim();
    if (!shareId) return res.status(400).json({ ok: false, message: "shareId obrigatório." });

    const trip = await ShareTrip.findOne({ shareId });
    if (!trip) return res.status(404).json({ ok: false, message: "Viagem não encontrada." });
    if (trip.tripRefId) return res.status(400).json({ ok: false, message: "Esta viagem já foi finalizada, não pode ser cancelada por aqui." });

    const todos = await ShareInvite.find({ shareId });
    const stripe = await getStripe();
    const resultados = [];

    for (const inv of todos) {
      if (inv.status === "pagou" && Number(inv.paidAmount) > 0) {
        if (inv.payProvider === "stripe" && inv.payRef && stripe) {
          try {
            await stripe.refunds.create({ payment_intent: inv.payRef });
            resultados.push({ contacto: inv.contacto, accao: "reembolsado_total" });
          } catch (errRef) {
            console.error("❌ [cancelar-tudo] reembolso Stripe falhou:", errRef?.message);
            resultados.push({ contacto: inv.contacto, accao: "reembolso_falhou" });
          }
        } else if (inv.payProvider === "paypal" && inv.payRef) {
          try {
            await paypalRefundCapture(inv.payRef);
            resultados.push({ contacto: inv.contacto, accao: "reembolsado_total" });
          } catch (errRef) {
            console.error("❌ [cancelar-tudo] reembolso PayPal falhou:", errRef?.message);
            resultados.push({ contacto: inv.contacto, accao: "reembolso_falhou" });
          }
        } else {
          resultados.push({ contacto: inv.contacto, accao: "reembolso_manual_necessario", provider: inv.payProvider });
        }
      }
      inv.status = "cancelado";
      await inv.save();
    }

    trip.status = "cancelada";
    await trip.save();

    const io = req.app.get("io");
    if (io) io.to(`share_${shareId}`).emit("partilha_cancelada", { shareId, resultados });

    return res.json({ ok: true, resultados });
  } catch (err) {
    console.error("❌ organizador/cancelar-tudo:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /organizador/cancelar-viagem-despachada
   Cancela a viagem DEPOIS de finalizada (já com Trip criada e em
   despacho/atribuída a um motorista). Diferente de
   /organizador/cancelar-tudo, que só funciona ANTES da finalização
   (enquanto ainda só existem ShareInvites, sem Trip nenhuma).
   Reembolsa automaticamente todos os participantes que pagaram.
   Body: { shareId }
══════════════════════════════════════════════════════════════ */
router.post("/organizador/cancelar-viagem-despachada", async (req, res) => {
  try {
    const shareId = String(req.body?.shareId || "").trim();
    if (!shareId) return res.status(400).json({ ok: false, message: "shareId obrigatório." });

    const trip = await ShareTrip.findOne({ shareId });
    if (!trip) return res.status(404).json({ ok: false, message: "Viagem não encontrada." });
    if (!trip.tripRefId) {
      return res.status(400).json({ ok: false, message: "Esta viagem ainda não foi despachada — use /organizador/cancelar-tudo." });
    }

    const { cancelarViagem } = await import("../modules/viagens/viagens.cancel.service.js");
    const resultado = await cancelarViagem(String(trip.tripRefId), {
      canceladoPor: "organizador",
      motivo: String(req.body?.motivo || "Cancelado pelo organizador da partilha."),
    });

    const io = req.app.get("io");
    if (io) {
      io.to(`share_${shareId}`).emit("viagem_cancelada", {
        shareId,
        tripId: String(trip.tripRefId),
        reembolsos: resultado.reembolsos,
      });
    }

    return res.json({ ok: true, reembolsos: resultado.reembolsos });
  } catch (err) {
    console.error("❌ organizador/cancelar-viagem-despachada:", err);
    return res.status(err.statusCode || 500).json({ ok: false, message: err.message || "Erro interno." });
  }
});

/* ==============================
   📍 location/update (convidado)
============================== */
router.post("/location/update", requireShareSession, async (req, res) => {
  try {
    const shareId = String(req.shareSession?.shareId || "").trim();
    const contactoToken = normContact(req.shareSession?.contacto);

    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const accuracy = req.body?.accuracy != null ? Number(req.body.accuracy) : null;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({
        ok: false,
        message: "lat/lng inválidos.",
      });
    }

    const variants = contactVariants(contactoToken);
    const doc = await ShareInvite.findOne({
      shareId,
      contactoNorm: { $in: variants.map(normContact) },
    });

    if (!doc) {
      return res.status(404).json({
        ok: false,
        message: "Convite não encontrado para este shareId/contacto.",
      });
    }

    doc.contacto = contactoToken;
    doc.contactoNorm = normContact(contactoToken);
    doc.lat = lat;
    doc.lng = lng;
    doc.locatedAt = Date.now();

    if (Number.isFinite(accuracy)) doc.accuracy = accuracy;

    await doc.save();

    return res.json({
      ok: true,
      shareId,
      contacto: doc.contacto,
      lat: doc.lat,
      lng: doc.lng,
      locatedAt: doc.locatedAt,
    });
  } catch (err) {
    console.error("❌ location/update:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro interno.",
    });
  }
});

/* ==============================
   calc (mantém)
============================== */
router.post("/calc", async (req, res) => {
  try {
    const shareId = String(req.body?.shareId || "").trim();
    const categoria = String(req.body?.categoria || "economica");
    const destino = req.body?.destino;
    const suggest = !!req.body?.suggest;

    const userOrderContacts = Array.isArray(req.body?.userOrderContacts)
      ? req.body.userOrderContacts.map(normContact).filter(Boolean)
      : [];

    if (!shareId) {
      return res.status(400).json({
        ok: false,
        message: "shareId obrigatório.",
      });
    }

    if (!destino?.lat || !destino?.lng) {
      return res.status(400).json({
        ok: false,
        message: "destino (lat/lng) obrigatório.",
      });
    }

    if (!userOrderContacts.length) {
      return res.status(400).json({
        ok: false,
        message: "userOrderContacts obrigatório (array).",
      });
    }

    let trip = await ShareTrip.findOne({ shareId });

    if (!trip) {
      trip = await ShareTrip.create({
        shareId,
        destino: {
          address: String(destino.address || ""),
          lat: Number(destino.lat),
          lng: Number(destino.lng),
        },
        userOrderContacts,
        orderContacts: userOrderContacts,
        categoria,
        status: "active",
      });
    } else {
      trip.destino = {
        address: String(destino.address || trip.destino?.address || ""),
        lat: Number(destino.lat),
        lng: Number(destino.lng),
      };
      trip.categoria = categoria;

      if (!Array.isArray(trip.userOrderContacts) || !trip.userOrderContacts.length) {
        trip.userOrderContacts = userOrderContacts;
      }

      if (!Array.isArray(trip.orderContacts) || !trip.orderContacts.length) {
        trip.orderContacts = userOrderContacts;
      }

      await trip.save();
    }

    const resolved = [];
    const missingContacts = [];

    for (const c of userOrderContacts) {
      const variants = contactVariants(c);
      const doc = await ShareInvite.findOne({
        shareId,
        contactoNorm: { $in: variants.map(normContact) },
      }).lean();

      if (!doc) {
        missingContacts.push(c);
        resolved.push({ contacto: c, found: false, lat: null, lng: null });
        continue;
      }

      const lat = Number(doc.lat);
      const lng = Number(doc.lng);
      const hasLoc = Number.isFinite(lat) && Number.isFinite(lng);

      if (!hasLoc) missingContacts.push(doc.contacto || c);

      resolved.push({
        contacto: doc.contacto,
        nome: doc.nome || "Participante",
        status: doc.status || "aceitou",
        lat: hasLoc ? lat : null,
        lng: hasLoc ? lng : null,
        found: true,
      });
    }

    if (missingContacts.length) {
      return res.status(409).json({
        ok: false,
        message: "Ainda não há localizações suficientes para calcular.",
        missingContacts,
      });
    }

    const points = resolved.map((r) => ({
      contacto: r.contacto,
      nome: r.nome,
      status: r.status,
      lat: r.lat,
      lng: r.lng,
    }));

    const destPoint = {
      lat: Number(destino.lat),
      lng: Number(destino.lng),
    };

    // Distância real de cada perna (recolha1→recolha2→...→destino),
    // pela ordem já decidida pela app — uma única chamada OSRM com
    // todos os pontos, em vez de linha recta por troço.
    const { kmTotal: routeKm, legsKm, viaCondução } = await distanciaComFallback([
      ...points.map((p) => ({ lat: p.lat, lng: p.lng })),
      destPoint,
    ]);
    if (!viaCondução) {
      console.warn("⚠️ [partilha] OSRM (multi-paragem) indisponível, a usar linha recta como reserva.");
    }

    const cfgFinal = await getConfig();
    const cotacaoFinal = calcularPreco({
      categoria,
      distanciaKm: routeKm,
      directionsRoute: null,
      contexto: { destinoTexto: destino?.address || "", datahora: trip.scheduledAt || null },
      cfg: cfgFinal,
    });
    if (!cotacaoFinal.ok) {
      return res.status(400).json({ ok: false, message: cotacaoFinal.message || "Não foi possível calcular o preço final." });
    }
    const totalFinal = cotacaoFinal.total;

    const inCar = points.map((p, idx) => {
      const km = legsKm.slice(idx).reduce((a, b) => a + b, 0);
      return {
        contacto: p.contacto,
        nome: p.nome,
        status: p.status,
        distanciaKm: km,
      };
    });

    const sumInCar = inCar.reduce((a, x) => a + x.distanciaKm, 0) || 1;

    const participants = inCar.map((x) => {
      const ratio = x.distanciaKm / sumInCar;
      const amountDue = money2(totalFinal * ratio);
      return {
        contacto: x.contacto,
        nome: x.nome,
        status: x.status,
        distanciaKm: money2(x.distanciaKm),
        amountDue,
        valorFinal: amountDue,
      };
    });

    await Promise.all(
      participants.map(async (p) => {
        const variants = contactVariants(p.contacto);
        const doc = await ShareInvite.findOne({
          shareId,
          contactoNorm: { $in: variants.map(normContact) },
        });

        if (!doc) return;

        doc.contacto = normContact(p.contacto);
        doc.contactoNorm = normContact(p.contacto);
        doc.amountDue = p.amountDue;
        doc.distanciaKm = p.distanciaKm;
        doc.currency = "EUR";
        doc.calcAt = Date.now();

        await doc.save();
      })
    );

    let suggestion = null;
    if (suggest && points.length >= 3) {
      const ranked = [...points]
        .map((p) => ({
          contacto: p.contacto,
          distToDest: haversineKm(p, destPoint),
        }))
        .sort((a, b) => b.distToDest - a.distToDest)
        .map((x) => x.contacto);

      suggestion = {
        suggestedOrderContacts: ranked,
        reason: "menor desvio (heurística simples)",
      };
    }

    return res.json({
      ok: true,
      shareId,
      categoria,
      valorKm,
      routeKm: money2(routeKm),
      totalFinal,
      currency: "EUR",
      participants,
      suggestion,
      orderContactsUsed: points.map((p) => p.contacto),
    });
  } catch (err) {
    console.error("❌ calc:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro interno.",
    });
  }
});


/* ══════════════════════════════════════════════════════════════════
   MODO EVENTO — mesmo local de partida → destinos diferentes
   ──────────────────────────────────────────────────────────────────
   Fluxo:
     1. Organizador cria evento com partida fixa + lista de contactos
        POST /api/partilha/evento/criar
     2. Cada participante recebe SMS com link + OTP
     3. Participante abre link, confirma OTP
        POST /api/partilha/evento/confirmar-otp
     4. Participante insere o seu destino → sistema calcula preço (OSRM)
        POST /api/partilha/evento/definir-destino
     5. Participante paga individualmente
        POST /api/partilha/evento/confirmar-pagamento
     6. Organizador acompanha estado
        GET  /api/partilha/evento/status/:eventoId
══════════════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────────────────────────
   POST /api/partilha/evento/criar
   Body: {
     partida: { address, lat, lng },   ← local do evento (fixo)
     participantes: [{ contacto, nome }],
     categoria: "economica"|"confort"|"executive"|"luxury",
     dateTime: ISO string,
     mesmoVeiculo: bool                ← opcional
   }
────────────────────────────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════════
   POST /api/partilha/reserva-simples/criar
   O botão "RESERVAR" do hotel passa a chamar isto — por baixo, é
   uma Reserva Flexível (modo Evento) com um único participante,
   mas sem nada da complexidade de grupo: partida E destino já vêm
   definidos pelo hotel (não à espera que o hóspede escolha o seu),
   e sem OTP a validar (o hotel já confirmou quem é o hóspede ao
   preencher o formulário) — vai direto para pagamento.

   Autenticado (hotel) — ao contrário de /evento/criar (pública),
   esta exige sessão, porque precisamos de saber SEMPRE que hotel
   está a criar (grava em organizadorId, para as Classificações e o
   Relatório SLA conseguirem encontrar esta viagem depois).
══════════════════════════════════════════════════════════════ */
router.post("/reserva-simples/criar", requireClienteOuParceiro, async (req, res) => {
  try {
    const {
      nomeHospede, contactoHospede, emailHospede, destino, valor, requisitosEspeciais,
      partida, categoria, datahora, participantes, validUntil: validUntilRaw,
    } = req.body || {};

    // Compatibilidade — se não vier "participantes" (array), monta
    // um só a partir dos campos "soltos" de sempre. O caso mais
    // comum (RESERVAR normal, 1 hóspede) nunca precisa de mudar a
    // forma como já chama esta rota; só quando alguém usa
    // "Convidar mais pessoas" é que o array vem preenchido a sério.
    const lista = Array.isArray(participantes) && participantes.length
      ? participantes
      : [{ nome: nomeHospede, contacto: contactoHospede, email: emailHospede, destino, valor, requisitosEspeciais }];

    if (!lista.length || lista.length > 17) {
      return res.status(400).json({ ok: false, message: "1 a 17 participantes." });
    }
    for (const p of lista) {
      if (!p?.nome || !p?.contacto) {
        return res.status(400).json({ ok: false, message: "Nome e contacto são obrigatórios para cada participante." });
      }
      if (!p?.destino?.lat || !p?.destino?.lng || !p?.destino?.address) {
        return res.status(400).json({ ok: false, message: `Destino em falta para ${p.nome}.` });
      }
    }

    // Contactos repetidos — cada participante precisa de um contacto
    // ÚNICO nesta reserva. O ShareInvite tem índice único {shareId,
    // contactoNorm}, por isso dois participantes com o mesmo número
    // colidiriam e o segundo seria rejeitado silenciosamente (ficava
    // uma reserva a meio, com o ShareTrip criado mas participantes a
    // menos). Validar aqui, ANTES de criar nada, e avisar o hotel.
    {
      const vistos = new Map();  // contactoNorm -> nome do 1º que o usou
      for (const p of lista) {
        const cn = normContact(String(p.contacto).trim());
        if (cn && vistos.has(cn)) {
          return res.status(409).json({
            ok: false,
            code: "CONTACTO_REPETIDO",
            message: `O contacto ${p.contacto} está repetido (usado por ${vistos.get(cn)} e ${p.nome}). Cada participante precisa de um contacto diferente.`,
          });
        }
        if (cn) vistos.set(cn, p.nome);
      }
    }

    if (!partida?.lat || !partida?.lng || !partida?.address) {
      return res.status(400).json({ ok: false, message: "partida (lat, lng, address) obrigatório." });
    }
    const t = parseDateTime(datahora);
    if (!t) return res.status(400).json({ ok: false, message: "datahora obrigatória (formato ISO)." });

    // Prazo de validade (janela): o hóspede escolhe "válido por" (máx 4h
    // após a hora da viagem). Se NÃO escolher, aplica-se 2 horas por
    // defeito — assim TODOS os bilhetes têm sempre uma validade visível
    // e são consistentes (nunca há um bilhete sem prazo).
    const MAX_MS = 4 * 60 * 60 * 1000;      // 4 horas (máximo)
    const DEFAULT_MS = 2 * 60 * 60 * 1000;  // 2 horas (por defeito)
    let validUntil = validUntilRaw ? parseDateTime(validUntilRaw) : null;
    // parseDateTime devolve MILISSEGUNDOS (numero), nao um Date. Sem esta
    // normalizacao o validUntil ficava numero neste ramo e Date no ramo
    // do valor por defeito — e o .getTime() mais abaixo rebentava com
    // "validUntil.getTime is not a function", impedindo criar a reserva.
    if (validUntil !== null) validUntil = new Date(validUntil);
    if (validUntil) {
      if (validUntil <= t) {
        return res.status(400).json({ ok: false, message: "O prazo de validade deve ser depois da hora da viagem." });
      }
      if (validUntil - t > MAX_MS) {
        validUntil = new Date(t.getTime() + MAX_MS);
      }
    } else {
      validUntil = new Date(t.getTime() + DEFAULT_MS);
    }

    const cat = String(categoria || "economica");
    const secret = getInviteSecret();
    const shareId = genShareId();

    // ShareTrip — mesma convenção confusa mas consistente do resto
    // do ficheiro: campo "destino" guarda a PARTIDA (local de
    // recolha comum). organizadorId gravado desta vez — é o que
    // falta na rota /evento/criar pública, e o que faz o
    // collaborator.collaboratorId chegar à Trip final.
    await ShareTrip.create({
      shareId,
      destino: { address: String(partida.address), lat: Number(partida.lat), lng: Number(partida.lng) },
      nomeOrganizador: req.clienteEmail || "Hotel",
      emailOrganizador: req.clienteEmail || "",
      organizadorId: req.clienteId,
      categoria: cat,
      status: "active",
      scheduledAt: t,
      validUntil: validUntil,
      notifMethod: "ambos",
      pagador: "hospede",
      createdAt: Date.now(),
      modoEvento: true,
      mesmoVeiculo: false,
    });

    // Um ShareInvite por participante — todos já com destino
    // definido e prontos a pagar. Sem OTP: não há nada a "validar",
    // o hóspede não escolhe nada, só paga quando lhe for pedido.
    const publicBase = getPublicBaseUrl();
    const criados = [];
    for (const p of lista) {
      const inviteId = genInviteId();
      const nomeP = String(p.nome).trim();
      const contactoP = String(p.contacto).trim();
      const emailP = String(p.email || "").trim().toLowerCase();
      const valorP = Number(p.valor || 0);

      // OTP de confirmação — o participante recebe este código por
      // SMS/email e usa-o para confirmar a participação. Guardado com
      // hash (nunca em claro) e com validade, igual aos outros fluxos.
      const otp     = genOtp6();
      const otpHash = await bcrypt.hash(otp, 10);

      await ShareInvite.create({
        inviteId,
        shareId,
        contacto: normContact(contactoP) || contactoP,
        contactoNorm: normContact(contactoP) || contactoP,
        nome: nomeP,
        email: emailP,
        otpHash,
        otpExpiresAt: Date.now() + 30 * 60 * 1000,   // 30 min para confirmar
        attempts: 0,
        usedAt: null,
        status: "pendente",
        createdAt: Date.now(),
        scheduledAt: t,
        modoEvento: true,
        partidaEvento: { address: partida.address, lat: Number(partida.lat), lng: Number(partida.lng) },
        destinoParticipante: { address: String(p.destino.address), lat: Number(p.destino.lat), lng: Number(p.destino.lng) },
        distanciaKm: null,
        amountDue: valorP,
        pago: false,
        categoria: cat,
        notifMethodOriginal: "ambos",
        // Requisitos especiais (cadeira de ovo, cadeirinha, elevação)
        // — precisa de chegar ao motorista antes de ele sair para a
        // recolha. Propagado para meta.requisitosEspeciais na Trip
        // final, no momento do despacho (ver /evento/estou-pronto).
        requisitosEspeciais: p.requisitosEspeciais && typeof p.requisitosEspeciais === "object"
          ? p.requisitosEspeciais
          : null,
        // Validade do bilhete — chega ao email (bloco preto "válido até")
        // e é usada para expirar/cancelar. Sempre definida (2h por defeito).
        inviteExpiresAt: validUntil ? validUntil.getTime() : null,
      });

      const inviteToken = jwt.sign(
        { typ: "evento_invite", inviteId, eventoId: shareId, contacto: contactoP },
        secret,
        { expiresIn: "24h" }
      );

      criados.push({
        inviteId, token: inviteToken, nome: nomeP, contacto: contactoP, email: emailP,
        valor: valorP, codigo: `EVT-${inviteId}`, otp,
        link: `${publicBase}/hotel-dashboard.html?invite=${encodeURIComponent(inviteToken)}&shareId=${encodeURIComponent(shareId)}&evt=1`,
      });
    }

    // Um único participante — devolve os campos "soltos" de sempre,
    // para o formulário simples continuar a funcionar sem mudar
    // nada. Vários — devolve a lista toda, cada um recebe o próprio
    // link por SMS/email (mesmo mecanismo já usado por
    // /evento/criar), sem abrir nenhum modal de pagamento aqui.
    if (criados.length === 1) {
      const unico = criados[0];
      return res.json({
        ok: true, shareId,
        inviteId: unico.inviteId, token: unico.token, valor: unico.valor, codigo: unico.codigo,
      });
    }

    // Vários participantes — cada um recebe já o link de pagamento
    // por SMS/email (sem esperar pelo modal no ecrã do hotel, que
    // só faz sentido para 1 pessoa de cada vez). Best effort — uma
    // falha de notificação não impede a criação dos restantes.
    if (criados.length > 1) {
      for (const c of criados) {
        const smsBody =
          `De Realmetropolis.\nOlá ${c.nome}, a sua viagem foi reservada!\n` +
          `Código de confirmação: ${c.otp}\n` +
          `Toque no link para pagar a sua parte:\n${c.link}`;
        const emailHtml = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;background:#f5f5f5;color:#222">
          <div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,.06)">
            <p style="margin:0 0 4px;font-size:12px;color:#888;text-align:center">De Realmetropolis</p>
            <h2 style="margin:0 0 12px;font-size:20px;color:#050507;text-align:center">Olá ${c.nome} ✅</h2>
            <p style="margin:0 0 8px;font-size:14px;line-height:1.5;text-align:center">A sua viagem foi reservada. Toque no botão para pagar a sua parte.</p>
            <p style="margin:0 0 20px;font-size:14px;text-align:center">Código de confirmação: <b style="font-family:monospace;font-size:16px;letter-spacing:.05em">${c.otp}</b></p>
            <div style="text-align:center">
              <a href="${c.link}" style="display:inline-block;padding:14px 32px;background:#050507;color:#c4c9d4;font-weight:800;font-size:14px;border-radius:10px;text-decoration:none">PAGAR A MINHA PARTE</a>
            </div>
          </div>
        </body></html>`;
        notificarConvite({
          metodo: "ambos",
          contacto: c.contacto,
          email: c.email || null,
          smsBody,
          emailSubject: "A sua viagem — REALMETROPOLIS",
          emailHtml,
        })
          // Registar SEMPRE o resultado. Antes so havia .catch(): se a
          // funcao devolvesse "nao enviei" sem rebentar, nada aparecia
          // no log e o ecra dizia na mesma que o link tinha sido
          // enviado — impossivel perceber porque nao chegava nada.
          .then((nRes) => {
            console.log(
              `📩 [reserva-simples] ${c.nome} <${c.contacto || "sem contacto"}> ` +
              `sms:${nRes?.smsEnviado} email:${nRes?.emailEnviado}` +
              (nRes?.smsErro   ? ` | erroSMS: ${nRes.smsErro}` : "") +
              (nRes?.emailErro ? ` | erroEmail: ${nRes.emailErro}` : "")
            );
          })
          .catch((err) => console.warn("⚠️ [reserva-simples] falha ao notificar participante:", err?.message));
      }
    }

    return res.json({ ok: true, shareId, participantes: criados });
  } catch (err) {
    console.error("❌ /reserva-simples/criar:", err);
    return res.status(500).json({ ok: false, message: "Erro ao criar reserva." });
  }
});

router.post("/evento/criar", async (req, res) => {
  try {
    const { partida, participantes, categoria, dateTime, mesmoVeiculo } = req.body || {};
    const nomeOrganizadorEvt = String(req.body?.nomeOrganizador || "").replace(/[\r\n]+/g, " ").trim().slice(0, 60);
    const emailOrganizadorEvt = String(req.body?.emailOrganizador || "").trim().toLowerCase().slice(0, 120);

    // Prazo de confirmação — ex: "regresso às 00:00, válido até às
    // 04:00". Opcional; sem isto, a viagem nunca expira (comporta-
    // mento anterior preservado).
    const validUntilRaw = req.body?.validUntil;
    const validUntil = validUntilRaw ? parseDateTime(validUntilRaw) : null;

    // Canal de notificação — "sms" | "email" | "ambos".
    const notifMethod = ["sms", "email", "ambos"].includes(req.body?.notifMethod)
      ? req.body.notifMethod
      : "sms";

    // Quem paga — "hotel" (paga tudo antecipadamente) ou "hospede"
    // (cada convidado recebe o pedido de pagamento individual).
    const pagador = req.body?.pagador === "hotel" ? "hotel" : "hospede";

    // Destino sugerido (opcional) — o concierge pode indicar o
    // "Nosso endereço", um destino provável do hóspede (ex: sabe que
    // o casamento é no Convento do Espinheiro). Não é obrigatório
    // aceitá-lo — o convidado pode escrever outro no bilhete.
    // Se enviado, exige address+lat+lng (para geolocalização válida).
    let destinoSugerido = null;
    if (req.body?.destinoSugerido?.address && req.body.destinoSugerido.lat && req.body.destinoSugerido.lng) {
      destinoSugerido = {
        address: String(req.body.destinoSugerido.address).trim(),
        lat:     Number(req.body.destinoSugerido.lat),
        lng:     Number(req.body.destinoSugerido.lng),
      };
    }

    // Validações
    if (!partida?.lat || !partida?.lng || !partida?.address) {
      return res.status(400).json({ ok: false, message: "partida (lat, lng, address) obrigatório." });
    }
    const list = Array.isArray(participantes) ? participantes : [];
    if (!list.length || list.length > 17) {
      return res.status(400).json({ ok: false, message: "participantes: 1 a 17 contactos." });
    }
    const t = parseDateTime(dateTime);
    if (!t) return res.status(400).json({ ok: false, message: "dateTime obrigatório (formato ISO)." });
    if (!requireMin1h(t)) {
      return res.status(400).json({ ok: false, message: "Reserva deve ter mínimo 1h de antecedência." });
    }
    if (validUntil && validUntil <= t) {
      return res.status(400).json({ ok: false, message: "O prazo de confirmação (validUntil) deve ser depois da hora da viagem." });
    }

    const secret     = getInviteSecret();
    const eventoId   = genShareId();           // reutilizar gerador existente
    const publicBase = getPublicBaseUrl();
    const cat        = String(categoria || "economica");

    // Guardar evento no ShareTrip — campo destino guarda a PARTIDA do evento
    // (reutilizamos o modelo existente; campo destino = local de recolha comum)
    await ShareTrip.create({
      shareId:     eventoId,
      destino: {
        address: String(partida.address),
        lat:     Number(partida.lat),
        lng:     Number(partida.lng),
      },
      nomeOrganizador: nomeOrganizadorEvt,
      emailOrganizador: emailOrganizadorEvt,
      categoria:   cat,
      status:      "active",
      scheduledAt: t,
      validUntil,
      notifMethod,
      pagador,
      createdAt:   Date.now(),
      // flag para distinguir do modo normal
      modoEvento:  true,
      mesmoVeiculo: !!mesmoVeiculo,
    });

    const out = [];
    let totalSmsEnviados = 0;
    let totalEmailEnviados = 0;
    let totalFalharam = 0;

    // Log de diagnóstico — mostra o que está a ser gravado.
    // Se o Mongoose descartar silenciosamente algum campo por não
    // estar no schema, notamos aqui.
    if (destinoSugerido) {
      console.log(`[evento/criar] destinoSugerido a gravar:`, JSON.stringify(destinoSugerido));
    } else {
      console.log(`[evento/criar] SEM destinoSugerido no body (req.body.destinoSugerido = ${JSON.stringify(req.body?.destinoSugerido)})`);
    }

    for (const p of list) {
      const contacto     = normContact(p?.contacto);
      const nome         = String(p?.nome || "Participante").trim();
      const email         = String(p?.email || "").trim().toLowerCase();
      if (!contacto && !email) continue;

      const inviteId     = genInviteId();
      const otp          = genOtp6();
      const otpHash      = await bcrypt.hash(otp, 10);
      // O schema ShareInvite exige `contacto` e `contactoNorm`. Se
      // o participante só tem email, usamos o próprio email como
      // valor sintético — assim o schema fica satisfeito, o índice
      // único não colide, e mais tarde podemos distinguir "invites
      // só-email" dos "invites SMS/ambos" pelo prefixo "email:" que
      // o normContact não gera.
      const contactoDoc     = contacto     || `email:${email}`;
      const contactoNormDoc = normContact(contacto) || `email:${email}`;

      // Guardar no ShareInvite — chave de procura é o inviteId
      // (único). Antes usávamos {shareId, contactoNorm}: se dois
      // participantes fossem enviados sem telemóvel, ambos ficavam
      // com contactoNorm vazio e um sobrescrevia o outro.
      await ShareInvite.updateOne(
        { inviteId },
        {
          $set: {
            inviteId,
            shareId:      eventoId,
            contacto:     contactoDoc,
            contactoNorm: contactoNormDoc,
            nome,
            email,
            otpHash,
            otpExpiresAt:    Date.now() + 30 * 60 * 1000,   // 30 min para verificar OTP
            inviteExpiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24h para definir destino
            attempts:  0,
            usedAt:    null,
            status:    "pendente",
            createdAt: Date.now(),
            scheduledAt: t,
            // Campos específicos do modo evento
            modoEvento:         true,
            partidaEvento:      { address: partida.address, lat: Number(partida.lat), lng: Number(partida.lng) },
            destinoParticipante: null,   // preenchido pelo participante
            distanciaKm:        null,
            amountDue:          null,
            pago:               false,
            categoria:          String(categoria || "economica"),
            destinoSugerido:    destinoSugerido,
            notifMethodOriginal: notifMethod,   // "sms" | "email" | "ambos" — usado pelos avisos 60/15 min
          },
        },
        { upsert: true }
      );

      // JWT do convite — tipo distinto para não misturar com modo normal
      const inviteToken = jwt.sign(
        { typ: "evento_invite", inviteId, eventoId, contacto },
        secret,
        { expiresIn: "24h" }
      );

      // O link leva ao MESMO dashboard usado pelo fluxo Partilha,
      // com &evt=1 a sinalizar "modo evento" — nesse modo, o campo
      // PARTIDA fica pré-preenchido e readonly (o local de embarque
      // é fixado pelo organizador; o convidado só define o SEU
      // destino). Assim reutilizamos todo o fluxo visual da Partilha
      // (OTP → destino → mapa → rota → resumo → pagamento) sem
      // manter uma página paralela.
      const link = `${publicBase}/hotel-dashboard.html?invite=${encodeURIComponent(inviteToken)}&shareId=${encodeURIComponent(eventoId)}&evt=1`;
      console.log("🔗 LINK GERADO (evento):", link);

      const prazoTexto = validUntil
        ? `\nValide até as ${new Date(validUntil).toLocaleString("pt-PT", { hour: "2-digit", minute: "2-digit" })}, ou o bilhete sera cancelado.`
        : "";

      const smsBody =
        `REALMETROPOLIS — Ola ${nome}!\n` +
        `Este e o seu bilhete de viagem. Nao esqueca de validar.\n` +
        `📍 Partida: ${partida.address}\n` +
        `🕐 ${new Date(t).toLocaleString("pt-PT")}\n` +
        `Codigo: ${otp}\n` +
        `Validar o meu bilhete: ${link}` + prazoTexto;

      const emailHtml =
        `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;background:#f5f5f5;color:#222">
          <div style="background:#050507;border-radius:12px;padding:24px;margin-bottom:16px;text-align:center">
            <span style="color:#c4c9d4;font-weight:900;letter-spacing:.12em;font-size:18px">REALMETROPOLIS</span>
          </div>
          <div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,.06)">
            <h2 style="margin:0 0 8px;font-size:20px;color:#050507">Olá ${nome} 👋</h2>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.5">
              <b>Este é o seu bilhete de viagem</b> — por favor, não se esqueça de <b>validar</b>.
            </p>
            <p style="margin:0 0 16px;font-size:13px;color:#666;line-height:1.5">
              Reservado por <b>${nomeOrganizadorEvt || "REALMETROPOLIS"}</b>.
            </p>
            <table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
              <tr>
                <td style="padding:10px;background:#f7f7f9;border-radius:6px 0 0 6px;color:#666;width:120px">📍 Partida</td>
                <td style="padding:10px;background:#f7f7f9;border-radius:0 6px 6px 0"><b>${partida.address}</b></td>
              </tr>
              <tr><td style="height:6px"></td></tr>
              <tr>
                <td style="padding:10px;background:#f7f7f9;border-radius:6px 0 0 6px;color:#666">🕐 Data / Hora</td>
                <td style="padding:10px;background:#f7f7f9;border-radius:0 6px 6px 0"><b>${new Date(t).toLocaleString("pt-PT", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" })}</b></td>
              </tr>
              <tr><td style="height:6px"></td></tr>
              <tr>
                <td style="padding:10px;background:#f7f7f9;border-radius:6px 0 0 6px;color:#666">🔐 Código</td>
                <td style="padding:10px;background:#f7f7f9;border-radius:0 6px 6px 0"><b style="font-family:monospace;font-size:16px;letter-spacing:.05em">${otp}</b></td>
              </tr>
            </table>
            <p style="margin:24px 0 8px;font-size:14px;text-align:center">
              Toque no botão abaixo para <b>definir o seu destino e validar</b> o bilhete:
            </p>
            <div style="text-align:center;margin:20px 0">
              <a href="${link}" style="display:inline-block;padding:14px 32px;background:#050507;color:#c4c9d4;font-weight:800;font-size:15px;border-radius:10px;text-decoration:none;letter-spacing:.02em;border:1px solid #c4c9d4">
                VALIDAR O MEU BILHETE
              </a>
            </div>
            <p style="margin:16px 0 4px;font-size:11px;color:#888;text-align:center">
              Ou copie este link no navegador:<br>
              <a href="${link}" style="color:#8b95a2;word-break:break-all">${link}</a>
            </p>
            ${validUntil ? `
              <div style="margin-top:20px;padding:12px;background:#fff8e6;border-left:3px solid #f0b400;border-radius:4px">
                <p style="margin:0;font-size:13px;color:#8a6d00">
                  ⏰ Valide até <b>${new Date(validUntil).toLocaleString("pt-PT", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}</b>, ou o bilhete será cancelado automaticamente.
                </p>
              </div>` : ""}
          </div>
          <p style="text-align:center;color:#888;font-size:11px;margin-top:20px">
            REALMETROPOLIS &copy; ${new Date().getFullYear()}
          </p>
        </body></html>`;

      const nRes = await notificarConvite({
        metodo: notifMethod,
        contacto: contacto,  // valor real; o serviço normaliza para E.164 internamente. Nunca passar "email:xxx" — não é um número.
        email,
        smsBody,
        emailSubject: "O seu bilhete de viagem — REALMETROPOLIS",
        emailHtml,
      });

      if (nRes.smsEnviado)   totalSmsEnviados++;
      if (nRes.emailEnviado) totalEmailEnviados++;
      if (!nRes.entregue)    totalFalharam++;

      // Log estruturado — se falhou, incluir o motivo por canal para
      // a equipa operacional conseguir diagnosticar (ex: "Twilio não
      // configurado" ≠ "número inválido"). Nada de logs mudos.
      if (nRes.entregue) {
        console.log(`📩 [evento] ${nome} — sms:${nRes.smsEnviado} email:${nRes.emailEnviado}`);
      } else {
        console.warn(`⚠️ [evento] NENHUM canal entregou para ${nome} — motivos:`,
          nRes.erros.map(e => `${e.canal}: ${e.motivo}`).join(" | "));
      }

      out.push({
        contacto,
        nome,
        status:       nRes.entregue ? "pendente" : "erro_envio",
        link,
        smsEnviado:   nRes.smsEnviado,
        emailEnviado: nRes.emailEnviado,
        erros:        nRes.erros,
      });
    }

    const totalEntregues = out.filter(p => p.status === "pendente").length;

    // Se ninguém recebeu, é um erro operacional — o organizador
    // tem de ver, não um "sucesso" mudo. Coletamos os motivos
    // únicos para não repetir a mesma frase 17× ao chamador.
    if (totalEntregues === 0 && out.length > 0) {
      const motivosUnicos = [...new Set(out.flatMap(p => (p.erros || []).map(e => `${e.canal}: ${e.motivo}`)))];
      return res.status(502).json({
        ok: false,
        eventoId,
        message: "Nenhum convite foi entregue. Verifique a configuração do serviço de SMS/email.",
        motivos: motivosUnicos,
        participantes: out,
      });
    }

    return res.json({
      ok: true,
      eventoId,
      participantes: out,
      totalEnviados: totalEntregues,
      totalFalharam,
      totalSmsEnviados,
      totalEmailEnviados,
    });
  } catch(err) {
    console.error("❌ /evento/criar:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

/* ──────────────────────────────────────────────────────────────────
   POST /api/partilha/evento/confirmar-otp
   Body: { token (JWT), otp }
   Devolve: { ok, inviteId, eventoId, nome, partida }
────────────────────────────────────────────────────────────────── */
router.post("/evento/confirmar-otp", async (req, res) => {
  try {
    const { token, otp } = req.body || {};
    if (!token || !otp) {
      return res.status(400).json({ ok: false, message: "token e otp obrigatórios." });
    }

    const secret = getInviteSecret();
    let payload;
    try { payload = jwt.verify(token, secret); }
    catch { return res.status(401).json({ ok: false, message: "Convite inválido ou expirado." }); }

    if (payload?.typ !== "evento_invite") {
      return res.status(400).json({ ok: false, message: "Tipo de convite inválido." });
    }

    const { inviteId, eventoId } = payload;
    const invite = await ShareInvite.findOne({ inviteId, shareId: eventoId });
    if (!invite) return res.status(404).json({ ok: false, message: "Convite não encontrado." });
    if (invite.usedAt) return res.status(409).json({ ok: false, message: "Convite já utilizado." });

    if ((invite.attempts || 0) >= 5) {
      return res.status(429).json({ ok: false, message: "Demasiadas tentativas. Contacte o organizador." });
    }
    if (Date.now() > invite.otpExpiresAt) {
      return res.status(410).json({ ok: false, message: "Código expirado. Peça ao organizador para reenviar." });
    }

    const otpOk = await bcrypt.compare(String(otp).trim(), invite.otpHash);
    if (!otpOk) {
      invite.attempts = (invite.attempts || 0) + 1;
      await invite.save();
      const restantes = 5 - invite.attempts;
      return res.status(400).json({ ok: false, message: `Código incorreto. ${restantes} tentativa(s) restante(s).` });
    }

    // Log de diagnóstico
    console.log(`[evento/confirmar-otp] invite.destinoSugerido =`, JSON.stringify(invite.destinoSugerido));

    // OTP válido — devolver info da partida para o participante
    return res.json({
      ok: true,
      inviteId,
      eventoId,
      nome:       invite.nome,
      partida:    invite.partidaEvento,
      scheduledAt: invite.scheduledAt,
      categoria:   invite.categoria || "economica",
      destinoSugerido: invite.destinoSugerido || null,
      token,      // devolver o mesmo token para usar no passo seguinte
    });
  } catch(err) {
    console.error("❌ /evento/confirmar-otp:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

/* ──────────────────────────────────────────────────────────────────
   POST /api/partilha/evento/definir-destino
   Participante submete o seu destino → sistema calcula preço via OSRM.
   Body: { token, destino: { address, lat, lng } }
   O `token` é o JWT devolvido por /evento/confirmar-otp — ele
   próprio é a autorização. NÃO revalidamos OTP a cada passo (isso
   obrigaria o frontend a guardar o OTP em memória durante todo o
   fluxo, o que é mau padrão).
   Devolve: { ok, preco, distanciaKm, categoria, partida, destino }
────────────────────────────────────────────────────────────────── */
router.post("/evento/definir-destino", async (req, res) => {
  try {
    const { token, destino } = req.body || {};

    if (!token) {
      return res.status(400).json({ ok: false, message: "token obrigatório." });
    }
    if (!destino?.lat || !destino?.lng || !destino?.address) {
      return res.status(400).json({ ok: false, message: "destino (lat, lng, address) obrigatório." });
    }

    const secret = getInviteSecret();
    let payload;
    try { payload = jwt.verify(token, secret); }
    catch { return res.status(401).json({ ok: false, message: "Convite inválido ou expirado." }); }

    if (payload?.typ !== "evento_invite") {
      return res.status(400).json({ ok: false, message: "Tipo de convite inválido." });
    }

    const { inviteId, eventoId } = payload;
    const invite = await ShareInvite.findOne({ inviteId, shareId: eventoId });
    if (!invite) return res.status(404).json({ ok: false, message: "Convite não encontrado." });
    if (invite.usedAt) return res.status(409).json({ ok: false, message: "Convite já utilizado." });

    // Calcular preço via OSRM (partida do evento → destino do participante)
    const partida = invite.partidaEvento;
    let distanciaKm = 0;

    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${partida.lng},${partida.lat};${destino.lng},${destino.lat}?overview=false`;
      const osrmRes  = await fetch(osrmUrl, { headers: { "User-Agent": "RMEvento/1.0" } });
      const osrmData = await osrmRes.json();
      if (osrmData.code === "Ok" && osrmData.routes?.length) {
        distanciaKm = Number((osrmData.routes[0].distance / 1000).toFixed(2));
      }
    } catch(e) {
      console.warn("⚠️ OSRM falhou:", e?.message);
    }

    // Calcular preço por categoria
    const PRECOS_KM = { economica: 0.85, confort: 1.05, executive: 1.35, luxury: 1.75 };
    const cat      = invite.categoria || "economica";
    const valorKm  = PRECOS_KM[cat] || 0.85;
    const preco    = Math.round(Math.max(distanciaKm * valorKm, 5) * 100) / 100;

    // Guardar destino e preço
    invite.destinoParticipante = { address: destino.address, lat: Number(destino.lat), lng: Number(destino.lng) };
    invite.distanciaKm  = distanciaKm;
    invite.amountDue    = preco;
    invite.status       = "destino_definido";
    await invite.save();

    return res.json({
      ok: true,
      inviteId,
      eventoId,
      nome:        invite.nome,
      partida:     partida.address,
      destino:     destino.address,
      distanciaKm,
      preco,
      categoria:   cat,
    });
  } catch(err) {
    console.error("❌ /evento/definir-destino:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

/* ──────────────────────────────────────────────────────────────────
   POST /api/partilha/evento/confirmar-pagamento
   Marcado após pagamento Stripe/PayPal bem-sucedido.
   Body: { token, inviteId, provider, ref }

   NOTA IMPORTANTE (Reserva Flexível — Fase 1):
   Esta rota NÃO despacha o motorista imediatamente. Apenas regista
   o pagamento e envia um SMS/email ao convidado com o link para a
   página "ESTOU PRONTO". O despacho é disparado só quando o
   convidado clicar no botão dessa página — é o coração da Reserva
   Flexível: pagas quando quiseres (para garantir o bilhete) e
   chamas o carro só quando estiveres mesmo pronto.
────────────────────────────────────────────────────────────────── */
/* ── Lógica partilhada de "pagamento confirmado" para Reserva
   Flexível/Evento — extraída para função reutilizável, pelo mesmo
   motivo do confirmarPagamentoPartilha acima: o MB Way e o
   pagamento pelo hotel reaproveitam isto sem duplicar o HTML do
   email.
   Recebe shareId directamente (não um token a decifrar) — assim
   funciona tanto quando já existe um token válido (o hóspede a
   pagar a própria viagem) como quando não existe nenhum ainda (o
   hotel a pagar por ele, antes de o hóspede alguma vez ter aberto
   o link). Se não vier "token", gera um novo aqui mesmo, com a
   mesma forma usada em todo o resto do ficheiro — o link "estou
   pronto" continua a funcionar em qualquer dos dois casos. ── */
async function confirmarPagamentoEvento(shareId, inviteId, provider, ref, io, tokenExistente) {
  const invite = await ShareInvite.findOne({ inviteId, shareId });
  if (!invite) return { ok: false, status: 404, message: "Convite não encontrado." };
  if (!invite.destinoParticipante) {
    return { ok: false, status: 400, message: "Defina o destino antes de pagar." };
  }

  const secret = getInviteSecret();
  const token = tokenExistente || jwt.sign(
    { typ: "evento_invite", inviteId, eventoId: shareId, contacto: invite.contacto },
    secret,
    { expiresIn: "24h" }
  );

  // Idempotência — se este pagamento já foi processado, não repete
  if (invite.pago === true) {
    const publicBase = getPublicBaseUrl();
    const linkPronto = `${publicBase}/hotel-dashboard.html?invite=${encodeURIComponent(token)}&shareId=${encodeURIComponent(shareId)}&evt=1&pronto=1`;
    return { ok: true, message: "Pagamento já registado.", nome: invite.nome, linkPronto };
  }

  invite.pago        = true;
  invite.usedAt      = Date.now();
  invite.status      = "pago";
  invite.payProvider = String(provider || "");
  invite.payRef      = String(ref || "");
  invite.despachadoEm = null;      // ainda NÃO despachado — só quando clicar ESTOU PRONTO

  // Código de confirmação para "chamar o motorista" — gerado só
  // agora (no pagamento), para o hóspede ter de o introduzir antes
  // de acionar a recolha. Evita toques acidentais no link e garante
  // que é mesmo o hóspede. Guardado com hash; validade de 24h.
  const codigoPronto     = genOtp6();
  invite.prontoOtpHash   = await bcrypt.hash(codigoPronto, 10);
  invite.prontoOtpExpira = Date.now() + 24 * 60 * 60 * 1000;
  await invite.save();

  // Notificar organizador em tempo real
  try {
    const trip = await ShareTrip.findOne({ shareId }).lean();
    if (io && trip?.organizadorId) {
      io.to(`user:${trip.organizadorId}`).emit("evento:pagamento", {
        eventoId: shareId,
        inviteId: invite.inviteId,
        nome:     invite.nome,
        contacto: invite.contacto,
        valor:    Number(invite.amountDue || 0),
        destino:  invite.destinoParticipante?.address || "",
        when:     new Date().toISOString(),
      });
    }
  } catch (errSock) {
    console.warn("⚠️ [evento] socket organizador falhou:", errSock?.message);
  }

  // Enviar SMS/email ao convidado com o link "ESTOU PRONTO"
  const publicBase = getPublicBaseUrl();
  const linkProntoLongo = `${publicBase}/hotel-dashboard.html?invite=${encodeURIComponent(token)}&shareId=${encodeURIComponent(shareId)}&evt=1&pronto=1`;
  // Encurtar o link (BASE/v/A7K9F). Se falhar, usa o link longo — o
  // hóspede nunca fica sem link. Expira com o convite (24h).
  let linkPronto = linkProntoLongo;
  try {
    const short = await criarShortLink({
      destino: linkProntoLongo,
      shareId,
      inviteId: invite.inviteId,
      expiraEm: invite.inviteExpiresAt || (Date.now() + 24 * 60 * 60 * 1000),
      baseUrl: publicBase,
    });
    linkPronto = short.url;
  } catch (e) {
    console.warn("⚠️ [shortlink] falhou, a usar link longo:", e?.message);
  }

  // Formatar data de validade (só mostra se o concierge definiu)
  let blocoValidadeHtml = "";
  let smsValidade = "";
  if (invite.inviteExpiresAt) {
    const dt = new Date(invite.inviteExpiresAt);
    const dataFmt = dt.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" });
    const horaFmt = dt.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
    blocoValidadeHtml = `
      <div style="margin-top:24px;background:#050507;border:1px solid #c4c9d4;border-radius:10px;padding:22px 24px">
        <div style="font-size:10px;font-weight:900;letter-spacing:.32em;color:#8b95a2;margin-bottom:6px;text-align:center">
          ATENÇÃO
        </div>
        <div style="text-align:center;font-size:12px;color:#8b95a2;line-height:1.5;margin-bottom:14px">
          Este bilhete está válido até
        </div>
        <div style="text-align:center;font-size:26px;font-weight:800;color:#f4f6f8;letter-spacing:.01em;line-height:1.2;margin-bottom:16px">
          ${dataFmt}<br>
          <span style="font-size:22px;color:#c4c9d4;font-weight:500">às ${horaFmt}</span>
        </div>
        <p style="margin:0;padding-top:14px;border-top:1px solid rgba(196,201,212,.15);font-size:11.5px;color:#8b95a2;line-height:1.6;text-align:center">
          A não utilização do mesmo no tempo e hora acima referidos, o mesmo será cancelado automaticamente.
        </p>
      </div>`;
    smsValidade = `\n\nATENCAO: Bilhete valido ate ${dataFmt} as ${horaFmt}. Apos este prazo sera cancelado automaticamente.`;
  }

  const smsBody =
    `REALMETROPOLIS — Reserva Flexível confirmada, ${invite.nome}!\n` +
    `Código para chamar o motorista: ${codigoPronto}\n` +
    `Quando estiver pronto, toque no link e introduza o código:\n${linkPronto}` +
    smsValidade;

  const emailHtml =
    `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;background:#f5f5f5;color:#222">
      <div style="background:#050507;border-radius:12px;padding:24px;margin-bottom:16px;text-align:center">
        <span style="color:#c4c9d4;font-weight:900;letter-spacing:.12em;font-size:18px">REALMETROPOLIS</span>
      </div>
      <div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,.06)">
        <h2 style="margin:0 0 12px;font-size:20px;color:#050507">Olá ${invite.nome} ✅</h2>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.5">
          A sua <b>Reserva Flexível</b> foi confirmada.
        </p>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.5">
          <b>Quando estiver pronto, clique no botão abaixo e introduza o código para enviarmos o seu motorista.</b>
        </p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.5;text-align:center">
          Código para chamar o motorista:<br>
          <b style="font-family:monospace;font-size:22px;letter-spacing:.1em;color:#050507">${codigoPronto}</b>
        </p>
        <div style="text-align:center;margin:24px 0">
          <a href="${linkPronto}" style="display:inline-block;padding:14px 32px;background:#050507;color:#c4c9d4;font-weight:800;font-size:15px;border-radius:10px;text-decoration:none;letter-spacing:.02em;border:1px solid #c4c9d4">
            CHAMAR O MEU MOTORISTA
          </a>
        </div>
        <p style="margin:16px 0 4px;font-size:11px;color:#888;text-align:center">
          Ou copie este link no navegador:<br>
          <a href="${linkPronto}" style="color:#8b95a2;word-break:break-all">${linkPronto}</a>
        </p>
        ${blocoValidadeHtml}
      </div>
      <p style="text-align:center;color:#888;font-size:11px;margin-top:20px">
        REALMETROPOLIS &copy; ${new Date().getFullYear()}
      </p>
    </body></html>`;

  // Canal = mesmo do convite original (já foi guardado ao criar)
  const metodo = invite.notifMethodOriginal || "sms";
  const contactoLimpo = invite.contacto?.startsWith?.("email:") ? "" : invite.contacto;

  try {
    const nRes = await notificarConvite({
      metodo,
      contacto: contactoLimpo,
      email:    invite.email || null,
      smsBody,
      emailSubject: "Reserva Flexível confirmada — chame o seu motorista quando estiver pronto",
      emailHtml,
    });
    console.log(`📩 [evento/pago] ${invite.nome} — sms:${nRes.smsEnviado} email:${nRes.emailEnviado}`);
  } catch (errN) {
    console.warn(`⚠️ [evento/pago] notificação "estou pronto" falhou:`, errN?.message);
  }

  return {
    ok: true,
    message: "Pagamento confirmado. Foi-lhe enviada uma notificação com o link ESTOU PRONTO.",
    nome: invite.nome,
    linkPronto,
  };
}

router.post("/evento/confirmar-pagamento", async (req, res) => {
  try {
    const { token, inviteId, provider, ref } = req.body || {};
    if (!token || !inviteId) {
      return res.status(400).json({ ok: false, message: "token e inviteId obrigatórios." });
    }

    let payload;
    try { payload = jwt.verify(token, getInviteSecret()); }
    catch { return res.status(401).json({ ok: false, message: "Token inválido." }); }

    const resultado = await confirmarPagamentoEvento(payload.eventoId, inviteId, provider, ref, req.app.get("io"), token);
    if (!resultado.ok) return res.status(resultado.status || 400).json(resultado);
    return res.json(resultado);
  } catch(err) {
    console.error("❌ /evento/confirmar-pagamento:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

/* ══════════════════════════════════════════════════════════════
   MB WAY (via Easypay) — funciona tanto para Partilha como para
   Reserva Flexível/Evento, já que ambas guardam o convite no
   mesmo modelo (ShareInvite). Trazido do antigo "Ticket" (que vai
   deixar de existir) — era a única coisa lá que valia a pena
   guardar, a par do pagamento adiantado pelo hotel.

   POST /api/partilha/invite/mbway/iniciar
   Body (Partilha):  { sessionToken, telefone }
   Body (Evento):    { token, inviteId, telefone }
══════════════════════════════════════════════════════════════ */
router.post("/invite/mbway/iniciar", async (req, res) => {
  try {
    const easypayId  = process.env.EASYPAY_ID  || "";
    const easypayKey = process.env.EASYPAY_KEY || "";
    if (!easypayId || !easypayKey) {
      return res.status(500).json({ ok: false, message: "Easypay não configurado. Adicione EASYPAY_ID e EASYPAY_KEY ao .env" });
    }

    const { sessionToken, token, inviteId, telefone } = req.body || {};
    if (!telefone) return res.status(400).json({ ok: false, message: "Indique o número de telemóvel." });

    // Determinar o modo (Partilha vs Evento) pelo tipo de
    // identificador recebido — mesma distinção já usada nas duas
    // rotas de confirmar-pagamento acima.
    let inv, modo, shareId;
    const secret = getInviteSecret();

    if (sessionToken) {
      modo = "partilha";
      let payload;
      try { payload = jwt.verify(sessionToken, secret); }
      catch { return res.status(401).json({ ok: false, message: "Sessão inválida ou expirada." }); }
      if (payload?.typ !== "share_session") return res.status(401).json({ ok: false, message: "Sessão inválida." });
      shareId = payload.shareId;
      inv = await ShareInvite.findOne({ shareId, contactoNorm: normContact(payload.contacto) });
    } else if (token && inviteId) {
      modo = "evento";
      let payload;
      try { payload = jwt.verify(token, secret); }
      catch { return res.status(401).json({ ok: false, message: "Token inválido." }); }
      shareId = payload.eventoId;
      inv = await ShareInvite.findOne({ inviteId, shareId });
    } else {
      return res.status(400).json({ ok: false, message: "sessionToken, ou token+inviteId, são obrigatórios." });
    }

    if (!inv) return res.status(404).json({ ok: false, message: "Convite não encontrado." });
    if (!inv.amountDue) return res.status(400).json({ ok: false, message: "Valor ainda não calculado para esta viagem." });
    if (inv.status === "pagou" || inv.pago === true) {
      return res.status(400).json({ ok: false, message: "Esta viagem já está paga." });
    }

    // Normaliza número PT: 912345678 → 351912345678
    const telNorm = String(telefone).replace(/\D/g, "").replace(/^0+/, "");
    const telFinal = telNorm.startsWith("351") ? telNorm : "351" + telNorm;

    const baseUrl = process.env.EASYPAY_SANDBOX === "true"
      ? "https://api.test.easypay.pt/2.0"
      : "https://api.easypay.pt/2.0";

    const payRes = await fetch(`${baseUrl}/payment`, {
      method: "POST",
      headers: { "AccountId": easypayId, "ApiKey": easypayKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: ["mbw"],
        key:  inv.inviteId || String(inv._id),
        value: Number(inv.amountDue),
        customer: { name: inv.nome || "", email: inv.email || "", phone: telFinal },
        currency: "EUR",
      }),
    });
    const payData = await payRes.json();
    if (!payData?.id) {
      return res.status(400).json({ ok: false, message: payData?.message || "Erro Easypay." });
    }

    // Guarda tudo o que o webhook vai precisar para retomar a
    // confirmação certa (modo + identificadores), sem depender de
    // o cliente voltar a enviar nada.
    inv.easypayPaymentId = payData.id;
    inv.mbwayPendente = {
      modo, shareId,
      token: modo === "evento" ? token : null,
      inviteId: modo === "evento" ? inviteId : null,
      sessionToken: modo === "partilha" ? sessionToken : null,
    };
    await inv.save();

    return res.json({
      ok: true,
      message: `Pedido MB Way enviado para ${telFinal}. Aceite na app MB Way no prazo de 4 minutos.`,
      paymentId: payData.id,
    });
  } catch (err) {
    console.error("❌ invite/mbway/iniciar:", err);
    return res.status(500).json({ ok: false, message: "Erro ao iniciar MB Way." });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/partilha/invite/easypay/webhook
   Público — Easypay notifica quando o MB Way é aceite no telemóvel.
   Configurar no painel Easypay: Notifications → URL deste endpoint.
══════════════════════════════════════════════════════════════ */
router.post("/invite/easypay/webhook", async (req, res) => {
  try {
    const { id, type, status } = req.body || {};
    if (type !== "payment" || status !== "paid" || !id) {
      return res.json({ ok: true }); // notificação irrelevante, ignora sem erro
    }

    const inv = await ShareInvite.findOne({ easypayPaymentId: id });
    if (!inv || !inv.mbwayPendente) return res.json({ ok: true });
    if (inv.status === "pagou" || inv.pago === true) return res.json({ ok: true }); // já processado

    const io = req.app.get("io");
    const { modo, shareId, token, inviteId, sessionToken } = inv.mbwayPendente;

    if (modo === "partilha") {
      const payload = jwt.verify(sessionToken, getInviteSecret());
      await confirmarPagamentoPartilha(shareId, payload.contacto, "mbway", id, io);
    } else {
      await confirmarPagamentoEvento(shareId, inviteId, "mbway", id, io, token);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ invite/easypay/webhook:", err);
    return res.status(500).json({ ok: false });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/partilha/invite/pagar-pelo-hotel
   Autenticado (hotel/cliente) — o hotel paga adiantado por um
   participante, sem esperar que ele próprio pague. Trazido do
   antigo "Ticket" (que vai deixar de existir) — a par do MB Way,
   era a única coisa lá que valia a pena guardar.

   Só o organizador da viagem (quem a criou, com sessão iniciada)
   pode pagar por um participante dela — confirmado a partir de
   ShareTrip.organizadorId, nunca aceite às cegas do pedido.

   Body: { shareId, inviteId }   (inviteId só obrigatório em modo
                                   Evento — Partilha identifica o
                                   participante só pelo contacto)
          { shareId, contacto }  (modo Partilha)
══════════════════════════════════════════════════════════════ */
router.post("/invite/pagar-pelo-hotel", requireCliente, async (req, res) => {
  try {
    const { shareId, inviteId, contacto } = req.body || {};
    if (!shareId) return res.status(400).json({ ok: false, message: "shareId obrigatório." });

    const trip = await ShareTrip.findOne({ shareId }).lean();
    if (!trip) return res.status(404).json({ ok: false, message: "Viagem não encontrada." });

    // Só quem criou esta viagem pode pagar por um participante dela
    // — nunca confiar num shareId à parte sem confirmar a dono.
    if (String(trip.organizadorId || "") !== String(req.clienteId)) {
      return res.status(403).json({ ok: false, message: "Sem permissão para pagar por esta viagem." });
    }

    const io = req.app.get("io");
    const resultado = trip.modoEvento
      ? await confirmarPagamentoEvento(shareId, inviteId, "hotel", `HOTEL-${req.clienteId}`, io)
      : await confirmarPagamentoPartilha(shareId, contacto, "hotel", `HOTEL-${req.clienteId}`, io);

    if (!resultado.ok) return res.status(resultado.status || 400).json(resultado);
    return res.json(resultado);
  } catch (err) {
    console.error("❌ invite/pagar-pelo-hotel:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

/* ──────────────────────────────────────────────────────────────────
   POST /api/partilha/evento/estou-pronto
   O convidado clicou no botão "ESTOU PRONTO" — dispara o despacho.
   Body: { token, inviteId }

   IDEMPOTÊNCIA: se o convidado clicar duas vezes (duplo clique,
   rede lenta), só a primeira chamada dispara despacho. As seguintes
   devolvem o tripId da viagem já em curso.
────────────────────────────────────────────────────────────────── */
router.post("/evento/estou-pronto", async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ ok: false, message: "token obrigatório." });
    }

    const secret = getInviteSecret();
    let payload;
    try { payload = jwt.verify(token, secret); }
    catch { return res.status(401).json({ ok: false, message: "Convite inválido ou expirado." }); }

    if (payload?.typ !== "evento_invite") {
      return res.status(400).json({ ok: false, message: "Tipo de convite inválido." });
    }

    // inviteId: do body se vier, senão do próprio token (payload) —
    // o modo "chamar motorista" não passa pelo OTP.
    const inviteId = String(req.body?.inviteId || payload.inviteId || "").trim();
    if (!inviteId) {
      return res.status(400).json({ ok: false, message: "Convite inválido." });
    }

    const invite = await ShareInvite.findOne({ inviteId, shareId: payload.eventoId });
    if (!invite) return res.status(404).json({ ok: false, message: "Convite não encontrado." });
    if (!invite.pago) {
      return res.status(409).json({ ok: false, message: "Este bilhete ainda não foi pago." });
    }

    // Validação do código de confirmação — o hóspede tem de introduzir
    // o código que recebeu por SMS/email após o pagamento. Evita toques
    // acidentais no link e confirma a identidade. Só se aplica se ainda
    // não foi despachado (a seguir a idempotência devolve o tripId sem
    // pedir código de novo).
    if (!invite.tripRefId) {
      const codigoRecebido = String(req.body?.codigo || "").trim();
      if (!codigoRecebido) {
        return res.status(400).json({ ok: false, code: "CODIGO_OBRIGATORIO", message: "Introduza o código de confirmação que recebeu." });
      }
      if (invite.prontoOtpExpira && Date.now() > invite.prontoOtpExpira) {
        return res.status(410).json({ ok: false, code: "CODIGO_EXPIRADO", message: "O código expirou. Contacte o suporte." });
      }
      const codigoOk = invite.prontoOtpHash
        ? await bcrypt.compare(codigoRecebido, invite.prontoOtpHash)
        : false;
      if (!codigoOk) {
        return res.status(400).json({ ok: false, code: "CODIGO_INVALIDO", message: "Código incorreto. Verifique o SMS/email que recebeu." });
      }
    }

    // Idempotência: já foi despachado, devolvemos o tripId
    if (invite.tripRefId) {
      return res.json({
        ok: true,
        message: "Motorista já foi requisitado.",
        tripId: String(invite.tripRefId),
        jaDespachado: true,
      });
    }

    if (!invite.destinoParticipante?.lat) {
      return res.status(400).json({ ok: false, message: "Destino em falta no bilhete." });
    }

    // Buscar dados do ShareTrip (contém partida e categoria)
    const trip = await ShareTrip.findOne({ shareId: payload.eventoId }).lean();
    if (!trip) return res.status(404).json({ ok: false, message: "Evento não encontrado." });

    // ── Regra de negócio: Reserva Flexível ──────────────────────
    // O convidado só pode acionar a recolha a partir do horário
    // EXATO estimado por ele/organizador (trip.scheduledAt) — nunca
    // antes. É esta janela (scheduledAt → validUntil) que dá o
    // propósito à Reserva Flexível: evitar cancelamentos por
    // imprevistos (aeroportos, imigração, bagagem, reuniões a
    // acabar mais tarde), sem permitir chamar o motorista muito
    // antes do previsto. Fora deste intervalo, o pedido é recusado
    // com uma mensagem clara — não falha em silêncio.
    const agora = Date.now();
    if (trip.scheduledAt && agora < trip.scheduledAt) {
      const faltamMin = Math.ceil((trip.scheduledAt - agora) / 60000);
      return res.status(409).json({
        ok: false,
        message: `Ainda não pode chamar o motorista. Disponível a partir das ${new Date(trip.scheduledAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })} (faltam ${faltamMin} min).`,
        disponivelEm: trip.scheduledAt,
      });
    }
    if (trip.validUntil && agora > trip.validUntil) {
      return res.status(410).json({
        ok: false,
        message: "O prazo desta Reserva Flexível já expirou. Contacte o suporte.",
      });
    }

    // Marcar despacho ANTES de chamar criarEDespacharViagem — se
    // este UPDATE falhar, o clique é ignorado (não despacha em
    // duplicado). O tripRefId será preenchido depois com o _id
    // real da Trip.
    invite.despachadoEm = new Date();
    await invite.save();

    const io = req.app.get("io");
    const codigo = `EVT-${invite.inviteId}`;

    let viagem;
    try {
      const dispatched = await criarEDespacharViagem({
        tripId:   codigo,
        canal:    "colaborador",
        subcanal: "evento",
        // No ShareTrip do evento, `destino` guarda a PARTIDA fixada
        // pelo remetente (todos partem daí); cada convidado tem o
        // SEU próprio destino em invite.destinoParticipante.
        pickup:  trip.destino?.address || "",
        dropoff: invite.destinoParticipante.address || "",
        when:    new Date(),   // "estou pronto" = agora
        origemGeo:  trip.destino?.lat != null ? { lat: trip.destino.lat, lng: trip.destino.lng, address: trip.destino.address } : null,
        destinoGeo: { lat: invite.destinoParticipante.lat, lng: invite.destinoParticipante.lng, address: invite.destinoParticipante.address },
        customer: { nome: invite.nome || "Participante", contacto: invite.contacto || "" },
        quote:    { categoria: trip.categoria || "", total: Number(invite.amountDue || 0), currency: "EUR" },
        // Identidade do hotel/cliente que criou este evento — mesmo
        // motivo do reservas.routes.js: sem isto, as Classificações
        // e o Relatório SLA nunca conseguiam associar esta Trip a
        // nenhum hotel.
        collaborator: trip.organizadorId ? { collaboratorId: String(trip.organizadorId) } : undefined,
        paymentStatus: "paid",
        meta: {
          origemEvento: true, eventoId: payload.eventoId, inviteId: invite.inviteId, reservaFlexivel: true,
          requisitosEspeciais: invite.requisitosEspeciais || null,
        },
      }, io);
      viagem = dispatched.viagem;
    } catch (errDispatch) {
      // Reverter despachadoEm — o cliente pode tentar de novo
      invite.despachadoEm = null;
      await invite.save().catch(() => {});
      console.error("❌ [evento/estou-pronto] dispatch falhou:", errDispatch?.message);
      return res.status(500).json({
        ok: false,
        message: "Não foi possível despachar o motorista neste momento. Tente novamente em alguns segundos.",
      });
    }

    invite.tripRefId = viagem._id;
    await invite.save();

    // Notificar organizador que o convidado clicou "estou pronto"
    try {
      if (io && trip.organizadorId) {
        io.to(`user:${trip.organizadorId}`).emit("evento:estou-pronto", {
          eventoId: payload.eventoId,
          inviteId: invite.inviteId,
          nome:     invite.nome,
          tripId:   String(viagem._id),
          when:     new Date().toISOString(),
        });
      }
    } catch (_) {}

    console.log(`✅ [evento/estou-pronto] ${invite.nome} — trip ${viagem._id} despachada`);

    return res.json({
      ok: true,
      message: "Motorista requisitado. A procurar disponibilidade próxima.",
      tripId: String(viagem._id),
      codigo,
    });
  } catch(err) {
    console.error("❌ /evento/estou-pronto:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

/* ──────────────────────────────────────────────────────────────────
   GET /api/partilha/evento/motorista-atribuido
   Query: ?token=<jwt-bilhete>&inviteId=<INV-XXXX>

   Verifica se a Trip criada pelo /evento/estou-pronto já tem
   motorista atribuído. Devolve, se sim, todos os dados que o
   frontend precisa (foto, nome, matrícula, modelo, cor, rating,
   lat/lng atual, ETA) — no MESMO formato que showMotoristaOverlay
   já espera no minha-conta.html. Assim o frontend reutiliza a
   função sem alterações.

   SEGURANÇA:
     • Sem requireCliente — o convidado não tem conta.
       Autenticação = posse do JWT do bilhete + inviteId coerente
       com o payload do JWT. Impossível ler motorista de outro
       bilhete.
     • Nunca devolve dados privados do motorista (email, morada,
       BI). Só o que o passageiro precisa de ver.
────────────────────────────────────────────────────────────────── */
router.get("/evento/motorista-atribuido", async (req, res) => {
  try {
    const { token } = req.query || {};
    if (!token) {
      return res.status(400).json({ ok: false, message: "token obrigatório." });
    }

    const secret = getInviteSecret();
    let payload;
    try { payload = jwt.verify(token, secret); }
    catch { return res.status(401).json({ ok: false, message: "Token inválido ou expirado." }); }

    if (payload?.typ !== "evento_invite") {
      return res.status(400).json({ ok: false, message: "Tipo de convite inválido." });
    }
    // inviteId: do query se vier, senão do token
    const inviteId = String(req.query?.inviteId || payload.inviteId || "").trim();
    if (!inviteId) {
      return res.status(400).json({ ok: false, message: "Convite inválido." });
    }

    const invite = await ShareInvite.findOne({ inviteId, shareId: payload.eventoId }).lean();
    if (!invite) return res.status(404).json({ ok: false, message: "Bilhete não encontrado." });

    // Ainda não foi despachado (convidado nem chegou a clicar ESTOU PRONTO)
    if (!invite.tripRefId) {
      return res.json({ ok: true, atribuido: false, aguarda: "estou-pronto" });
    }

    const trip = await Trip.findById(invite.tripRefId)
      .populate("driver.driverId", "nome foto contacto rating lat lng eta veiculo matricula cor")
      .lean();

    if (!trip) {
      return res.json({ ok: true, atribuido: false, aguarda: "trip-nao-existe" });
    }

    // Trip existe mas ainda sem motorista atribuído — o dispatch
    // engine ainda está a procurar. Devolvemos "atribuido:false"
    // e o frontend continua o polling.
    const m = trip.driver?.driverId;
    const estadoOk = ["atribuida", "em_viagem", "aceite", "confirmada", "assigned", "accepted", "in_progress"].includes(String(trip.status || "").toLowerCase());

    if (!m || !estadoOk) {
      return res.json({
        ok: true,
        atribuido: false,
        aguarda: "motorista",
        status: trip.status || "pendente",
      });
    }

    // Buscar veículo se referenciado à parte (opcional — a Trip
    // já tem snapshot em trip.driver.veiculo/matricula quando o
    // motorista foi atribuído; usamos isso se estiver preenchido,
    // senão caímos para o que o Motorista tem no perfil).
    let veiculoSnap   = trip.driver?.veiculo    || m.veiculo    || "";
    let matriculaSnap = trip.driver?.matricula  || m.matricula  || "";
    let corVeiculo    = m.cor || "";
    // Se o snapshot/perfil não têm o veículo, buscá-lo na coleção
    // Veiculo pelo motoristaId — é lá que vive (mesma fonte que o
    // reservas.routes.js já usa). Sem isto, veículo e matrícula
    // apareciam vazios ("—") no cartão do motorista.
    if (!veiculoSnap || !matriculaSnap) {
      try {
        // O motoristaId no veículo pode estar gravado como string OU
        // ObjectId — procuramos pelos dois formatos para garantir que
        // encontramos (foi esta a causa de o veículo vir vazio: m._id
        // é ObjectId, mas na coleção está como string).
        const _midStr = String(m._id);
        const v = await Veiculo.findOne({
          $or: [
            { motoristaId: m._id },
            { motoristaId: _midStr },
          ],
          disponivel: true,
        })
          .select("marca modelo matricula cor")
          .lean()
          || await Veiculo.findOne({
            $or: [{ motoristaId: m._id }, { motoristaId: _midStr }],
          }).select("marca modelo matricula cor").lean();
        if (v) {
          if (!veiculoSnap)   veiculoSnap   = `${v.marca || ""} ${v.modelo || ""}`.trim();
          if (!matriculaSnap) matriculaSnap = v.matricula || "";
          if (!corVeiculo)    corVeiculo    = v.cor || "";
        }
      } catch (errVeic) {
        console.warn("⚠️ [evento/motorista-atribuido] falha a buscar veículo:", errVeic?.message);
      }
    }

    return res.json({
      ok: true,
      atribuido: true,
      tripId: String(trip._id),
      codigo: trip.tripId || "",
      motorista: {
        motoristaNome: m.nome     || "",
        nome:          m.nome     || "",
        foto:          m.foto     || "",
        contacto:      m.contacto || "",
        veiculo:       veiculoSnap,
        matricula:     matriculaSnap,
        cor:           corVeiculo || m.cor || "",
        rating:        m.rating   || 5,
        lat:           m.lat      || null,
        lng:           m.lng      || null,
        eta:           m.eta      || null,
      },
    });
  } catch (err) {
    console.error("❌ /evento/motorista-atribuido:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});


router.get("/evento/status/:eventoId", async (req, res) => {
  try {
    const { eventoId } = req.params;
    const trip = await ShareTrip.findOne({ shareId: eventoId }).lean();
    if (!trip) return res.status(404).json({ ok: false, message: "Evento não encontrado." });

    const invites = await ShareInvite.find({ shareId: eventoId }).lean();

    const participantes = invites.map(inv => ({
      inviteId:     inv.inviteId,
      nome:         inv.nome,
      contacto:     inv.contacto,
      status:       inv.status || "pendente",
      destino:      inv.destinoParticipante?.address || null,
      destinoGeo:   inv.destinoParticipante ? { lat: inv.destinoParticipante.lat, lng: inv.destinoParticipante.lng } : null,
      distanciaKm:  inv.distanciaKm  || null,
      amountDue:    inv.amountDue    || null,
      preco:        inv.amountDue    || null,   // alias legado
      pago:         !!inv.pago,
    }));

    return res.json({
      ok:             true,
      eventoId,
      partida:        trip.destino,     // campo destino no ShareTrip = partida do evento
      categoria:      trip.categoria,
      scheduledAt:    trip.scheduledAt,
      mesmoVeiculo:   trip.mesmoVeiculo || false,
      participantes,
      totalPago:      participantes.filter(p => p.pago).length,
      totalPendente:  participantes.filter(p => !p.pago).length,
      totalComDestino: participantes.filter(p => p.destino).length,
    });
  } catch(err) {
    console.error("❌ /evento/status:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /partilha/minhas-ativas?email=...
   Lista todas as partilhas activas (ainda não despachadas/canceladas)
   criadas por este organizador, com um resumo de cada uma — usado
   pela página/popup "PARTILHAS" no menu hambúrguer, para suportar
   várias partilhas em simultâneo em vez de uma única no rodapé.

   Nota de segurança: filtra por email tal como o resto deste
   ficheiro identifica o organizador (sem sessão/cookie dedicada a
   partilhas) — consistente com o resto da rota /criar, mas é um
   ponto a reforçar mais tarde com autenticação real.
══════════════════════════════════════════════════════════════ */
router.get("/minhas-ativas", async (req, res) => {
  try {
    const email = String(req.query?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false, message: "email obrigatório." });

    const trips = await ShareTrip.find({
      emailOrganizador: email,
      status: { $in: ["active", "despachada"] },
    }).sort({ createdAt: -1 }).lean();

    const partilhasComNull = await Promise.all(
      trips.map(async (t) => {
        const invites = await ShareInvite.find({ shareId: t.shareId }).lean();
        const ativos = invites.filter((i) => i.status !== "falhou" && i.status !== "cancelado");
        const pagos = ativos.filter((i) => i.status === "pagou").length;
        const modoEvento = Boolean(t.modoEvento);

        // Assim que QUALQUER participante já tiver a sua viagem
        // despachada (invite.tripRefId preenchido — é aqui, não no
        // ShareTrip, que o despacho fica registado; ver
        // /evento/estou-pronto), o grupo deixa de ser "pendente" —
        // já não é uma reserva por iniciar, é uma viagem em curso.
        // Sem isto, o grupo ficava para sempre nesta lista, mesmo
        // depois de já ter começado a sério.
        const jaIniciada = invites.some((i) => !!i.tripRefId);
        if (jaIniciada) return null;

        return {
          shareId: t.shareId,
          modoEvento,
          // Evento: "destino" do ShareTrip é, na verdade, a partida
          // fixa do evento (cada participante define o seu destino).
          recolha: modoEvento ? (t.destino?.address || "") : (t.recolha?.address || ""),
          destino: modoEvento ? "Vários destinos" : (t.destino?.address || ""),
          categoria: t.categoria,
          scheduledAt: t.scheduledAt,
          status: t.status,
          reservaCodigo: t.reservaCodigo || null,
          totalParticipantes: ativos.length,
          pagos,
        };
      })
    );
    const partilhas = partilhasComNull.filter((p) => p !== null);

    return res.json({ ok: true, partilhas });
  } catch (err) {
    console.error("❌ partilha/minhas-ativas:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /partilha/grupo/:shareId
   Detalhe completo de um grupo de partilha — recolha, destino, e a
   posição/estado de CADA participante, para desenhar um mapa com
   todas as rotas do grupo (não só a do organizador).
══════════════════════════════════════════════════════════════ */
router.get("/grupo/:shareId", async (req, res) => {
  try {
    const shareId = String(req.params.shareId || "").trim();
    const trip = await ShareTrip.findOne({ shareId }).lean();
    if (!trip) return res.status(404).json({ ok: false, message: "Grupo não encontrado." });

    const invites = await ShareInvite.find({ shareId }).lean();
    const modoEvento = Boolean(trip.modoEvento);

    const participantes = invites.map((i) => ({
      nome: i.nome || i.contacto,
      contacto: i.contacto,
      status: i.status || "pendente",
      lat: i.lat,
      lng: i.lng,
      amountDue: i.amountDue,
      payProvider: i.payProvider || null,
      // Modo evento: cada participante tem o seu próprio destino —
      // a rota desenha-se da partida comum até aqui, não até ao
      // "destino" do ShareTrip (que no modo evento guarda a partida).
      destino: modoEvento ? (i.destinoParticipante || null) : null,
    }));

    return res.json({
      ok: true,
      grupo: {
        shareId,
        modoEvento,
        nomeOrganizador: trip.nomeOrganizador || "",
        // Modo normal: recolha comum, destino comum.
        // Modo evento: o "destino" do ShareTrip é, na verdade, o
        // ponto de partida fixo do evento (reaproveitamento do
        // modelo) — cada participante define o seu próprio destino.
        recolha: modoEvento ? trip.destino : trip.recolha,
        destino: modoEvento ? null : trip.destino,
        categoria: trip.categoria,
        scheduledAt: trip.scheduledAt,
        status: trip.status,
        tripIdNegocio: trip.tripIdNegocio || null,
        participantes,
      },
    });
  } catch (err) {
    console.error("❌ partilha/grupo/:shareId:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

export default router;