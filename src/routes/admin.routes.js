// src/routes/admin.routes.js
import express from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import fs from "fs";
import nodemailer from "nodemailer";
import AdminQuoteConfig from "../models/AdminQuoteConfig.js";

import Motorista from "../models/Motorista.js";
import Veiculo from "../models/Veiculo.js";
import Trip from "../models/Trip.js";
import AuditLog from "../models/AuditLog.js";
import Colaborador from "../models/colaboradores.js";
import KmConfig from "../models/KmConfig.js";
import VehicleCategoryRule, { normalizarMarcaModelo, CATEGORIAS_VALIDAS } from "../models/VehicleCategoryRule.js";

const router = express.Router();

/* =========================================================
   Helpers Admin Auth
   ========================================================= */

function getAdminSecret() {
  return String(process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || "").trim();
}

router.use((req, _res, next) => {
  try {
    const SECRET = getAdminSecret();
    if (!SECRET) return next();

    const auth = String(req.headers.authorization || "");
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const cookieTok = String(req.cookies?.admin_token || "").trim();

    const token = bearer || cookieTok;
    if (!token) return next();

    const payload = jwt.verify(token, SECRET);

    const isMaster =
      payload?.tipo === "adminmaster" ||
      payload?.typ === "admin_master" ||
      payload?.isAdminMaster === true;

    if (isMaster) {
      payload.tipo = "adminmaster";
      payload.typ = "admin_master";
      payload.isAdminMaster = true;
      req.admin = payload;
    } else {
      req.admin = null;
    }
  } catch {
    req.admin = null;
  }
  return next();
});

function requireAdmin(req, res, next) {
  if (!req.admin) {
    return res.status(401).json({ ok: false, message: "NÃ£o autenticado" });
  }
  return next();
}

/* =========================================================
   Helpers gerais
   ========================================================= */

function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase().replace(/\s+/g, "");
}

function isEmailValid(v) {
  const s = normalizeEmail(v);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function normalizeTipo(v) {
  const t = String(v || "").trim().toLowerCase();
  if (["frota", "hotel", "alojamento"].includes(t)) return t;
  if (t === "alojamento local") return "alojamento";
  return "";
}

function getPublicBaseUrl(req) {
  const envUrl = String(process.env.FRONTEND_URL || "").trim().replace(/\/+$/, "");
  if (envUrl) return envUrl;

  const proto = req.headers["x-forwarded-proto"]
    ? String(req.headers["x-forwarded-proto"]).split(",")[0].trim()
    : req.protocol;

  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function getJwtSecretForColab() {
  return String(process.env.JWT_SECRET || process.env.COLAB_JWT_SECRET || "").trim();
}

function asTrimmed(v) {
  return String(v || "").trim();
}

function asUpper(v) {
  return asTrimmed(v).toUpperCase();
}

function safeJsonParse(v, fallback = []) {
  try {
    const parsed = JSON.parse(v);
    return parsed;
  } catch {
    return fallback;
  }
}

function safeDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fileMeta(file) {
  if (!file) return null;
  return {
    filename: file.filename,
    mimetype: file.mimetype,
    size: file.size,
    url: `/uploads/${file.filename}`,
    path: `public/uploads/${file.filename}`,
  };
}

function buildDocPayload({ file, nome, numeroDocumento, validade, tipo }) {
  return {
    file: fileMeta(file || null),
    validade: safeDate(validade),
    meta: {
      nome: asTrimmed(nome),
      numeroDocumento: asTrimmed(numeroDocumento),
      validade: asTrimmed(validade),
      tipo: asTrimmed(tipo),
    },
  };
}

function buildFaceDoc(file) {
  return {
    file: fileMeta(file || null),
    validade: null,
    meta: {
      nome: "",
      numeroDocumento: "",
      validade: "",
      tipo: "Foto do Rosto",
    },
  };
}

function ensureVehicleReadShape(doc) {
  const v = doc && typeof doc.toObject === "function" ? doc.toObject() : { ...(doc || {}) };
  const documentos = v.documentos || {};
  const fotosTop = Array.isArray(v.fotos) ? v.fotos : [];

  return {
    ...v,
    documentos: {
      ...documentos,
      fotos: fotosTop,
    },
  };
}

/* =========================================================
   SMTP / Convites
   ========================================================= */

function createSmtpTransport() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

async function sendColabInviteEmail({ to, activationLink, empresa, contacto, tipo, nome }) {
  const transporter = createSmtpTransport();
  const from =
    String(process.env.SMTP_FROM || "").trim() ||
    String(process.env.SMTP_USER || "").trim();

  if (!transporter || !from) {
    throw new Error(
      "SMTP nÃ£o configurado. Defina SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM no .env"
    );
  }

  // activationLink aponta para convite-registo-gestor.html (formulÃ¡rio)
  const tipoLabel = tipo === "frota"      ? "Operador de Frota"
                  : tipo === "hotel"      ? "Hotel"
                  : tipo === "alojamento" ? "Alojamento" : String(tipo || "Parceiro");

  const subject = "REALMETROPOLIS â€” Convite de Registo";
  const html = `<!DOCTYPE html>
<html lang="pt">
<body style="margin:0;padding:0;background:#050507;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0"
  style="background:linear-gradient(180deg,#0e1012,#08090b);
         border:1px solid rgba(196,201,212,.18);border-radius:18px;
         overflow:hidden;max-width:560px;width:100%;">
  <tr>
    <td style="padding:22px 28px 18px;border-bottom:1px solid rgba(196,201,212,.10);">
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="width:42px;height:42px;border-radius:50%;border:1.5px solid rgba(196,201,212,.35);
                   text-align:center;vertical-align:middle;background:#0a0c0f;
                   color:#c4c9d4;font-weight:900;font-size:11px;">RM</td>
        <td style="padding-left:12px;color:#c4c9d4;font-size:14px;font-weight:900;
                   letter-spacing:.12em;">REALMETROPOLIS</td>
      </tr></table>
    </td>
  </tr>
  <tr><td style="padding:28px 28px 24px;">
    <p style="color:#edf0f5;font-size:20px;font-weight:900;margin:0 0 8px;">Convite de Registo</p>
    <p style="color:#8b95a2;font-size:13px;margin:0 0 20px;line-height:1.55;">
      Foi convidado para se registar como <b style="color:#c4c9d4;">${tipoLabel}</b>
      na plataforma REALMETROPOLIS.<br>
      Os seus dados estÃ£o prÃ©-preenchidos. Apenas carregue os documentos e submeta o registo.
    </p>
    <table cellpadding="0" cellspacing="0" width="100%"
      style="margin-bottom:22px;background:rgba(196,201,212,.05);
             border:1px solid rgba(196,201,212,.12);border-radius:12px;overflow:hidden;">
      <tr style="border-bottom:1px solid rgba(196,201,212,.08);">
        <td style="padding:10px 14px;width:34%;background:rgba(0,0,0,.15);">
          <p style="margin:0;color:#5f6874;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Empresa</p>
        </td>
        <td style="padding:10px 14px;">
          <p style="margin:0;color:#edf0f5;font-size:13px;font-weight:700;">${String(empresa||"â€”")}</p>
        </td>
      </tr>
      <tr style="border-bottom:1px solid rgba(196,201,212,.08);">
        <td style="padding:10px 14px;background:rgba(0,0,0,.15);">
          <p style="margin:0;color:#5f6874;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Email</p>
        </td>
        <td style="padding:10px 14px;">
          <p style="margin:0;color:#edf0f5;font-size:13px;font-weight:700;">${String(to||"â€”")}</p>
        </td>
      </tr>
      <tr style="border-bottom:1px solid rgba(196,201,212,.08);">
        <td style="padding:10px 14px;background:rgba(0,0,0,.15);">
          <p style="margin:0;color:#5f6874;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Contacto</p>
        </td>
        <td style="padding:10px 14px;">
          <p style="margin:0;color:#edf0f5;font-size:13px;font-weight:700;">${String(contacto||"â€”")}</p>
        </td>
      </tr>
      ${nome ? `<tr>
        <td style="padding:10px 14px;background:rgba(0,0,0,.15);">
          <p style="margin:0;color:#5f6874;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">ResponsÃ¡vel</p>
        </td>
        <td style="padding:10px 14px;">
          <p style="margin:0;color:#edf0f5;font-size:13px;font-weight:700;">${String(nome)}</p>
        </td>
      </tr>` : ""}
    </table>
    <p style="color:#8b95a2;font-size:12px;margin:0 0 20px;line-height:1.6;">
      ApÃ³s submeter os documentos, a equipa irÃ¡ validÃ¡-los.<br>
      Quando aprovado, receberÃ¡ um segundo email para ativar o acesso ao portal.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr><td>
        <a href="${activationLink}"
          style="display:inline-block;
                 background:linear-gradient(180deg,#e0e4ea,#bec6d1);
                 color:#07080a;text-decoration:none;padding:14px 34px;border-radius:13px;
                 font-weight:900;font-size:14px;letter-spacing:.06em;
                 box-shadow:0 4px 16px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.6);">
          COMPLETAR REGISTO
        </a>
      </td></tr>
    </table>
    <p style="color:#434a55;font-size:11px;margin:0 0 5px;">Ou copie este link:</p>
    <p style="word-break:break-all;color:#6b7585;font-size:11px;margin:0 0 18px;">${activationLink}</p>
    <p style="color:#434a55;font-size:11px;border-top:1px solid rgba(196,201,212,.08);padding-top:14px;margin:0;">
      Este convite expira em 48 horas. Se nÃ£o solicitou este registo, ignore este email.
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  await transporter.sendMail({ from, to, subject, html });
}

/* =========================================================
   Uploads
   ========================================================= */

const uploadsRoot = path.join(process.cwd(), "public", "uploads");
if (!fs.existsSync(uploadsRoot)) fs.mkdirSync(uploadsRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsRoot),
  filename: (_req, file, cb) => {
    const safe = String(file.originalname || "file").replace(/[^\w.\-]+/g, "_");
    const stamp = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${stamp}-${safe}`);
  },
});

const upload = multer({ storage });

/* =========================================================
   /admin/me
   ========================================================= */

router.get("/me", (req, res) => {
  if (!req.admin) return res.status(401).json({ ok: false });
  return res.json({ ok: true, admin: req.admin });
});

/* =========================================================
   HTML gestÃ£o
   ========================================================= */

router.get("/gestao", requireAdmin, (req, res) => {
  const tipo = String(req.admin?.tipo || "").toLowerCase();
  if (tipo !== "adminmaster") return res.status(403).send("Sem permissÃ£o.");
  return res.sendFile(path.join(process.cwd(), "public", "gestao-adminmaster.html"));
});

/* =========================================================
   LOGIN / LOGOUT
   ========================================================= */

router.post("/login", (req, res) => {
  const { usuario, senha } = req.body || {};
  const u = process.env.ADMIN_USER_MASTER;
  const p = process.env.ADMIN_PASS_MASTER;

  if (!usuario || !senha) {
    return res.status(400).json({ success: false, message: "Preencha usuÃ¡rio e senha" });
  }
  if (!u || !p) {
    return res.status(500).json({
      success: false,
      message: "ADMIN_USER_MASTER / ADMIN_PASS_MASTER nÃ£o definidos no .env",
    });
  }

  const SECRET = getAdminSecret();
  if (!SECRET) {
    return res.status(500).json({
      success: false,
      message: "ADMIN_JWT_SECRET (ou JWT_SECRET) nÃ£o definido no .env",
    });
  }

  if (usuario !== u || senha !== p) {
    return res.status(401).json({ success: false, message: "Credenciais invÃ¡lidas" });
  }

  const token = jwt.sign(
    {
      tipo: "adminmaster",
      typ: "admin_master",
      isAdminMaster: true,
      user: usuario,
      nome: "AdminMaster",
    },
    SECRET,
    { expiresIn: "2h" }
  );

  const isHttps =
    req.secure === true ||
    String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";

  res.cookie("admin_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    maxAge: 2 * 60 * 60 * 1000,
  });

  return res.json({ success: true, token });
});

router.post("/logout", (req, res) => {
  res.clearCookie("admin_token", { path: "/" });
  return res.json({ success: true });
});

/* =========================================================
   MOTORISTAS
   ========================================================= */

// router.get("/motoristas", requireAdmin, async (_req, res) => {
//   try {
//     const motoristas = await Motorista.find({}).sort({ createdAt: -1 }).lean();
//     return res.json({ ok: true, motoristas });
//   } catch (e) {
//     console.error("âŒ GET /admin/motoristas:", e);
//     return res.status(500).json({ ok: false, message: "Erro ao listar motoristas" });
//   }
// });

router.post(
  "/motoristas",
  requireAdmin,
  upload.fields([
    { name: "fotoRosto", maxCount: 1 },
    { name: "cartaConducao", maxCount: 1 },
    { name: "cc", maxCount: 1 },
    { name: "tResidencia", maxCount: 1 },
    { name: "tvde", maxCount: 1 },
    { name: "registoCriminal", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const b = req.body || {};
      const files = req.files || {};

      const nome = asTrimmed(b.nome);
      const contacto = asTrimmed(b.contacto);
      const email = normalizeEmail(b.email);

      if (!nome) {
        return res.status(400).json({ ok: false, message: "O campo Nome Ã© obrigatÃ³rio." });
      }
      if (!contacto) {
        return res.status(400).json({ ok: false, message: "O campo Contacto Ã© obrigatÃ³rio." });
      }
      if (!email) {
        return res.status(400).json({ ok: false, message: "O campo E-mail Ã© obrigatÃ³rio." });
      }
      if (!isEmailValid(email)) {
        return res.status(400).json({ ok: false, message: "O email indicado Ã© invÃ¡lido." });
      }

      const existingEmail = await Motorista.findOne({ email }).lean();
      if (existingEmail) {
        return res.status(409).json({ ok: false, message: "Email jÃ¡ registado." });
      }

      const categorias = Array.isArray(safeJsonParse(b.categorias, []))
        ? safeJsonParse(b.categorias, [])
        : [];
      const idiomas = Array.isArray(safeJsonParse(b.idiomas, []))
        ? safeJsonParse(b.idiomas, [])
        : [];

      const categoriaPrincipal = asTrimmed(b.categoria || categorias?.[0] || "");

      if (!categoriaPrincipal) {
        return res.status(400).json({ ok: false, message: "Selecione pelo menos uma categoria." });
      }

      if (!files.fotoRosto?.[0]) {
        return res.status(400).json({ ok: false, message: "A Foto do Rosto Ã© obrigatÃ³ria." });
      }

      const hasCC = !!files.cc?.[0];
      const hasTR = !!files.tResidencia?.[0];

      if (!hasCC && !hasTR) {
        return res.status(400).json({ ok: false, message: "O documento de identificaÃ§Ã£o Ã© obrigatÃ³rio." });
      }

      if (hasCC) {
        if (!asTrimmed(b.ccNome)) {
          return res.status(400).json({ ok: false, message: "O nome do CartÃ£o do CidadÃ£o Ã© obrigatÃ³rio." });
        }
        if (!asTrimmed(b.ccNumero)) {
          return res.status(400).json({ ok: false, message: "O nÃºmero do CartÃ£o do CidadÃ£o Ã© obrigatÃ³rio." });
        }
        if (!asTrimmed(b.ccValidade)) {
          return res.status(400).json({ ok: false, message: "A validade do CartÃ£o do CidadÃ£o Ã© obrigatÃ³ria." });
        }
      }

      if (hasTR) {
        if (!asTrimmed(b.tResidenciaNome)) {
          return res.status(400).json({ ok: false, message: "O nome do TÃ­tulo de ResidÃªncia Ã© obrigatÃ³rio." });
        }
        if (!asTrimmed(b.tResidenciaNumero)) {
          return res.status(400).json({ ok: false, message: "O nÃºmero do TÃ­tulo de ResidÃªncia Ã© obrigatÃ³rio." });
        }
        if (!asTrimmed(b.tResidenciaValidade)) {
          return res.status(400).json({ ok: false, message: "A validade do TÃ­tulo de ResidÃªncia Ã© obrigatÃ³ria." });
        }
      }

      if (!files.cartaConducao?.[0]) {
        return res.status(400).json({ ok: false, message: "A Carta de ConduÃ§Ã£o Ã© obrigatÃ³ria." });
      }
      if (!asTrimmed(b.cartaConducaoNome)) {
        return res.status(400).json({ ok: false, message: "O nome da Carta de ConduÃ§Ã£o Ã© obrigatÃ³rio." });
      }
      if (!asTrimmed(b.cartaConducaoNumero)) {
        return res.status(400).json({ ok: false, message: "O nÃºmero da Carta de ConduÃ§Ã£o Ã© obrigatÃ³rio." });
      }
      if (!asTrimmed(b.cartaConducaoValidade)) {
        return res.status(400).json({ ok: false, message: "A validade da Carta de ConduÃ§Ã£o Ã© obrigatÃ³ria." });
      }

      if (!files.registoCriminal?.[0]) {
        return res.status(400).json({ ok: false, message: "O Registo Criminal Ã© obrigatÃ³rio." });
      }
      if (!asTrimmed(b.registoCriminalNome)) {
        return res.status(400).json({ ok: false, message: "O nome do Registo Criminal Ã© obrigatÃ³rio." });
      }
      if (!asTrimmed(b.registoCriminalNumero)) {
        return res.status(400).json({ ok: false, message: "O nÃºmero do Registo Criminal Ã© obrigatÃ³rio." });
      }
      if (!asTrimmed(b.registoCriminalValidade)) {
        return res.status(400).json({ ok: false, message: "A validade do Registo Criminal Ã© obrigatÃ³ria." });
      }

      const doc = {
        nome,
        contacto,
        email,
        categoria: categoriaPrincipal,
        categorias,
        status: asTrimmed(b.status || "DisponÃ­vel"),
        idiomas,
        documentos: {
          fotoRosto: buildFaceDoc(files.fotoRosto?.[0] || null),
          cc: buildDocPayload({
            file: files.cc?.[0] || null,
            nome: b.ccNome,
            numeroDocumento: b.ccNumero,
            validade: b.ccValidade,
            tipo: "CartÃ£o do CidadÃ£o",
          }),
          tResidencia: buildDocPayload({
            file: files.tResidencia?.[0] || null,
            nome: b.tResidenciaNome,
            numeroDocumento: b.tResidenciaNumero,
            validade: b.tResidenciaValidade,
            tipo: "TÃ­tulo de ResidÃªncia",
          }),
          cartaConducao: buildDocPayload({
            file: files.cartaConducao?.[0] || null,
            nome: b.cartaConducaoNome,
            numeroDocumento: b.cartaConducaoNumero,
            validade: b.cartaConducaoValidade,
            tipo: "Carta de ConduÃ§Ã£o",
          }),
          tvde: buildDocPayload({
            file: files.tvde?.[0] || null,
            nome: b.tvdeNome,
            numeroDocumento: b.tvdeNumero,
            validade: b.tvdeValidade,
            tipo: "TVDE / IMTT",
          }),
          registoCriminal: buildDocPayload({
            file: files.registoCriminal?.[0] || null,
            nome: b.registoCriminalNome,
            numeroDocumento: b.registoCriminalNumero,
            validade: b.registoCriminalValidade,
            tipo: "Registo Criminal",
          }),
        },
        aprovacao: "pendente",
        validacao: { status: "pendente", observacoes: "" },
      };

      const created = await Motorista.create(doc);

      try {
        await AuditLog.create({
          action: "REGISTO_MOTORISTA",
          actorAdminId: req.admin?._id || "",
          actorAdminName: req.admin?.nome || "AdminMaster",
          targetType: "Motorista",
          targetId: String(created._id),
          details: { nome, email, contacto },
        });
      } catch {}

      return res.json({ ok: true, motorista: created });
    } catch (e) {
      console.error("âŒ POST /admin/motoristas:", e);
      return res.status(500).json({ ok: false, message: "Erro ao guardar motorista" });
    }
  }
);

/* =========================================================
   VEÃCULOS
   ========================================================= */

router.get("/veiculos", requireAdmin, async (_req, res) => {
  try {
    const veiculosRaw = await Veiculo.find({}).sort({ createdAt: -1 }).lean();
    const veiculos = veiculosRaw.map((v) => ensureVehicleReadShape(v));
    return res.json({ ok: true, veiculos });
  } catch (e) {
    console.error("âŒ GET /admin/veiculos:", e);
    return res.status(500).json({ ok: false, message: "Erro ao listar veÃ­culos" });
  }
});

router.post(
  "/veiculos",
  requireAdmin,
  upload.fields([
    { name: "dua", maxCount: 1 },
    { name: "seguro", maxCount: 1 },
    { name: "inspecao", maxCount: 1 },
    { name: "fotos", maxCount: 12 },
  ]),
  async (req, res) => {
    try {
      const b = req.body || {};
      const files = req.files || {};

      const marca = asTrimmed(b.marca);
      const modelo = asTrimmed(b.modelo);
      const matricula = asUpper(b.matricula);

      if (!marca) {
        return res.status(400).json({ ok: false, message: "A marca Ã© obrigatÃ³ria." });
      }
      if (!modelo) {
        return res.status(400).json({ ok: false, message: "O modelo Ã© obrigatÃ³rio." });
      }
      if (!matricula) {
        return res.status(400).json({ ok: false, message: "A matrÃ­cula Ã© obrigatÃ³ria." });
      }

      const exists = await Veiculo.findOne({ matricula }).lean();
      if (exists) {
        return res.status(409).json({ ok: false, message: "JÃ¡ existe um veÃ­culo com esta matrÃ­cula." });
      }

      const fotosFiles = Array.isArray(files.fotos) ? files.fotos : [];

      const doc = {
        marca,
        modelo,
        matricula,
        documentos: {
          dua: buildDocPayload({
            file: files.dua?.[0] || null,
            nome: b.duaNome,
            numeroDocumento: b.duaNumero,
            validade: b.duaValidade,
            tipo: "DUA",
          }),
          seguro: buildDocPayload({
            file: files.seguro?.[0] || null,
            nome: b.seguroNome,
            numeroDocumento: b.seguroNumero,
            validade: b.seguroValidade,
            tipo: "Seguro / Carta Verde",
          }),
          inspecao: buildDocPayload({
            file: files.inspecao?.[0] || null,
            nome: b.inspecaoNome,
            numeroDocumento: b.inspecaoNumero,
            validade: b.inspecaoValidade,
            tipo: "InspeÃ§Ã£o",
          }),
        },
        fotos: fotosFiles.map((f) => ({
          file: fileMeta(f),
          meta: {
            nome: "",
            numeroDocumento: "",
            validade: "",
            tipo: "Foto do veÃ­culo",
          },
        })),
        estado: "pendente",
        aprovacao: "pendente",
        validacao: { status: "pendente", observacoes: "" },
      };

      const created = await Veiculo.create(doc);

      try {
        await AuditLog.create({
          action: "REGISTO_VEICULO",
          actorAdminId: req.admin?._id || "",
          actorAdminName: req.admin?.nome || "AdminMaster",
          targetType: "Veiculo",
          targetId: String(created._id),
          details: { matricula, marca, modelo },
        });
      } catch {}

      return res.json({ ok: true, veiculo: ensureVehicleReadShape(created) });
    } catch (e) {
      console.error("âŒ POST /admin/veiculos:", e);
      return res.status(500).json({ ok: false, message: "Erro ao guardar veÃ­culo" });
    }
  }
);

/* =========================================================
   VALIDAÃ‡Ã•ES â€” MOTORISTAS
   ========================================================= */

router.get("/validacoes/motoristas", requireAdmin, async (req, res) => {
  try {
    const status = String(req.query.status || "pendente").toLowerCase();
    const filter = {};
    if (status !== "all") filter.aprovacao = status;

    const motoristas = await Motorista.find(filter).sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, motoristas });
  } catch (e) {
    console.error("âŒ GET /admin/validacoes/motoristas:", e);
    return res.status(500).json({ ok: false, message: "Erro ao listar validaÃ§Ãµes de motoristas" });
  }
});

router.get("/validacoes/motoristas/:id", requireAdmin, async (req, res) => {
  try {
    const motorista = await Motorista.findById(req.params.id).lean();
    if (!motorista) return res.status(404).json({ ok: false, message: "Motorista nÃ£o encontrado" });
    return res.json({ ok: true, motorista });
  } catch (e) {
    console.error("âŒ GET /admin/validacoes/motoristas/:id:", e);
    return res.status(500).json({ ok: false, message: "Erro ao carregar motorista" });
  }
});

router.post("/validacoes/motoristas/:id", requireAdmin, async (req, res) => {
  try {
    const { status, observacoes, checklist } = req.body || {};
    const st = String(status || "").toLowerCase();
    if (!["aprovado", "rejeitado", "pendente"].includes(st)) {
      return res.status(400).json({ ok: false, message: "status invÃ¡lido" });
    }

    const update = {
      aprovacao: st,
      "validacao.status": st,
      "validacao.observacoes": String(observacoes || ""),
      "validacao.checklist": checklist && typeof checklist === "object" ? checklist : {},
      "validacao.validadoEm": new Date(),
      "validacao.validadoPorId": req.admin?._id || null,
      "validacao.validadoPorNome": req.admin?.nome || "AdminMaster",
    };

    const motorista = await Motorista.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!motorista) return res.status(404).json({ ok: false, message: "Motorista nÃ£o encontrado" });

    try {
      await AuditLog.create({
        action: "VALIDACAO_MOTORISTA",
        actorAdminId: String(req.admin?._id || ""),
        actorAdminName: req.admin?.nome || "AdminMaster",
        targetType: "Motorista",
        targetId: String(motorista._id),
        details: { status: st, observacoes: String(observacoes || "") },
      });
    } catch {}

    // Email de notificacao ao motorista
    try {
      const transporter = createSmtpTransport();
      const from = String(process.env.SMTP_FROM || process.env.SMTP_USER || "").trim();
      if (transporter && from && motorista.email) {
        const base = getPublicBaseUrl(req);
        if (st === "aprovado") {
          // Gerar token de primeiro acesso
          const secret = String(process.env.JWT_SECRET || "").trim();
          const accessToken = jwt.sign(
            { typ: "motorista_setup", id: String(motorista._id), email: motorista.email },
            secret,
            { expiresIn: "72h" }
          );
          const activationLink = `${base}/motorista-primeiro-acesso.html?token=${encodeURIComponent(accessToken)}`;
          const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0d0f12;color:#d9dde3;border-radius:12px;overflow:hidden">
            <div style="background:#111;padding:24px;text-align:center;border-bottom:1px solid #2c323a">
              <h1 style="color:#e2e7ee;font-size:20px;margin:0">REALMETROPOLIS</h1>
            </div>
            <div style="padding:28px">
              <p style="font-size:15px">Parabens <b>${motorista.nome}</b>!</p>
              <p style="margin-top:12px;color:#b8c0ca">O seu registo como <b>Motorista</b> foi <b style="color:#1cd68e">APROVADO</b>.</p>
              <p style="margin-top:12px;color:#b8c0ca">Clique no botao abaixo para definir a sua senha e activar a sua conta:</p>
              <div style="text-align:center;margin:28px 0">
                <a href="${activationLink}" style="background:linear-gradient(135deg,#e2e6ee,#b8c0cc);color:#08090c;font-weight:900;text-decoration:none;padding:14px 28px;border-radius:50px;font-size:14px">ACTIVAR CONTA</a>
              </div>
              <p style="color:#434a55;font-size:11px">Este link e valido por 72 horas.</p>
            </div>
          </div>`;
          await transporter.sendMail({ from, to: motorista.email, subject: "REALMETROPOLIS - Conta Aprovada", html });
          console.log("Email aprovacao motorista ->", motorista.email);
        } else if (st === "rejeitado") {
          const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0d0f12;color:#d9dde3;border-radius:12px;overflow:hidden">
            <div style="background:#111;padding:24px;text-align:center">
              <h1 style="color:#e2e7ee;font-size:20px;margin:0">REALMETROPOLIS</h1>
            </div>
            <div style="padding:28px">
              <p>Ola <b>${motorista.nome}</b>,</p>
              <p style="margin-top:12px;color:#b8c0ca">O seu registo foi <b style="color:#ff6b6b">NAO APROVADO</b>.</p>
              ${observacoes ? `<p style="margin-top:12px;color:#8b95a2;font-size:13px">Motivo: ${observacoes}</p>` : ""}
            </div>
          </div>`;
          await transporter.sendMail({ from, to: motorista.email, subject: "REALMETROPOLIS - Registo Nao Aprovado", html });
        }
      }
    } catch (emailErr) {
      console.warn("Falha email motorista:", emailErr.message);
    }

    return res.json({ ok: true, motorista });
  } catch (e) {
    console.error("âŒ POST /admin/validacoes/motoristas/:id:", e);
    return res.status(500).json({ ok: false, message: "Erro ao validar motorista" });
  }
});

/* =========================================================
   VALIDAÃ‡Ã•ES â€” VEÃCULOS
   ========================================================= */

router.get("/validacoes/veiculos", requireAdmin, async (req, res) => {
  try {
    const status = String(req.query.status || "pendente").toLowerCase();
    const filter = {};
    if (status !== "all") {
      filter.$or = [{ "validacao.status": status }, { aprovacao: status }, { estado: status }];
    }
    const veiculosRaw = await Veiculo.find(filter).sort({ createdAt: -1 }).lean();
    const veiculos = veiculosRaw.map((v) => ensureVehicleReadShape(v));
    return res.json({ ok: true, veiculos });
  } catch (e) {
    console.error("âŒ GET /admin/validacoes/veiculos:", e);
    return res.status(500).json({ ok: false, message: "Erro ao listar validaÃ§Ãµes de veÃ­culos" });
  }
});

router.get("/validacoes/veiculos/:id", requireAdmin, async (req, res) => {
  try {
    const veiculoRaw = await Veiculo.findById(req.params.id).lean();
    if (!veiculoRaw) return res.status(404).json({ ok: false, message: "VeÃ­culo nÃ£o encontrado" });
    return res.json({ ok: true, veiculo: ensureVehicleReadShape(veiculoRaw) });
  } catch (e) {
    console.error("âŒ GET /admin/validacoes/veiculos/:id:", e);
    return res.status(500).json({ ok: false, message: "Erro ao carregar veÃ­culo" });
  }
});

router.post("/validacoes/veiculos/:id", requireAdmin, async (req, res) => {
  try {
    const { status, observacoes, checklist } = req.body || {};
    const st = String(status || "").toLowerCase();
    if (!["aprovado", "rejeitado", "pendente"].includes(st)) {
      return res.status(400).json({ ok: false, message: "status invÃ¡lido" });
    }

    const update = {
      "validacao.status": st,
      "validacao.observacoes": String(observacoes || ""),
      "validacao.checklist": checklist && typeof checklist === "object" ? checklist : {},
      "validacao.validadoEm": new Date(),
      "validacao.validadoPorId": req.admin?._id || null,
      "validacao.validadoPorNome": req.admin?.nome || "AdminMaster",
      aprovacao: st,
      estado: st,
    };

    const veiculo = await Veiculo.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!veiculo) return res.status(404).json({ ok: false, message: "VeÃ­culo nÃ£o encontrado" });

    try {
      await AuditLog.create({
        action: "VALIDACAO_VEICULO",
        actorAdminId: String(req.admin?._id || ""),
        actorAdminName: req.admin?.nome || "AdminMaster",
        targetType: "Veiculo",
        targetId: String(veiculo._id),
        details: { status: st, observacoes: String(observacoes || "") },
      });
    } catch {}

    return res.json({ ok: true, veiculo: ensureVehicleReadShape(veiculo) });
  } catch (e) {
    console.error("âŒ POST /admin/validacoes/veiculos/:id:", e);
    return res.status(500).json({ ok: false, message: "Erro ao validar veÃ­culo" });
  }
});

/* =========================================================
   VALIDAÃ‡ÃƒO DOCUMENTO GENÃ‰RICA
   ========================================================= */

router.post("/validacoes/documento", requireAdmin, async (req, res) => {
  try {
    const payload = req.body || {};
    return res.json({ ok: true, payload });
  } catch (e) {
    console.error("âŒ POST /admin/validacoes/documento:", e);
    return res.status(500).json({ ok: false, message: "Erro ao registar validaÃ§Ã£o do documento" });
  }
});

router.post("/validacoes/notificar", requireAdmin, async (req, res) => {
  try {
    return res.json({ ok: true });
  } catch (e) {
    console.error("âŒ POST /admin/validacoes/notificar:", e);
    return res.status(500).json({ ok: false, message: "Erro ao notificar validaÃ§Ã£o" });
  }
});

router.post("/validacoes/lock", requireAdmin, async (_req, res) => {
  try {
    return res.json({ ok: true });
  } catch (e) {
    console.error("âŒ POST /admin/validacoes/lock:", e);
    return res.status(500).json({ ok: false, message: "Erro ao bloquear documento" });
  }
});

router.post("/validacoes/unlock", requireAdmin, async (_req, res) => {
  try {
    return res.json({ ok: true });
  } catch (e) {
    console.error("âŒ POST /admin/validacoes/unlock:", e);
    return res.status(500).json({ ok: false, message: "Erro ao desbloquear documento" });
  }
});

/* =========================================================
   VIAGENS
   ========================================================= */

router.get("/viagens", requireAdmin, async (_req, res) => {
  try {
    const viagens = await Trip.find({}).sort({ createdAt: -1 }).limit(500).lean();
    return res.json({ ok: true, viagens });
  } catch (e) {
    console.error("âŒ GET /admin/viagens:", e);
    return res.status(500).json({ ok: false, message: "Erro ao listar viagens" });
  }
});

router.post("/viagens/:id/pagar", requireAdmin, async (req, res) => {
  try {
    const t = await Trip.findByIdAndUpdate(
      req.params.id,
      { statusPagamento: "pago" },
      { new: true }
    );
    if (!t) return res.status(404).json({ ok: false, message: "Viagem nÃ£o encontrada" });
    return res.json({ ok: true, viagem: t });
  } catch (e) {
    console.error("âŒ POST /admin/viagens/:id/pagar:", e);
    return res.status(500).json({ ok: false, message: "Erro ao marcar como pago" });
  }
});

router.post("/viagens/:id/atribuir", requireAdmin, async (req, res) => {
  try {
    const tripId = req.params.id;
    const motoristaId =
      req.body?.motoristaId ||
      req.body?.motorista ||
      req.body?.motorista_id ||
      "";

    if (!tripId || !motoristaId) {
      return res.status(400).json({ ok: false, message: "Viagem e motorista sÃ£o obrigatÃ³rios." });
    }

    const motorista = await Motorista.findById(motoristaId).lean();
    if (!motorista) {
      return res.status(404).json({ ok: false, message: "Motorista nÃ£o encontrado." });
    }

    const trip = await Trip.findByIdAndUpdate(
      tripId,
      {
        motorista: motorista._id,
        status: "ATRIBUIDA",
      },
      { new: true }
    );

    if (!trip) {
      return res.status(404).json({ ok: false, message: "Viagem nÃ£o encontrada." });
    }

    try {
      await AuditLog.create({
        action: "ATRIBUIR_VIAGEM",
        actorAdminId: String(req.admin?._id || ""),
        actorAdminName: req.admin?.nome || "AdminMaster",
        targetType: "Trip",
        targetId: String(trip._id),
        details: {
          motoristaId: String(motorista._id),
          motoristaNome: motorista.nome || "",
        },
      });
    } catch {}

    return res.json({ ok: true, viagem: trip });
  } catch (e) {
    console.error("âŒ POST /admin/viagens/:id/atribuir:", e);
    return res.status(500).json({ ok: false, message: "Erro ao atribuir viagem" });
  }
});

router.post("/viagens/atribuir", requireAdmin, async (req, res) => {
  try {
    const tripId = req.body?.viagemId || req.body?.tripId || "";
    const motoristaId =
      req.body?.motoristaId ||
      req.body?.motorista ||
      req.body?.motorista_id ||
      "";

    if (!tripId || !motoristaId) {
      return res.status(400).json({ ok: false, message: "Viagem e motorista sÃ£o obrigatÃ³rios." });
    }

    const motorista = await Motorista.findById(motoristaId).lean();
    if (!motorista) {
      return res.status(404).json({ ok: false, message: "Motorista nÃ£o encontrado." });
    }

    const trip = await Trip.findByIdAndUpdate(
      tripId,
      {
        motorista: motorista._id,
        status: "ATRIBUIDA",
      },
      { new: true }
    );

    if (!trip) {
      return res.status(404).json({ ok: false, message: "Viagem nÃ£o encontrada." });
    }

    try {
      await AuditLog.create({
        action: "ATRIBUIR_VIAGEM",
        actorAdminId: String(req.admin?._id || ""),
        actorAdminName: req.admin?.nome || "AdminMaster",
        targetType: "Trip",
        targetId: String(trip._id),
        details: {
          motoristaId: String(motorista._id),
          motoristaNome: motorista.nome || "",
        },
      });
    } catch {}

    return res.json({ ok: true, viagem: trip });
  } catch (e) {
    console.error("âŒ POST /admin/viagens/atribuir:", e);
    return res.status(500).json({ ok: false, message: "Erro ao atribuir viagem" });
  }
});

/* =========================================================
   AUDIT
   ========================================================= */

router.get("/audit", requireAdmin, async (_req, res) => {
  try {
    const logs = await AuditLog.find({}).sort({ createdAt: -1 }).limit(50).lean();
    return res.json({ ok: true, logs });
  } catch (e) {
    console.error("âŒ GET /admin/audit:", e);
    return res.status(500).json({ ok: false, message: "Erro ao listar audit" });
  }
});

/* =========================================================
   COLABORADORES
   ========================================================= */

router.get("/validacoes/colaboradores", requireAdmin, async (req, res) => {
  try {
    const status = String(req.query.status || "pendente").toLowerCase();

    const filter = {};
    if (status === "pendente") filter.aprovado = false;
    else if (status === "aprovado") filter.aprovado = true;
    else if (status === "all") {
      // sem filtro
    } else {
      return res.status(400).json({ ok: false, message: "status invÃ¡lido" });
    }

    const colaboradores = await Colaborador.find(filter)
      .sort({ createdAt: -1 })
      .select("empresa nome email contacto tipo concelho cidade aprovado validacao documentos nif createdAt updatedAt")
      .lean();

    return res.json({ ok: true, colaboradores });
  } catch (e) {
    console.error("âŒ GET /admin/validacoes/colaboradores:", e);
    return res.status(500).json({ ok: false, message: "Erro ao listar colaboradores" });
  }
});

router.get("/validacoes/colaboradores/:id", requireAdmin, async (req, res) => {
  try {
    const colaborador = await Colaborador.findById(req.params.id).lean();
    if (!colaborador)
      return res.status(404).json({ ok: false, message: "Colaborador nÃ£o encontrado" });
    return res.json({ ok: true, colaborador });
  } catch (e) {
    console.error("âŒ GET /admin/validacoes/colaboradores/:id:", e);
    return res.status(500).json({ ok: false, message: "Erro ao carregar colaborador" });
  }
});

router.post("/colaboradores/invite", requireAdmin, async (req, res) => {
  try {
    const empresa = String(req.body?.empresa || req.body?.nomeEmpresa || "").trim();
    const nome = String(req.body?.nome || req.body?.nomeColaborador || "").trim();
    const email = normalizeEmail(req.body?.email || req.body?.mail);
    const contacto = String(req.body?.contacto || req.body?.telefone || "").trim();
    const tipo = normalizeTipo(req.body?.tipo || req.body?.tipoEmpresa);

    const concelho = String(req.body?.concelho || "").trim();
    const cidade = String(req.body?.cidade || "").trim();

    if (!empresa || !email || !contacto || !tipo) {
      return res.status(400).json({
        ok: false,
        message: "Campos obrigatÃ³rios: empresa, email, contacto, tipo.",
      });
    }
    if (!isEmailValid(email)) {
      return res.status(400).json({ ok: false, message: "Email invÃ¡lido." });
    }
    if (tipo === "frota" && (!concelho || !cidade)) {
      return res.status(400).json({
        ok: false,
        message: "Para tipo 'frota', concelho e cidade sÃ£o obrigatÃ³rios.",
      });
    }

    const secret = getJwtSecretForColab();
    if (!secret) {
      return res
        .status(500)
        .json({ ok: false, message: "JWT_SECRET (ou COLAB_JWT_SECRET) nÃ£o definido no .env" });
    }

    let doc = await Colaborador.findOne({ email });

    if (doc?.aprovado === true) {
      return res.status(409).json({
        ok: false,
        message: "Este colaborador jÃ¡ estÃ¡ aprovado. Use recuperaÃ§Ã£o de senha (ou suporte).",
      });
    }

    if (!doc) {
      doc = await Colaborador.create({
        empresa,
        nome,
        email,
        contacto,
        tipo,
        concelho: tipo === "frota" ? concelho : "",
        cidade: tipo === "frota" ? cidade : "",
        aprovado: false,
        passwordHash: "",
        validacao: { status: "pendente", observacoes: "" },
      });
    } else {
      doc.empresa = empresa;
      doc.nome = nome || doc.nome;
      doc.contacto = contacto;
      doc.tipo = tipo;
      doc.concelho = tipo === "frota" ? concelho : "";
      doc.cidade = tipo === "frota" ? cidade : "";
      doc.aprovado = false;
      doc.validacao = doc.validacao || {};
      doc.validacao.status = "pendente";
      await doc.save();
    }

    const setupToken = jwt.sign(
      {
        typ:      "colaborador_setup",
        id:       String(doc._id),
        email:    doc.email,
        empresa:  doc.empresa  || "",
        nome:     doc.nome     || "",
        contacto: doc.contacto || "",
        concelho: doc.concelho || "",
        cidade:   doc.cidade   || "",
        tipo:     doc.tipo     || "",
      },
      secret,
      { expiresIn: "48h" }
    );

    const base = getPublicBaseUrl(req);
    // Enviar para o formulÃ¡rio de registo (nÃ£o para definir senha directamente)
    const paginaRegisto = tipo === "frota"
      ? "convite-registo-gestor.html"
      : "convite-registo-colaborador.html";
    const activationLink = `${base}/${paginaRegisto}?token=${encodeURIComponent(setupToken)}`;

    let emailSent = false;
    let emailError = null;

    try {
      await sendColabInviteEmail({
        to: doc.email,
        activationLink,
        empresa: doc.empresa,
        contacto: doc.contacto,
        tipo: doc.tipo,
        nome: doc.nome,
      });
      emailSent = true;
    } catch (err) {
      emailError = String(err?.message || err);
      console.warn("âš ï¸ Falha ao enviar email de convite colaborador:", emailError);
    }

    try {
      await AuditLog.create({
        action: "INVITE_COLABORADOR",
        actorAdminId: String(req.admin?._id || ""),
        actorAdminName: req.admin?.nome || "AdminMaster",
        targetType: "Colaborador",
        targetId: String(doc._id),
        details: { email: doc.email, empresa: doc.empresa, tipo: doc.tipo, emailSent },
      });
    } catch {}

    return res.json({
      ok: true,
      message: emailSent
        ? "Convite enviado com sucesso."
        : "Colaborador criado/atualizado, mas o email nÃ£o foi enviado (ver SMTP).",
      emailSent,
      emailError,
      activationLink: emailSent ? null : activationLink,
      colaborador: {
        id: String(doc._id),
        empresa: doc.empresa,
        nome: doc.nome,
        email: doc.email,
        contacto: doc.contacto,
        tipo: doc.tipo,
        aprovado: doc.aprovado,
        concelho: doc.concelho,
        cidade: doc.cidade,
      },
    });
  } catch (e) {
    console.error("âŒ POST /admin/colaboradores/invite:", e);
    return res.status(500).json({ ok: false, message: "Erro ao criar/enviar convite do colaborador" });
  }
});

router.post("/validacoes/colaboradores/:id", requireAdmin, async (req, res) => {
  try {
    const { status, observacoes } = req.body || {};
    const st = String(status || "").toLowerCase();

    if (!["aprovado", "rejeitado"].includes(st)) {
      return res.status(400).json({ ok: false, message: "status invÃ¡lido" });
    }

    const aprovado = st === "aprovado";

    const update = {
      aprovado,
      "validacao.status": st,
      "validacao.observacoes": String(observacoes || ""),
      "validacao.validadoEm": new Date(),
      "validacao.validadoPorId": req.admin?._id || null,
      "validacao.validadoPorNome": req.admin?.nome || "AdminMaster",
    };

    const colaborador = await Colaborador.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!colaborador) return res.status(404).json({ ok: false, message: "Colaborador nÃ£o encontrado" });

    try {
      await AuditLog.create({
        action: "VALIDACAO_COLABORADOR",
        actorAdminId: String(req.admin?._id || ""),
        actorAdminName: req.admin?.nome || "AdminMaster",
        targetType: "Colaborador",
        targetId: String(colaborador._id),
        details: { status: st, observacoes: String(observacoes || "") },
      });
    } catch {}

    // Email de notificação de validação
    try {
      const transporter = createSmtpTransport();
      const from = String(process.env.SMTP_FROM || process.env.SMTP_USER || "").trim();
      if (transporter && from && colaborador.email) {
        const isAprovado = st === "aprovado";
        const nomeDisplay = colaborador.nome || colaborador.empresa || "Operador";
        const base = getPublicBaseUrl(req);

if (isAprovado) {

    const secret = String(process.env.JWT_SECRET || "").trim();

    const setupToken = jwt.sign(
        {
            typ: "colaborador_setup",
            id: String(colaborador._id),
            email: colaborador.email
        },
        secret,
        { expiresIn: "72h" }
    );

    const activationLink =
        `${base}/colaborador-definir-senha.html?token=${encodeURIComponent(setupToken)}`;

    const html = `
<!DOCTYPE html>
<html lang="pt">

<body style="margin:0;padding:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
<tr>
<td align="center">

<table width="650" cellpadding="0" cellspacing="0"
style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 10px 35px rgba(0,0,0,.12);">

<tr>
<td style="background:#0b1623;padding:35px;text-align:center;">
<h1 style="margin:0;color:#ffffff;font-size:30px;letter-spacing:3px;">
REALMETROPOLIS
</h1>
</td>
</tr>

<tr>
<td style="padding:45px;">

<h2 style="margin-top:0;color:#0b1623;">
Registo Aprovado
</h2>

<p style="font-size:16px;color:#444;">
Olá <strong>${nomeDisplay}</strong>,
</p>

<p style="font-size:16px;color:#444;line-height:28px;">
É com satisfação que informamos que o seu registo como
<strong>Operador de Frota</strong> foi aprovado pela equipa da
<strong>REALMETROPOLIS</strong>.
</p>

<p style="font-size:16px;color:#444;line-height:28px;">
Para concluir a ativação da sua conta deverá criar a sua senha.
</p>

<div style="text-align:center;margin:45px 0;">

<a href="${activationLink}"
style="
display:inline-block;
background:#16a34a;
color:#ffffff;
text-decoration:none;
padding:18px 42px;
font-size:18px;
font-weight:bold;
border-radius:8px;">
CRIAR SENHA
</a>

</div>

<p style="font-size:14px;color:#666;">
Este link é válido durante <strong>72 horas</strong>.
</p>

<hr style="margin:35px 0;border:none;border-top:1px solid #ddd;">

<p style="font-size:13px;color:#888;">
Caso não tenha solicitado este registo, ignore esta mensagem.
</p>

<p style="font-size:13px;color:#888;">
© ${new Date().getFullYear()} REALMETROPOLIS
</p>

</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>
`;

    await transporter.sendMail({
        from,
        to: colaborador.email,
        subject: "REALMETROPOLIS - Conta Aprovada",
        html
    });

} else {

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#ffffff;padding:40px">
<h2 style="color:#dc2626;">Registo não aprovado</h2>

<p>Olá <strong>${nomeDisplay}</strong>,</p>

<p>
Após análise da documentação, o seu registo não foi aprovado.
</p>

${observacoes ? `<p><strong>Motivo:</strong> ${observacoes}</p>` : ""}

</div>
`;

    await transporter.sendMail({
        from,
        to: colaborador.email,
        subject: "REALMETROPOLIS - Registo Não Aprovado",
        html
    });

}
        console.log("Email validacao colaborador ->", colaborador.email, st);
      }
    } catch (emailErr) {
      console.warn("Falha email colaborador:", emailErr.message);
    }

    return res.json({ ok: true, colaborador });
  } catch (e) {
    console.error("âŒ POST /admin/validacoes/colaboradores/:id:", e);
    return res.status(500).json({ ok: false, message: "Erro ao validar colaborador" });
  }
});

/* =========================================================
   QUOTE CONFIG
   ========================================================= */

const DEFAULT_QUOTE_CONFIG = {
  precoKm: {
    Confort: 1.2,
    Executive: 1.6,
    Luxury: 2.0,
  },
  minimos: {
    aeroporto: 15,
    normal: 10,
  },
  espera: {
    minutosGratis: 10,
    valorPorMinExtra: 0.8,
  },
  portagem: {
    valorFixo: 2.1,
  },
  transito: {
    fatorMax: 1.3,
  },
  horaPonta: {
    fator: 1.1,
    manhaInicio: 7,
    manhaFim: 10,
    tardeInicio: 17,
    tardeFim: 20,
  },
  procura: {
    incrementoPorExcesso: 0.15,
    fatorMax: 1.5,
  },
};

async function ensureQuoteConfig() {
  let cfg = await AdminQuoteConfig.findOne({ key: "default" });
  if (!cfg) {
    cfg = await AdminQuoteConfig.create({
      key: "default",
      ...DEFAULT_QUOTE_CONFIG,
    });
  }
  return cfg;
}

router.get("/quote-config", requireAdmin, async (_req, res) => {
  try {
    const cfg = await ensureQuoteConfig();
    return res.json({ ok: true, config: cfg });
  } catch (e) {
    console.error("âŒ GET /admin/quote-config:", e);
    return res.status(500).json({
      ok: false,
      message: "Erro ao carregar configuraÃ§Ã£o de quote",
    });
  }
});

router.put("/quote-config", requireAdmin, async (req, res) => {
  try {
    const config = req.body?.config || {};

    const payload = {
      precoKm: {
        Confort: Number(config?.precoKm?.Confort ?? DEFAULT_QUOTE_CONFIG.precoKm.Confort),
        Executive: Number(config?.precoKm?.Executive ?? DEFAULT_QUOTE_CONFIG.precoKm.Executive),
        Luxury: Number(config?.precoKm?.Luxury ?? DEFAULT_QUOTE_CONFIG.precoKm.Luxury),
      },
      minimos: {
        aeroporto: Number(config?.minimos?.aeroporto ?? DEFAULT_QUOTE_CONFIG.minimos.aeroporto),
        normal: Number(config?.minimos?.normal ?? DEFAULT_QUOTE_CONFIG.minimos.normal),
      },
      espera: {
        minutosGratis: Number(config?.espera?.minutosGratis ?? DEFAULT_QUOTE_CONFIG.espera.minutosGratis),
        valorPorMinExtra: Number(config?.espera?.valorPorMinExtra ?? DEFAULT_QUOTE_CONFIG.espera.valorPorMinExtra),
      },
      portagem: {
        valorFixo: Number(config?.portagem?.valorFixo ?? DEFAULT_QUOTE_CONFIG.portagem.valorFixo),
      },
      transito: {
        fatorMax: Number(config?.transito?.fatorMax ?? DEFAULT_QUOTE_CONFIG.transito.fatorMax),
      },
      horaPonta: {
        fator: Number(config?.horaPonta?.fator ?? DEFAULT_QUOTE_CONFIG.horaPonta.fator),
        manhaInicio: Number(config?.horaPonta?.manhaInicio ?? DEFAULT_QUOTE_CONFIG.horaPonta.manhaInicio),
        manhaFim: Number(config?.horaPonta?.manhaFim ?? DEFAULT_QUOTE_CONFIG.horaPonta.manhaFim),
        tardeInicio: Number(config?.horaPonta?.tardeInicio ?? DEFAULT_QUOTE_CONFIG.horaPonta.tardeInicio),
        tardeFim: Number(config?.horaPonta?.tardeFim ?? DEFAULT_QUOTE_CONFIG.horaPonta.tardeFim),
      },
      procura: {
        incrementoPorExcesso: Number(
          config?.procura?.incrementoPorExcesso ??
          DEFAULT_QUOTE_CONFIG.procura.incrementoPorExcesso
        ),
        fatorMax: Number(config?.procura?.fatorMax ?? DEFAULT_QUOTE_CONFIG.procura.fatorMax),
      },
      plataformaPercent: typeof config?.plataformaPercent === 'number' ? config.plataformaPercent : (DEFAULT_QUOTE_CONFIG.plataformaPercent ?? 0.15),
      descontoColaboradorPercent: typeof config?.descontoColaboradorPercent === 'number' ? config.descontoColaboradorPercent : (DEFAULT_QUOTE_CONFIG.descontoColaboradorPercent ?? 0),
    };

    const cfg = await AdminQuoteConfig.findOneAndUpdate(
      { key: "default" },
      { $set: payload },
      { new: true, upsert: true }
    );

    try {
      await AuditLog.create({
        action: "UPDATE_QUOTE_CONFIG",
        actorAdminId: String(req.admin?._id || ""),
        actorAdminName: req.admin?.nome || "AdminMaster",
        targetType: "AdminQuoteConfig",
        targetId: String(cfg._id),
        details: payload,
      });
    } catch {}

    return res.json({
      ok: true,
      message: "ConfiguraÃ§Ã£o de quote atualizada com sucesso.",
      config: cfg,
    });
  } catch (e) {
    console.error("âŒ PUT /admin/quote-config:", e);
    return res.status(500).json({
      ok: false,
      message: "Erro ao guardar configuraÃ§Ã£o de quote",
    });
  }
});


/* ================================================================
   POST /admin/motoristas/registo
   PÃºblico (sem auth) â€” registo de motorista via formulÃ¡rio externo.
   Aceita JSON com documentos em base64. Guarda ficheiros em disco
   e cria o documento Motorista com aprovacao: "pendente".
================================================================ */
router.post("/motoristas/registo", async (req, res) => {
  try {
    const b = req.body || {};

    const nome     = String(b.nome     || "").trim();
    const email    = String(b.email    || "").toLowerCase().trim();
    const contacto = String(b.contacto || "").trim();

    if (!nome)     return res.status(400).json({ ok:false, message:"Nome obrigatÃ³rio." });
    if (!email)    return res.status(400).json({ ok:false, message:"Email obrigatÃ³rio." });
    if (!contacto) return res.status(400).json({ ok:false, message:"Contacto obrigatÃ³rio." });

    // Verificar email duplicado
    const existe = await Motorista.findOne({ email }).lean();
    if (existe) return res.status(409).json({ ok:false, message:"Email jÃ¡ registado." });

    // â”€â”€ Guardar ficheiros base64 em disco â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    async function saveBase64Doc(docObj, fieldName) {
      if (!docObj?.conteudo) return null;
      try {
        const matches = docObj.conteudo.match(/^data:([^;]+);base64,(.+)$/);
        if (!matches) return null;
        const mime = matches[1];
        const data = matches[2];
        const ext  = mime.includes("pdf") ? "pdf"
          : mime.includes("png") ? "png"
          : mime.includes("webp") ? "webp" : "jpg";
        const filename = `${fieldName}_${Date.now()}_${Math.random().toString(36).slice(2,6)}.${ext}`;
        const filepath = path.join(uploadsDir, filename);
        fs.writeFileSync(filepath, Buffer.from(data, "base64"));
        return {
          file: {
            filename: filename,
            mimetype: mime,
            size:     Buffer.from(data, "base64").length,
            url:      `/uploads/${filename}`,
            path:     `/uploads/${filename}`,
          },
          validade: null,
          meta: {
            nome:            docObj.nome || filename,
            numeroDocumento: "",
            validade:        "",
            tipo:            fieldName,
          },
          status:  "pendente",
          motivos: [],
        };
      } catch (err) {
        console.warn(`âš ï¸ Falha ao guardar doc ${fieldName}:`, err.message);
        return null;
      }
    }

    const docs = b.documentos || {};

    // Mapear campos do formulÃ¡rio para o modelo
    const documentos = {
      fotoRosto:       await saveBase64Doc(docs.fotoRosto,       "fotoRosto"),
      // BI / CC / doc identificaÃ§Ã£o
      cc:              await saveBase64Doc(docs.docIdFrente || docs.cc || docs.bi, "cc"),
      docIdVerso:      await saveBase64Doc(docs.docIdVerso,       "docIdVerso"),
      // TÃ­tulo de residÃªncia / doc obrigatÃ³rio
      tResidencia:     await saveBase64Doc(docs.docObgIdFrente || docs.tResidencia, "tResidencia"),
      tResidenciaVerso:await saveBase64Doc(docs.docObgIdVerso,   "tResidenciaVerso"),
      // Carta de conduÃ§Ã£o
      cartaConducao:   await saveBase64Doc(docs.cartaFrente || docs.cartaConducao, "cartaConducao"),
      cartaVerso:      await saveBase64Doc(docs.cartaVerso,       "cartaVerso"),
      // TVDE / IMTT
      tvde:            await saveBase64Doc(docs.imttTvde || docs.tvde, "tvde"),
      // IBAN
      iban:            await saveBase64Doc(docs.ibanComprovativo || docs.iban, "iban"),
      // Registo Criminal
      registoCriminal: await saveBase64Doc(docs.registoCriminal, "registoCriminal"),
    };

    // Validades vindas do formulÃ¡rio
    const validades = b.validades || {};

    const doc = {
      nome, email, contacto,
      nif:       String(b.nif     || "").trim(),
      iban:      String(b.iban    || "").trim(),
      endereco:  String(b.endereco|| "").trim(),
      categoria: String(b.documentoTipo || b.categoria || "").trim(),
      documentoTipo: String(b.documentoTipo || "").trim(),
      aprovacao: "pendente",
      validacao: { status: "pendente", observacoes: "" },
      documentos,
      validades: {
        docIdValidade:           validades.docIdValidade           || "",
        docObgIdValidade:        validades.docObgIdValidade        || "",
        cartaValidade:           validades.cartaValidade           || "",
        imttTvdeValidade:        validades.imttTvdeValidade        || "",
        registoCriminalValidade: validades.registoCriminalValidade || "",
      },
    };

    const created = await Motorista.create(doc);
    console.log(`âœ… Motorista registado: ${nome} (${email}) â†’ ID ${created._id}`);

    return res.status(201).json({
      ok:       true,
      success:  true,
      message:  "Motorista enviado para validaÃ§Ã£o com sucesso.",
      motorista: { _id: created._id, id: String(created._id), nome, email },
    });

  } catch (err) {
    console.error("âŒ POST /admin/motoristas/registo:", err);
    return res.status(500).json({ ok:false, message: err.message || "Erro interno." });
  }
});

/* =========================================================
   GET /admin/kms
   Devolve configuraÃ§Ã£o de preÃ§o por km para cada categoria.
   O painel admin-gestao.html usa esta rota para carregar e editar os valores.
   ========================================================= */
router.get("/kms", requireAdmin, async (_req, res) => {
  try {
    const configs = await KmConfig.find().sort({ key: 1 }).lean();
    return res.json({ ok: true, kms: configs });
  } catch (err) {
    console.error("âŒ GET /admin/kms:", err);
    return res.status(500).json({ ok: false, message: "Erro ao obter configuraÃ§Ã£o KMS." });
  }
});

router.put("/kms", requireAdmin, async (req, res) => {
  try {
    // Aceita array directo OU { updates: [...] }
    const updates = Array.isArray(req.body)
      ? req.body
      : Array.isArray(req.body?.updates)
        ? req.body.updates
        : [];

    if (!updates.length) return res.status(400).json({ ok: false, message: "Array de configuraÃ§Ãµes obrigatÃ³rio." });

    const results = await Promise.all(
      updates.map(u =>
        KmConfig.findOneAndUpdate(
          { key: String(u.key || "").toLowerCase() },
          { $set: { label: u.label || u.key, valorPorKm: Number(u.valorPorKm || 0), ativo: u.ativo !== false } },
          { upsert: true, new: true }
        )
      )
    );
    return res.json({ ok: true, kms: results });
  } catch (err) {
    console.error("âŒ PUT /admin/kms:", err);
    return res.status(500).json({ ok: false, message: "Erro ao guardar configuraÃ§Ã£o KMS." });
  }
});

/* =========================================================
   GET /api/admin/motoristas
   Lista todos os motoristas (para o painel de gestÃ£o).
   Aceita ?status=pendente|aprovado|rejeitado|all
   ========================================================= */
router.get("/motoristas-lista", requireAdmin, async (req, res) => {
  try {
    const status = String(req.query.status || "all").toLowerCase();
    const filtro = {};
    if (status !== "all") filtro.aprovacao = status;

    const motoristas = await Motorista.find(filtro)
      .sort({ createdAt: -1 })
      .select("nome email contacto nif aprovacao validacao categoria createdAt documentos.fotoRosto")
      .lean();

    return res.json({ ok: true, motoristas });
  } catch (err) {
    console.error("âŒ GET /admin/motoristas-lista:", err);
    return res.status(500).json({ ok: false, message: "Erro ao listar motoristas." });
  }
});

/* =========================================================
   CATEGORIAS DE VEÍCULOS POR MARCA/MODELO
   Painel "Categorias Veículos" no admin-gestao.html — botão que
   até agora não tinha nenhum backend (chamava rotas que não
   existiam, falhava em silêncio no console, sem erro visível).

   Fonte única de verdade para POST /api/veiculos/registo decidir
   automaticamente a categoria/categoriasPermitidas de um veículo
   novo, a partir da Marca+Modelo — elimina a escolha manual (e os
   erros de categoria inválida que isso causava).
   ========================================================= */
router.get("/vehicle-categories", requireAdmin, async (_req, res) => {
  try {
    const regras = await VehicleCategoryRule.find({})
      .sort({ marcaLabel: 1, modeloLabel: 1 })
      .lean();

    // Agrupar por marca no formato que o admin-gestao.html espera:
    // { marcas: [ { label, marca, modelos: [{id,label,categorias}] } ] }
    const porMarca = new Map();
    for (const r of regras) {
      if (!porMarca.has(r.marcaLabel)) {
        porMarca.set(r.marcaLabel, { label: r.marcaLabel, marca: r.marca, modelos: [] });
      }
      porMarca.get(r.marcaLabel).modelos.push({
        id: String(r._id),
        label: r.modeloLabel,
        categorias: r.categorias || [],
      });
    }

    return res.json({ ok: true, marcas: [...porMarca.values()] });
  } catch (err) {
    console.error("❌ GET /admin/vehicle-categories:", err);
    return res.status(500).json({ ok: false, message: "Erro ao listar categorias." });
  }
});

router.post("/vehicle-categories", requireAdmin, async (req, res) => {
  try {
    const marcaLabel  = String(req.body?.marcaLabel  || "").trim();
    const modeloLabel = String(req.body?.modeloLabel || "").trim();
    const categorias  = Array.isArray(req.body?.categorias) ? req.body.categorias.map(String) : [];

    if (!marcaLabel)  return res.status(400).json({ ok: false, message: "marcaLabel obrigatório." });
    if (!modeloLabel) return res.status(400).json({ ok: false, message: "modeloLabel obrigatório." });

    const categoriasValidas = categorias.filter(c => CATEGORIAS_VALIDAS.includes(c));
    if (!categoriasValidas.length) {
      return res.status(400).json({ ok: false, message: "Selecione pelo menos uma categoria válida.", validas: CATEGORIAS_VALIDAS });
    }

    // Upsert por (marca, modelo) normalizados — o mesmo endpoint serve
    // tanto "criar modelo novo" (categorias:['economica'] por defeito,
    // vindo do frontend) como "guardar categorias" (array completo).
    const marca  = normalizarMarcaModelo(marcaLabel);
    const modelo = normalizarMarcaModelo(modeloLabel);

    const regra = await VehicleCategoryRule.findOneAndUpdate(
      { marca, modelo },
      { $set: { marcaLabel, modeloLabel, categorias: categoriasValidas } },
      { upsert: true, new: true, runValidators: true }
    );

    // ── Retroagir para veículos JÁ registados desta Marca/Modelo ──
    // Sem isto, esta regra só valia para registos futuros — um
    // veículo registado antes de a regra existir (ou antes de ser
    // editada) ficava com categoriasPermitidas vazio/desactualizado
    // para sempre, sem ninguém ser avisado.
    //
    // Comparação feita com normalizarMarcaModelo() dos DOIS lados —
    // a mesma função usada para indexar a própria regra — em vez de
    // comparação exacta/regex, que falha em silêncio perante
    // diferenças de maiúsculas, espaços ou acentos entre o que foi
    // escrito no registo do veículo (nomeadamente veículos antigos,
    // inseridos antes deste sistema existir) e o que se escreve
    // agora neste painel.
    const todosVeiculos = await Veiculo.find({}).select("marca modelo categoriasAtivas");
    const veiculosAfetados = todosVeiculos.filter(v =>
      normalizarMarcaModelo(v.marca) === marca && normalizarMarcaModelo(v.modelo) === modelo
    );
    // NOTA DE ESCALA: isto lê a frota toda para memória a cada regra
    // guardada. Aceitável porque é uma acção de admin, pouco
    // frequente — não é um caminho quente como o despacho. Se a
    // frota crescer muito (milhares de veículos) e isto começar a
    // pesar, a solução correta é guardar marca/modelo já
    // normalizados no próprio Veiculo (campos extra, preenchidos no
    // pre-save, tal como VehicleCategoryRule já faz) e filtrar
    // directamente na query — não repetir aqui o mesmo erro do
    // Motorista.find({}) que corrigimos no motor de despacho.

    let veiculosAtualizados = 0;
    for (const v of veiculosAfetados) {
      const ativasAntigas = Array.isArray(v.categoriasAtivas) ? v.categoriasAtivas : [];
      // Mantém ligado o que já estava ligado E continua permitido.
      // Se o veículo nunca teve nada permitido antes (caso legacy,
      // como o que originou este pedido), liga tudo o que passa a
      // ser permitido agora — mesmo comportamento do registo novo.
      const novasAtivas = ativasAntigas.length
        ? ativasAntigas.filter(c => categoriasValidas.includes(c))
        : categoriasValidas.slice();

      await Veiculo.updateOne(
        { _id: v._id },
        { $set: {
            categoriasPermitidas: categoriasValidas,
            categoriasAtivas: novasAtivas.length ? novasAtivas : categoriasValidas,
        }}
      );
      veiculosAtualizados++;
    }

    return res.json({
      ok: true,
      regra: { id: String(regra._id), label: regra.modeloLabel, categorias: regra.categorias },
      veiculosAtualizados,
    });
  } catch (err) {
    console.error("❌ POST /admin/vehicle-categories:", err);
    return res.status(500).json({ ok: false, message: "Erro ao guardar categorias." });
  }
});

router.delete("/vehicle-categories/:id", requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const apagada = await VehicleCategoryRule.findByIdAndDelete(id);
    if (!apagada) return res.status(404).json({ ok: false, message: "Regra não encontrada." });
    return res.json({ ok: true, message: "Regra removida." });
  } catch (err) {
    console.error("❌ DELETE /admin/vehicle-categories/:id:", err);
    return res.status(500).json({ ok: false, message: "Erro ao remover regra." });
  }
});

export default router;