import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import crypto    from "crypto";

import Validador from "../models/Validador.js";
import AuditLog from "../models/AuditLog.js";
import Motorista from "../models/Motorista.js";
import Veiculo from "../models/Veiculo.js";
import Colaborador from "../models/colaboradores.js";
import authValidador from "../middlewares/authValidador.js";
import { uploadRegisto } from "../middlewares/upload.middleware.js";

const router = express.Router();
const requireValidador = (req, _res, next) => {
  req.validador = { id: "teste-validador", email: "teste@local", scope: "global" };
  next();
};
console.log("✅ validador.routes.js carregado");

function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase().replace(/\s+/g, "");
}
function isEmailValid(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(v));
}
function getPublicBaseUrl(req) {
  const envUrl = String(process.env.FRONTEND_URL || process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (envUrl) return envUrl;
  const proto = req.headers["x-forwarded-proto"] ? String(req.headers["x-forwarded-proto"]).split(",")[0].trim() : req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`.replace(/\/+$/, "");
}
function getJwtSecret() { return String(process.env.JWT_SECRET || "").trim(); }
function getAdminSecret() { return String(process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || "").trim(); }
function pickFirst(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value;
  }
  return null;
}
function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
function normalizeDocUrl(value, req) {
  const picked = value?.file?.url || value?.file?.path || value?.url || value?.path || value?.src || value?.location || value?.secure_url || value?.filePath || value?.filepath || value?.filename || value || null;
  if (!picked || typeof picked !== "string") return null;
  const raw = picked.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw) || raw.startsWith("data:")) return raw;
  const base = getPublicBaseUrl(req);
  if (raw.startsWith("/")) return `${base}${raw}`;
  if (raw.startsWith("uploads/")) return `${base}/${raw}`;
  if (/\.(jpg|jpeg|png|webp|gif|pdf)$/i.test(raw) && !raw.includes("/")) return `${base}/uploads/${raw.replace(/^\/+/, "")}`;
  return `${base}/${raw.replace(/^\/+/, "")}`;
}

function normalizeMotoristaForValidation(raw, req) {
  const documentos = raw?.documentos || {};
  const docs = raw?.docs || {};
  const validacao = raw?.validacao || {};
  const user = raw?.user || {};
  const perfil = raw?.perfil || {};
  const carta = raw?.carta || {};
  const tvde = raw?.tvde || {};
  const veiculo = raw?.veiculo || {};
  const fotosVeiculoRaw = pickFirst(raw?.fotosVeiculo, raw?.fotos_veiculo, raw?.veiculoFotos, documentos?.fotosVeiculo, docs?.fotosVeiculo, veiculo?.fotos);
  const fotosVeiculo = ensureArray(fotosVeiculoRaw).map((item) => {
    if (typeof item === "string") return normalizeDocUrl(item, req);
    if (item && typeof item === "object") return normalizeDocUrl(pickFirst(item?.file?.url, item?.file?.path, item.url, item.path, item.src, item.filename), req);
    return null;
  }).filter(Boolean);

  return {
    ...raw, _id: raw?._id, id: String(raw?._id || ""),
    nome: pickFirst(raw?.nome, raw?.name, raw?.nomeCompleto, perfil?.nome, user?.nome) || "",
    email: pickFirst(raw?.email, user?.email, perfil?.email) || "",
    telefone: pickFirst(raw?.telefone, raw?.telemovel, raw?.contacto, perfil?.telefone) || "",
    nif: pickFirst(raw?.nif, perfil?.nif, user?.nif) || "",
    aprovacao: pickFirst(raw?.aprovacao, validacao?.status, raw?.estado, raw?.status, "pendente"),
    estado: pickFirst(raw?.estado, raw?.aprovacao, validacao?.status, raw?.status, "pendente"),
    validacao: { ...(validacao || {}), status: pickFirst(validacao?.status, raw?.aprovacao, raw?.estado, raw?.status, "pendente"), observacoes: pickFirst(validacao?.observacoes, raw?.observacoes, "") },
    documentos: {
      ...(documentos || {}),
      // Foto de rosto
      fotoRosto:        normalizeDocUrl(pickFirst(documentos?.fotoRosto, documentos?.selfie, documentos?.fotoPerfil, raw?.fotoRosto, raw?.selfie, perfil?.foto), req),
      fotoPerfil:       normalizeDocUrl(pickFirst(documentos?.fotoPerfil, documentos?.fotoRosto, raw?.fotoPerfil, raw?.fotoRosto, perfil?.foto), req),
      // CC / BI frente
      cc:               normalizeDocUrl(pickFirst(documentos?.cc, documentos?.bi, documentos?.cartaoCidadao, raw?.cc, raw?.bi), req),
      bi:               normalizeDocUrl(pickFirst(documentos?.bi, documentos?.cc, raw?.bi, raw?.cc), req),
      // CC / BI verso
      docIdVerso:       normalizeDocUrl(pickFirst(documentos?.docIdVerso, documentos?.ccVerso, documentos?.biVerso, raw?.docIdVerso, raw?.ccVerso), req),
      ccVerso:          normalizeDocUrl(pickFirst(documentos?.ccVerso, documentos?.docIdVerso, raw?.ccVerso, raw?.docIdVerso), req),
      // Documento de identificação frente (campo directo do formulário)
      docIdFrente:      normalizeDocUrl(pickFirst(documentos?.docIdFrente, documentos?.cc, documentos?.bi, raw?.docIdFrente), req),
      // Título de residência
      tResidencia:      normalizeDocUrl(pickFirst(documentos?.tResidencia, documentos?.tituloResidencia, documentos?.docObgIdFrente, raw?.tResidencia), req),
      tResidenciaVerso: normalizeDocUrl(pickFirst(documentos?.tResidenciaVerso, documentos?.docObgIdVerso, raw?.tResidenciaVerso), req),
      // Documento obrigatório frente/verso (campo directo do formulário)
      docObgIdFrente:   normalizeDocUrl(pickFirst(documentos?.docObgIdFrente, documentos?.tResidencia, raw?.docObgIdFrente), req),
      docObgIdVerso:    normalizeDocUrl(pickFirst(documentos?.docObgIdVerso, documentos?.tResidenciaVerso, raw?.docObgIdVerso), req),
      // Carta de condução
      cartaConducao:    normalizeDocUrl(pickFirst(documentos?.cartaConducao, documentos?.cartaFrente, raw?.cartaConducao, raw?.cartaFrente, carta?.frente), req),
      cartaFrente:      normalizeDocUrl(pickFirst(documentos?.cartaFrente, documentos?.cartaConducao, raw?.cartaFrente, raw?.cartaConducao), req),
      cartaVerso:       normalizeDocUrl(pickFirst(documentos?.cartaVerso, documentos?.cartaConducaoVerso, raw?.cartaVerso, raw?.cartaConducaoVerso), req),
      cartaConducaoVerso: normalizeDocUrl(pickFirst(documentos?.cartaConducaoVerso, documentos?.cartaVerso, raw?.cartaConducaoVerso, raw?.cartaVerso), req),
      // TVDE / IMTT
      tvde:             normalizeDocUrl(pickFirst(documentos?.tvde, documentos?.imttTvde, raw?.tvde, raw?.imttTvde, tvde?.frente), req),
      imttTvde:         normalizeDocUrl(pickFirst(documentos?.imttTvde, documentos?.tvde, raw?.imttTvde, raw?.tvde), req),
      // IBAN comprovativo
      ibanComprovativo: normalizeDocUrl(pickFirst(documentos?.ibanComprovativo, documentos?.iban, raw?.ibanComprovativo, raw?.iban, raw?.comprovativoIban), req),
      iban:             normalizeDocUrl(pickFirst(documentos?.iban, documentos?.ibanComprovativo, raw?.iban, raw?.ibanComprovativo), req),
      // Registo criminal
      registoCriminal:  normalizeDocUrl(pickFirst(documentos?.registoCriminal, raw?.registoCriminal), req),
      // Comprovativo de morada
      comprovativoMorada: normalizeDocUrl(pickFirst(documentos?.comprovativoMorada, raw?.comprovativoMorada), req),
      fotoFrenteVeiculo: normalizeDocUrl(pickFirst(documentos?.fotoFrenteVeiculo, raw?.fotoFrenteVeiculo, veiculo?.fotoFrente), req),
      fotoTrasVeiculo:   normalizeDocUrl(pickFirst(documentos?.fotoTrasVeiculo, raw?.fotoTrasVeiculo, veiculo?.fotoTras), req),
      fotosVeiculo
    }
  };
}

function normalizeVeiculoForValidation(raw, req) {
  const documentos = raw?.documentos || {};
  const docs = raw?.docs || {};
  const validacao = raw?.validacao || {};
  const seguro = raw?.seguro || {};
  const inspecao = raw?.inspecao || {};
  const dua = raw?.dua || {};
  const fotosRaw = pickFirst(raw?.fotos, documentos?.fotos, raw?.imagens, raw?.fotosVeiculo);
  const fotos = ensureArray(fotosRaw).map((item) => {
    if (typeof item === "string") return normalizeDocUrl(item, req);
    if (item && typeof item === "object") return normalizeDocUrl(pickFirst(item?.file?.url, item?.file?.path, item.url, item.path, item.src, item.filename), req);
    return null;
  }).filter(Boolean);

  return {
    ...raw, _id: raw?._id, id: String(raw?._id || ""),
    matricula: pickFirst(raw?.matricula, raw?.placa, raw?.plate) || "",
    marca: pickFirst(raw?.marca, raw?.brand) || "",
    modelo: pickFirst(raw?.modelo, raw?.model) || "",
    ano: pickFirst(raw?.ano, raw?.year) || "",
    cor: pickFirst(raw?.cor, raw?.color) || "",
    aprovacao: pickFirst(raw?.aprovacao, validacao?.status, raw?.estado, raw?.status, "pendente"),
    estado: pickFirst(raw?.estado, raw?.aprovacao, validacao?.status, raw?.status, "pendente"),
    validacao: { ...(validacao || {}), status: pickFirst(validacao?.status, raw?.aprovacao, raw?.estado, raw?.status, "pendente"), observacoes: pickFirst(validacao?.observacoes, raw?.observacoes, "") },
    documentos: {
      ...(documentos || {}),
      dua: normalizeDocUrl(pickFirst(documentos?.dua, docs?.dua, raw?.duaDocumento, raw?.dua, dua?.url, dua?.frente), req),
      seguro: normalizeDocUrl(pickFirst(documentos?.seguro, docs?.seguro, raw?.seguroDocumento, raw?.seguro, seguro?.url), req),
      inspecao: normalizeDocUrl(pickFirst(documentos?.inspecao, docs?.inspecao, raw?.inspecaoDocumento, raw?.inspecao, inspecao?.url), req),
      livrete: normalizeDocUrl(pickFirst(documentos?.livrete, docs?.livrete, raw?.livrete), req),
      fotos
    }
  };
}

function createSmtpTransport() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

async function sendInviteEmail({ to, activationLink, scope }) {
  const transporter = createSmtpTransport();
  const from = String(process.env.SMTP_FROM || process.env.SMTP_USER || "").trim();
  if (!transporter || !from) throw new Error("SMTP não configurado.");
  const scopeLabel = { motoristas: "MOTORISTAS", veiculos: "VEÍCULOS", empresa: "EMPRESA", global: "GLOBAL" }[scope] || "COLABORADORES";
  await transporter.sendMail({
    from, to,
    subject: `REALMETROPOLIS — Convite Validador (${scopeLabel})`,
    html: `<div style="font-family:Arial;max-width:640px;margin:0 auto;padding:18px"><h2>REALMETROPOLIS</h2><p>Foi convidado como <b>Validador</b> para: <b>${scopeLabel}</b>.</p><p><a href="${activationLink}" style="display:inline-block;background:#C0C0C0;color:#000;padding:12px 16px;border-radius:10px;font-weight:bold;text-decoration:none">Ativar conta</a></p><p style="word-break:break-all;color:#1a56db">${activationLink}</p></div>`
  });
}

function requireAdminMaster(req, res, next) {
  try {
    const SECRET = getAdminSecret();
    if (!SECRET) return res.status(500).json({ ok: false, message: "ADMIN_JWT_SECRET não definido." });
    const bearer = String(req.headers.authorization || "").startsWith("Bearer ") ? String(req.headers.authorization).slice(7).trim() : "";
    const token = bearer || String(req.cookies?.admin_token || "").trim();
    if (!token) return res.status(401).json({ ok: false, message: "Sem sessão admin." });
    const payload = jwt.verify(token, SECRET);
    if (String(payload?.tipo || "").toLowerCase() !== "adminmaster") return res.status(403).json({ ok: false, message: "Sem permissão (AdminMaster)." });
    req.admin = payload;
    return next();
  } catch {
    return res.status(401).json({ ok: false, message: "Sessão admin inválida/expirada." });
  }
}

function requireScope(_scopes) {
  return (_req, _res, next) => next();
}

/* =========================================================
   1) CONVIDAR VALIDADOR
========================================================= */
router.post("/invite", requireAdminMaster, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const scope = String(req.body?.scope || "").trim().toLowerCase();
    if (!email || !isEmailValid(email)) return res.status(400).json({ ok: false, message: "Email inválido." });
    if (!["motoristas", "veiculos", "empresa", "global"].includes(scope)) return res.status(400).json({ ok: false, message: "Scope inválido." });
    const secret = getJwtSecret();
    if (!secret) return res.status(500).json({ ok: false, message: "JWT_SECRET não definido." });
    let doc = await Validador.findOne({ email });
    if (!doc) {
      doc = await Validador.create({ email, scope, aprovado: false, passwordHash: "", validacao: { status: "pendente", observacoes: "" } });
    } else {
      doc.scope = scope; doc.aprovado = false;
      doc.validacao = doc.validacao || {}; doc.validacao.status = "pendente";
      await doc.save();
    }
    const setupToken = jwt.sign({ typ: "validador_setup", id: String(doc._id), email: doc.email, scope: doc.scope }, secret, { expiresIn: "48h" });
    const activationLink = `${getPublicBaseUrl(req)}/registo-validador.html?token=${encodeURIComponent(setupToken)}`;
    let emailSent = false, emailError = null;
    try { await sendInviteEmail({ to: doc.email, activationLink, scope: doc.scope }); emailSent = true; }
    catch (err) { emailError = String(err?.message || err); console.warn("⚠️ Falha email validador:", emailError); }
    try { await AuditLog.create({ action: "INVITE_VALIDADOR", actorAdminId: String(req.admin?.id || ""), actorAdminName: req.admin?.usuario || "AdminMaster", targetType: "Validador", targetId: String(doc._id), details: { email: doc.email, scope: doc.scope, emailSent } }); } catch {}
    return res.json({ ok: true, message: emailSent ? "Convite enviado." : "Validador criado, mas email não enviado (ver SMTP).", emailSent, emailError, activationLink: emailSent ? null : activationLink });
  } catch (e) {
    console.error("❌ POST invite validador:", e);
    return res.status(500).json({ ok: false, message: "Erro ao convidar validador" });
  }
});

/* =========================================================
   2) DEFINIR SENHA
========================================================= */
router.post("/definir-senha", async (req, res) => {
  try {
    const token = String(req.body?.token || "");
    const email = normalizeEmail(req.body?.email);
    const senha = String(req.body?.senha || "");
    if (!token) return res.status(400).json({ ok: false, message: "Token ausente." });
    if (!email || !isEmailValid(email)) return res.status(400).json({ ok: false, message: "Email inválido." });
    if (senha.length < 6) return res.status(400).json({ ok: false, message: "Senha deve ter pelo menos 6 caracteres." });
    const secret = getJwtSecret();
    if (!secret) return res.status(500).json({ ok: false, message: "JWT_SECRET não definido." });
    const payload = jwt.verify(token, secret);
    if (payload?.typ !== "validador_setup") return res.status(400).json({ ok: false, message: "Token inválido." });
    if (normalizeEmail(payload?.email) !== email) return res.status(400).json({ ok: false, message: "Email não confere com o convite." });
    const doc = await Validador.findById(payload?.id);
    if (!doc) return res.status(404).json({ ok: false, message: "Validador não encontrado." });
    doc.passwordHash = await bcrypt.hash(senha, 10);
    doc.aprovado = true;
    doc.validacao = doc.validacao || {};
    doc.validacao.status = "aprovado";
    await doc.save();
    return res.json({ ok: true, message: "Conta ativada com sucesso." });
  } catch {
    return res.status(400).json({ ok: false, message: "Token inválido/expirado." });
  }
});

/* =========================================================
   3) LOGIN
========================================================= */
router.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const senha = String(req.body?.senha || "");
    if (!email || !isEmailValid(email))
      return res.status(400).json({ ok: false, message: "Email inválido." });
    if (!senha)
      return res.status(400).json({ ok: false, message: "Informe a senha." });

    const validador = await Validador.findOne({ email });
    if (!validador)
      return res.status(401).json({ ok: false, message: "Credenciais inválidas." });
    if (validador.aprovado !== true)
      return res.status(403).json({ ok: false, message: "Conta ainda não ativada." });
    if (!validador.passwordHash)
      return res.status(403).json({ ok: false, message: "Conta sem senha definida." });

    const senhaValida = await bcrypt.compare(senha, validador.passwordHash);
    if (!senhaValida)
      return res.status(401).json({ ok: false, message: "Credenciais inválidas." });

    const secret = getJwtSecret();
    const token = jwt.sign(
      { typ: "validador_auth", id: String(validador._id), email: validador.email, scope: validador.scope || "motoristas" },
      secret,
      { expiresIn: "12h" }
    );

    // Cookie httpOnly — token nunca exposto ao JavaScript
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    res.cookie("rm_validador_token", token, {
      httpOnly: true,
      secure:   isProd,
      sameSite: "lax",
      maxAge:   12 * 60 * 60 * 1000,
      path:     "/",
    });

    // Registar data/hora do último login
    await Validador.findByIdAndUpdate(validador._id, { ultimoLogin: new Date() });
    console.log("✅ LOGIN VALIDADOR:", validador.email);
    return res.json({
      ok:         true,
      redirectTo: "/validacao-painel.html",
      user: { id: String(validador._id), email: validador.email, scope: validador.scope || "motoristas" }
    });
  } catch (error) {
    console.error("❌ Erro login validador:", error);
    return res.status(500).json({ ok: false, message: "Erro interno no login." });
  }
});

/* =========================================================
   LOGOUT
========================================================= */
router.post("/logout", (req, res) => {
  res.clearCookie("rm_validador_token", { httpOnly: true, sameSite: "lax", path: "/" });
  return res.json({ ok: true, message: "Sessão terminada." });
});

/* =========================================================
   4) ME
========================================================= */
router.get("/me", authValidador, async (req, res) => {
  // authValidador preencheu req.validador com { id, email, scope, typ }
  // Devolvemos com dados completos do BD para o painel mostrar nome, etc.
  try {
    const doc = await Validador.findById(req.validador.id).lean();
    if (!doc) {
      return res.status(401).json({ ok: false, message: "Validador não encontrado." });
    }
    return res.json({
      ok: true,
      validador: {
        id:       String(doc._id),
        email:    doc.email,
        nome:     doc.nome || "",
        scope:    doc.scope || "motoristas",
        aprovado: doc.aprovado,
      },
    });
  } catch (err) {
    console.error("❌ GET /validadores/me:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

/* =========================================================
   5) PAINEL — rota chamada pelo validacao.html
========================================================= */
router.get("/painel", authValidador, async (req, res) => {
  try {
    const motoristas = await Motorista.find({
      $or: [
        { aprovacao: "pendente" },
        { "validacao.status": "pendente" }
      ]
    }).sort({ createdAt: -1 }).lean();

    return res.json(motoristas.map(m => normalizeMotoristaForValidation(m, req)));
  } catch (e) {
    console.error("❌ GET /painel:", e);
    return res.status(500).json([]);
  }
});

/* =========================================================
   6) LISTAR + VALIDAR
========================================================= */
router.get("/validacoes/motoristas", (req, res, next) => next(), requireScope(["motoristas"]), async (req, res) => {
  try {
    const status = String(req.query.status || "pendente").toLowerCase();
    const filter = {};
    if (status !== "all") {
      filter.$or = [{ aprovacao: status }, { "validacao.status": status }, { estado: status }, { status }];
    }
    const motoristas = await Motorista.find(filter).sort({ createdAt: -1 }).lean();
    const normalizados = motoristas.map((item) => normalizeMotoristaForValidation(item, req));
    return res.json({ ok: true, motoristas: normalizados });
  } catch (e) {
    console.error("❌ GET validacoes motoristas:", e);
    return res.status(500).json({ ok: false, message: "Erro ao listar motoristas" });
  }
});

router.post("/validacoes/motoristas/:id", (req, res, next) => next(), requireScope(["motoristas"]), async (req, res) => {
  try {
    const st = String(req.body?.status || "").toLowerCase();
    if (!["aprovado", "rejeitado", "pendente"].includes(st)) return res.status(400).json({ ok: false, message: "status inválido" });

    // Documentos reprovados enviados pelo painel
    const docsReprovados = Array.isArray(req.body?.documentosReprovados) ? req.body.documentosReprovados : [];

    const update = {
      aprovacao: st,
      "validacao.status": st,
      "validacao.observacoes": String(req.body?.observacoes || ""),
      "validacao.validadoEm": new Date(),
      "validacao.validadoPorId": req.validador?.id || null,
      "validacao.validadoPorNome": req.validador?.email || "Validador",
    };

    // Marcar cada documento como recusado com motivos
    docsReprovados.forEach(doc => {
      update[`documentos.${doc.docKey}.status`]  = "recusado";
      update[`documentos.${doc.docKey}.motivos`] = doc.motivos || [];
    });

    // Se reprovado — gerar token de reenvio
    let linkReenvio = null;
    if (st === "rejeitado" && docsReprovados.length) {
      const token     = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      update["reenvio.token"]     = token;
      update["reenvio.tokenHash"] = tokenHash;
      update["reenvio.expiresAt"] = expiresAt;
      update["reenvio.usadoEm"]   = null;
      const appUrl = process.env.APP_URL || "http://localhost:10000";
      linkReenvio = `${appUrl}/reenvio-documentos.html?token=${token}`;
    }

    const motorista = await Motorista.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!motorista) return res.status(404).json({ ok: false, message: "Motorista não encontrado" });

    // Email de reprovação
    if (st === "rejeitado" && docsReprovados.length && linkReenvio) {
      const docs = docsReprovados.map(d => ({ ...d, label: DOC_LABELS[d.docKey] || d.docKey }));
      await enviarEmailReprovacao({
        toMotorista: motorista.email,
        toParceiro:  motorista.gestor?.email || null,
        nome:        motorista.nome,
        docs,
        linkReenvio,
        tipo:        "motorista",
      });
    }

    // ✅ Email de activação quando aprovado
    if (st === "aprovado") {
      await enviarEmailActivacao({ motorista });
    }

    try { await AuditLog.create({ action: "VALIDACAO_MOTORISTA", actorAdminId: String(req.validador?.id || ""), actorAdminName: req.validador?.email || "Validador", targetType: "Motorista", targetId: String(motorista._id), details: { status: st, docsReprovados, by: "validador" } }); } catch {}
    return res.json({ ok: true, motorista, linkReenvio });
  } catch (e) {
    console.error("❌ POST validar motorista:", e);
    return res.status(500).json({ ok: false, message: "Erro ao validar motorista" });
  }
});

router.get("/validacoes/veiculos", (req, res, next) => next(), requireScope(["veiculos"]), async (req, res) => {
  try {
    const status = String(req.query.status || "pendente").toLowerCase();
    const filter = {};
    if (status !== "all") {
      filter.$or = [{ "validacao.status": status }, { aprovacao: status }, { estado: status }, { status }];
    }
    const veiculos = await Veiculo.find(filter).sort({ createdAt: -1 }).lean();
    const normalizados = veiculos.map((item) => normalizeVeiculoForValidation(item, req));
    return res.json({ ok: true, veiculos: normalizados });
  } catch (e) {
    console.error("❌ GET validacoes veiculos:", e);
    return res.status(500).json({ ok: false, message: "Erro ao listar veículos" });
  }
});

router.get("/validacoes/motoristas/:id", (req, res, next) => next(), requireScope(["motoristas"]), async (req, res) => {
  try {
    const motorista = await Motorista.findById(req.params.id).lean();
    if (!motorista) return res.status(404).json({ ok: false, message: "Motorista não encontrado" });
    return res.json({ ok: true, motorista: normalizeMotoristaForValidation(motorista, req) });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Erro ao obter detalhe do motorista" });
  }
});

router.get("/validacoes/veiculos/:id", (req, res, next) => next(), requireScope(["veiculos"]), async (req, res) => {
  try {
    const veiculo = await Veiculo.findById(req.params.id).lean();
    if (!veiculo) return res.status(404).json({ ok: false, message: "Veículo não encontrado" });
    return res.json({ ok: true, veiculo: normalizeVeiculoForValidation(veiculo, req) });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Erro ao obter detalhe do veículo" });
  }
});

router.post("/validacoes/veiculos/:id", (req, res, next) => next(), requireScope(["veiculos"]), async (req, res) => {
  try {
    const st = String(req.body?.status || "").toLowerCase();
    if (!["aprovado", "rejeitado", "pendente"].includes(st)) return res.status(400).json({ ok: false, message: "status inválido" });
    const update = { "validacao.status": st, "validacao.observacoes": String(req.body?.observacoes || ""), "validacao.validadoEm": new Date(), "validacao.validadoPorId": req.validador?.id || null, "validacao.validadoPorNome": req.validador?.email || "Validador", aprovacao: st, estado: st };
    const veiculo = await Veiculo.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!veiculo) return res.status(404).json({ ok: false, message: "Veículo não encontrado" });
    try { await AuditLog.create({ action: "VALIDACAO_VEICULO", actorAdminId: String(req.validador?.id || ""), actorAdminName: req.validador?.email || "Validador", targetType: "Veiculo", targetId: String(veiculo._id), details: { status: st, by: "validador" } }); } catch {}
    return res.json({ ok: true, veiculo });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Erro ao validar veículo" });
  }
});

router.get("/validacoes/colaboradores", (req, res, next) => next(), requireScope(["empresa", "colaboradores"]), async (req, res) => {
  try {
    const status = String(req.query.status || "pendente").toLowerCase();
    const filter = {};
    if (status === "pendente") filter.aprovado = false;
    else if (status === "aprovado") filter.aprovado = true;
    const colaboradores = await Colaborador.find(filter).sort({ createdAt: -1 }).select("empresa nome email contacto tipo concelho cidade aprovado validacao createdAt updatedAt").lean();
    return res.json({ ok: true, colaboradores });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Erro ao listar colaboradores" });
  }
});

router.post("/validacoes/colaboradores/:id", requireValidador, requireScope(["empresa", "colaboradores"]), async (req, res) => {
  try {
    const st = String(req.body?.status || "").toLowerCase();
    if (!["aprovado", "rejeitado"].includes(st)) return res.status(400).json({ ok: false, message: "status inválido" });
    const update = { aprovado: st === "aprovado", "validacao.status": st, "validacao.observacoes": String(req.body?.observacoes || ""), "validacao.validadoEm": new Date(), "validacao.validadoPorId": req.validador?.id || null, "validacao.validadoPorNome": req.validador?.email || "Validador" };
    const colaborador = await Colaborador.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!colaborador) return res.status(404).json({ ok: false, message: "Colaborador não encontrado" });
    try { await AuditLog.create({ action: "VALIDACAO_COLABORADOR", actorAdminId: String(req.validador?.id || ""), actorAdminName: req.validador?.email || "Validador", targetType: "Colaborador", targetId: String(colaborador._id), details: { status: st, by: "validador" } }); } catch {}
    return res.json({ ok: true, colaborador });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Erro ao validar colaborador" });
  }
});



/* ================================================================
   HELPER — email de reprovação
================================================================ */
const DOC_LABELS = {
  fotoRosto:         "Foto de Rosto",
  cc:                "BI / Cartão de Cidadão",
  ccVerso:           "BI / CC — Verso",
  tResidencia:       "Título de Residência",
  tResidenciaVerso:  "Título de Residência — Verso",
  cartaConducao:     "Carta de Condução",
  cartaConducaoVerso:"Carta de Condução — Verso",
  tvde:              "Autorização IMTT / TVDE",
  ibanComprovativo:  "Comprovativo IBAN",
  registoCriminal:   "Registo Criminal",
};

function buildEmailReprovacao({ nome, docs, linkReenvio, tipo = "motorista" }) {
  const docsList = docs.map(d => `
    <li style="margin-bottom:8px">
      <b>${d.label}</b><br>
      ${d.motivos?.length ? `<span style="color:#888">${d.motivos.join(", ")}</span>` : ""}
    </li>`).join("");

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0d0f12;color:#d9dde3;border-radius:12px;overflow:hidden">
      <div style="background:#111;padding:28px;text-align:center;border-bottom:1px solid #2c323a">
        <h1 style="color:gold;font-size:22px;margin:0">REALMETROPOLIS</h1>
      </div>
      <div style="padding:28px">
        <p style="font-size:16px">Olá <b>${nome}</b>,</p>
        <p style="margin-top:12px;color:#b8c0ca">
          Os seguintes documentos do seu registo como <b>${tipo}</b> foram <span style="color:#ff6b6b"><b>recusados</b></span> e necessitam de correção:
        </p>
        <ul style="margin:18px 0;padding-left:20px;color:#d9dde3">${docsList}</ul>
        <div style="text-align:center;margin:28px 0">
          <a href="${linkReenvio}" style="background:linear-gradient(135deg,#d4a800,gold);color:#111;font-weight:900;text-decoration:none;padding:14px 28px;border-radius:50px;font-size:15px">
            CORRIGIR DOCUMENTOS
          </a>
        </div>
        <p style="color:#8b95a2;font-size:13px">
          O link é válido por 7 dias. Se tiver dúvidas, contacte o seu gestor.
        </p>
      </div>
    </div>`;
}

/* ================================================================
   enviarEmailActivacao — email ao motorista quando aprovado
   Gera JWT 48h com typ:"motorista_setup" e envia link de primeiro acesso
================================================================ */
async function enviarEmailActivacao({ motorista }) {
  try {
    if (!motorista?.email) {
      console.warn("⚠️ enviarEmailActivacao: motorista sem email");
      return { ok: false };
    }

    const secret = String(process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || "").trim();
    if (!secret) {
      console.error("❌ enviarEmailActivacao: JWT_SECRET não definido");
      return { ok: false };
    }

    // Gerar token de activação (48h)
    const activationToken = jwt.sign(
      { typ: "motorista_setup", id: String(motorista._id), email: motorista.email },
      secret,
      { expiresIn: "48h" }
    );

    // Guardar hash no motorista para validação posterior
    const tokenHash = crypto.createHash("sha256").update(activationToken).digest("hex");
    await Motorista.updateOne(
      { _id: motorista._id },
      { $set: {
        "convite.tokenHash": tokenHash,
        "convite.expiresAt": new Date(Date.now() + 48 * 60 * 60 * 1000),
        "convite.usadoEm":   null,
      }}
    );

    const baseUrl         = String(process.env.FRONTEND_BASE_URL || process.env.APP_URL || "http://localhost:10000").replace(/\/$/, "");
    const activationLink  = `${baseUrl}/motorista-definir-senha.html?token=${encodeURIComponent(activationToken)}`;
    const nome            = motorista.nome || "Motorista";

    const transporter = createSmtpTransport();
    const html = `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#050507;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#050507;padding:40px 16px;">
  <tr><td align="center">
    <table width="100%" style="max-width:520px;background:#0a0b0e;border:1px solid rgba(255,255,255,.1);border-radius:18px;overflow:hidden;">

      <!-- Stripe -->
      <tr><td style="height:3px;background:linear-gradient(90deg,#19d68b,#06b6d4)"></td></tr>

      <!-- Header -->
      <tr><td style="padding:24px 32px 20px;border-bottom:1px solid rgba(255,255,255,.07);">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:middle">
            <div style="width:38px;height:38px;border-radius:50%;border:1.5px solid rgba(212,216,223,.3);background:rgba(212,216,223,.05);display:inline-block;text-align:center;line-height:38px;font-size:11px;font-weight:700;color:#c4c9d4;letter-spacing:.06em">RM</div>
            <span style="margin-left:12px;font-size:11px;font-weight:700;color:#c4c9d4;letter-spacing:.2em;text-transform:uppercase;vertical-align:middle">REALMETROPOLIS</span>
          </td>
          <td align="right">
            <span style="display:inline-block;padding:4px 12px;border-radius:999px;font-size:10px;font-weight:700;background:rgba(25,214,139,.1);color:#19d68b;border:1px solid rgba(25,214,139,.25)">✅ APROVADO</span>
          </td>
        </tr></table>
      </td></tr>

      <!-- Body -->
      <tr><td style="padding:32px 32px 28px">
        <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#fff;letter-spacing:-.02em">🚗 Documentos aprovados!</h2>
        <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
          Olá <b style="color:#c4c9d4">${nome}</b>,<br>
          Os seus documentos foram analisados e <b style="color:#19d68b">aprovados com sucesso</b>. Já pode activar a sua conta e começar a receber viagens.
        </p>

        <!-- Checklist -->
        <div style="background:rgba(25,214,139,.05);border:1px solid rgba(25,214,139,.15);border-radius:12px;padding:16px 20px;margin-bottom:28px">
          <p style="margin:0;font-size:13px;color:rgba(25,214,139,.9);line-height:1.9">
            ✅ Identidade verificada<br>
            ✅ Documentação completa<br>
            ✅ Carta de condução válida<br>
            ✅ Conta aprovada para operar
          </p>
        </div>

        <!-- CTA -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
          <tr><td align="center">
            <a href="${activationLink}"
               style="display:inline-block;padding:16px 40px;border-radius:14px;
                      background:linear-gradient(180deg,#dde2e8,#adb4be);
                      color:#060708;font-weight:700;font-size:15px;
                      text-decoration:none;letter-spacing:.04em;
                      box-shadow:0 8px 24px rgba(255,255,255,.1)">
              🔐 ACTIVAR CONTA E ENTRAR
            </a>
          </td></tr>
        </table>

        <!-- Steps -->
        <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:16px 20px;margin-bottom:20px">
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#c4c9d4;letter-spacing:.06em;text-transform:uppercase">Como activar</p>
          <p style="margin:0;font-size:12px;color:#475569;line-height:1.9">
            1. Clique no botão acima<br>
            2. Defina a sua palavra-passe<br>
            3. Entre na área do motorista<br>
            4. Comece a receber viagens
          </p>
        </div>

        <!-- Fallback link -->
        <p style="margin:0 0 4px;font-size:11px;color:#374151">Ou copie este link no browser:</p>
        <p style="margin:0;font-size:10px;color:#374151;word-break:break-all;background:rgba(255,255,255,.03);border-radius:8px;padding:8px 10px">${activationLink}</p>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:16px 32px;border-top:1px solid rgba(255,255,255,.06)">
        <p style="margin:0;font-size:10px;color:#1f2937;text-align:center">
          Este link é válido por 48 horas · REALMETROPOLIS
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

    await transporter.sendMail({
      from:    `"REALMETROPOLIS" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to:      motorista.email,
      subject: "✅ Documentos aprovados — Active a sua conta REALMETROPOLIS",
      html,
    });

    console.log(`✅ Email activação enviado → ${motorista.email}`);
    return { ok: true, activationLink };
  } catch (err) {
    console.error("❌ Falha email activação:", err.message);
    return { ok: false, error: err.message };
  }
}

async function enviarEmailReprovacao({ toMotorista, toParceiro, nome, docs, linkReenvio, tipo }) {
  try {
    const transporter = createSmtpTransport();
    const html = buildEmailReprovacao({ nome, docs, linkReenvio, tipo });
    const subject = `REALMETROPOLIS — Documentos para corrigir (${nome})`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to:   toMotorista,
      cc:   toParceiro || undefined,
      subject,
      html,
    });
    console.log(`✅ Email reprovação enviado → ${toMotorista}${toParceiro ? " + " + toParceiro : ""}`);
  } catch (err) {
    console.error("❌ Falha email reprovação:", err.message);
  }
}

/* ================================================================
   POST /api/validadores/validacoes/motoristas/:id — com email
================================================================ */

/* ================================================================
   GET /api/validacoes/reenvio/:token
   Público — valida token e devolve docs para corrigir
================================================================ */
router.get("/reenvio/motorista/:token", async (req, res) => {
  try {
    const tokenHash = crypto.createHash("sha256").update(req.params.token).digest("hex");
    const motorista = await Motorista.findOne({
      "reenvio.tokenHash": tokenHash,
      "reenvio.expiresAt": { $gt: new Date() },
      "reenvio.usadoEm":   null,
    }).lean();

    if (!motorista) return res.status(404).json({ ok: false, message: "Link inválido ou expirado." });

    // Documentos com status recusado
    const docs = Object.entries(motorista.documentos || {})
      .filter(([, v]) => v?.status === "recusado")
      .map(([key, v]) => ({ docKey: key, label: DOC_LABELS[key] || key, motivos: v.motivos || [] }));

    return res.json({
      ok: true,
      nome:     motorista.nome,
      email:    motorista.email,
      modo:     "motoristas",
      documentosParaCorrigir: docs,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Erro ao validar token." });
  }
});

/* ================================================================
   POST /api/validacoes/reenvio/motorista/:token
   Público — aceita documentos corrigidos
================================================================ */
router.post("/reenvio/motorista/:token",
  (req, _res, next) => { req.registoId = crypto.randomUUID(); next(); },
  uploadRegisto.any(),
  async (req, res) => {
    try {
      const tokenHash = crypto.createHash("sha256").update(req.params.token).digest("hex");
      const motorista = await Motorista.findOne({
        "reenvio.tokenHash": tokenHash,
        "reenvio.expiresAt": { $gt: new Date() },
        "reenvio.usadoEm":   null,
      });

      if (!motorista) return res.status(404).json({ ok: false, message: "Link inválido ou expirado." });

      const files = {};
      (req.files || []).forEach(f => { files[f.fieldname] = [f]; });

      function toDoc(fileArray) {
        if (!Array.isArray(fileArray) || !fileArray[0]) return null;
        const f = fileArray[0];
        const rawPath = String(f.path || f.filename || "").replace(/\\/g, "/");
        const uploadsIdx = rawPath.indexOf("uploads/");
        const relativePath = uploadsIdx !== -1 ? "/" + rawPath.slice(uploadsIdx) : "/uploads/" + f.filename;
        return { file: { path: relativePath, filename: f.filename, mimetype: f.mimetype }, status: "pendente", motivos: [] };
      }

      const update = {};
      Object.keys(files).forEach(key => {
        if (motorista.documentos?.[key] !== undefined) {
          update[`documentos.${key}`] = toDoc(files[key]);
        }
      });
      update["reenvio.usadoEm"] = new Date();
      update["aprovacao"] = "pendente";
      update["validacao.status"] = "pendente";

      await Motorista.findByIdAndUpdate(motorista._id, { $set: update });

      return res.json({ ok: true, message: "Documentos recebidos. Em análise." });
    } catch (err) {
      console.error("❌ reenvio motorista:", err);
      return res.status(500).json({ ok: false, message: "Erro ao processar reenvio." });
    }
  }
);

/* =========================================================
   REGISTAR VALIDADOR (via formulário de convite)
   POST /api/validadores/registar
   Aceita multipart/form-data com dados + documentos.
   Valida o token do convite, cria/actualiza o validador
   com todos os dados e define a senha.
========================================================= */
router.post("/registar",
  (req, _res, next) => { req.registoId = crypto.randomBytes(8).toString("hex"); next(); },
  uploadRegisto.fields([
    { name: "doc_cc_frente", maxCount: 1 },
    { name: "doc_cc_verso",  maxCount: 1 },
    { name: "doc_morada",    maxCount: 1 },
    { name: "doc_outro",     maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const body = req.body || {};
      const token    = String(body.token    || "").trim();
      const nome     = String(body.nome     || "").trim();
      const nif      = String(body.nif      || "").trim();
      const cc       = String(body.cc       || "").trim();
      const contacto = String(body.contacto || "").trim();
      const endereco = String(body.endereco || "").trim();
      const email    = normalizeEmail(body.email);
      const password = String(body.password || "").trim();

      if (!token)    return res.status(400).json({ ok: false, message: "Token ausente." });
      if (!nome)     return res.status(400).json({ ok: false, message: "Nome obrigatório." });
      if (!email || !isEmailValid(email)) return res.status(400).json({ ok: false, message: "Email inválido." });
      if (password.length < 8) return res.status(400).json({ ok: false, message: "Senha deve ter pelo menos 8 caracteres." });

      const secret = getJwtSecret();
      if (!secret) return res.status(500).json({ ok: false, message: "JWT_SECRET não definido." });

      let payload;
      try { payload = jwt.verify(token, secret); }
      catch { return res.status(400).json({ ok: false, message: "Token inválido ou expirado." }); }

      if (payload?.typ !== "validador_setup")
        return res.status(400).json({ ok: false, message: "Token inválido." });

      const doc = await Validador.findById(payload?.id);
      if (!doc) return res.status(404).json({ ok: false, message: "Validador não encontrado." });

      // Processar documentos
      function toDoc(fieldName) {
        const files = req.files?.[fieldName];
        if (!Array.isArray(files) || !files[0]) return null;
        const f = files[0];
        const rawPath = String(f.path || f.filename || "").replace(/\\/g, "/");
        const idx = rawPath.indexOf("uploads/");
        return {
          file: {
            path:     idx !== -1 ? "/" + rawPath.slice(idx) : "/uploads/" + f.filename,
            filename: f.filename,
            mimetype: f.mimetype,
          },
          status: "pendente",
        };
      }

      const tipoDoc = String(body.tipoDoc || "cc").trim();

      doc.nome          = nome;
      doc.nif           = nif;
      doc.cc            = cc;
      doc.contacto      = contacto;
      doc.endereco      = endereco;
      doc.email         = email;
      doc.tipoDocumento = tipoDoc; // "cc" ou "titulo_residencia"
      doc.scope         = String(body.scope || payload?.scope || doc.scope || "motoristas");
      doc.passwordHash  = await bcrypt.hash(password, 10);
      doc.aprovado      = false;  // Fica pendente até o admin validar os documentos
      doc.validacao     = { ...(doc.validacao || {}), status: "pendente" };

      // Guardar documentos conforme tipo seleccionado
      const docFrente = toDoc("doc_cc_frente");
      const docVerso  = toDoc("doc_cc_verso");

      // Schema Validador tem: ccFrente, ccVerso, morada, outro
      doc.documentos = {
        ccFrente: docFrente,
        ccVerso:  docVerso,
        morada:   toDoc("doc_morada"),
        outro:    toDoc("doc_outro"),
      };
      // Guardar também o tipo de documento
      doc.tipoDocumento = tipoDoc;

      await doc.save();

      console.log("✅ Validador registado:", email);
      return res.json({ ok: true, success: true, message: "Registo concluído com sucesso. Pode agora fazer login." });
    } catch (err) {
      console.error("❌ POST /validadores/registar:", err);
      return res.status(500).json({ ok: false, message: err.message || "Erro ao registar validador." });
    }
  }
);


/* =========================================================
   ADMIN — Listar validadores
   GET /api/admin/validadores/listar?status=todos|pendente|aprovado
========================================================= */
router.get("/listar", requireAdminMaster, async (req, res) => {
  try {
    const status = String(req.query.status || "todos").toLowerCase();
    const filtro = {};
    if (status === "pendente") filtro.aprovado = false;
    if (status === "aprovado") filtro.aprovado = true;

    const validadores = await Validador.find(filtro)
      .sort({ createdAt: -1 })
      .select("nome email scope aprovado createdAt ultimoLogin validacao nif cc contacto endereco tipoDocumento documentos")
      .lean();

    return res.json({ ok: true, validadores });
  } catch (err) {
    console.error("❌ GET /validadores/listar:", err);
    return res.status(500).json({ ok: false, message: "Erro ao listar validadores." });
  }
});

/* =========================================================
   ADMIN — Aprovar validador
   POST /api/admin/validadores/aprovar/:id
========================================================= */
router.post("/aprovar/:id", requireAdminMaster, async (req, res) => {
  try {
    const doc = await Validador.findByIdAndUpdate(
      req.params.id,
      { aprovado: true, "validacao.status": "aprovado", "validacao.validadoEm": new Date() },
      { new: true }
    );
    if (!doc) return res.status(404).json({ ok: false, message: "Validador não encontrado." });
    return res.json({ ok: true, message: "Validador aprovado.", validador: doc });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Erro ao aprovar validador." });
  }
});

/* =========================================================
   ADMIN — Desativar validador
   POST /api/admin/validadores/desativar/:id
========================================================= */
router.post("/desativar/:id", requireAdminMaster, async (req, res) => {
  try {
    const doc = await Validador.findByIdAndUpdate(
      req.params.id,
      { aprovado: false, "validacao.status": "desativado" },
      { new: true }
    );
    if (!doc) return res.status(404).json({ ok: false, message: "Validador não encontrado." });
    return res.json({ ok: true, message: "Validador desativado." });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Erro ao desativar validador." });
  }
});


/* =========================================================
   ADMIN — Excluir validador (elimina permanentemente do DB)
   DELETE /api/admin/validadores/excluir/:id
========================================================= */
router.delete("/excluir/:id", requireAdminMaster, async (req, res) => {
  try {
    const doc = await Validador.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, message: "Validador não encontrado." });
    console.log("🗑 Validador eliminado:", doc.email);
    try {
      await AuditLog.create({
        action:          "EXCLUIR_VALIDADOR",
        actorAdminId:    String(req.admin?.id || ""),
        actorAdminName:  req.admin?.usuario || "AdminMaster",
        targetType:      "Validador",
        targetId:        String(doc._id),
        details:         { email: doc.email, scope: doc.scope },
      });
    } catch {}
    return res.json({ ok: true, message: "Validador eliminado permanentemente." });
  } catch (err) {
    console.error("❌ DELETE /validadores/excluir:", err);
    return res.status(500).json({ ok: false, message: "Erro ao eliminar validador." });
  }
});


export default router;