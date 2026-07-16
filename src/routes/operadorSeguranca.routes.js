// src/routes/operadorSeguranca.routes.js
// ══════════════════════════════════════════════════════════════
// Registo, login e perfil dos operadores de segurança.
//
// POST /api/operadores-seguranca/registar  — registo via token
// POST /api/operadores-seguranca/login     — login
// GET  /api/operadores-seguranca/me        — perfil autenticado
// POST /api/operadores-seguranca/logout    — logout
//
// Admin (admin.routes.js):
// POST /api/admin/operadores-seguranca/invite — enviar convite
// GET  /api/admin/operadores-seguranca        — listar operadores
// POST /api/admin/operadores-seguranca/:id/aprovar — aprovar
// ══════════════════════════════════════════════════════════════

import { Router }  from "express";
import crypto      from "crypto";
import bcrypt      from "bcrypt";
import jwt         from "jsonwebtoken";
import multer      from "multer";
import path        from "path";
import fs          from "fs";
import OperadorSeguranca from "../models/OperadorSeguranca.js";
import logger      from "../config/logger.js";
import { setCookieToken, clearCookieToken, extractToken, isAppClient } from "../utils/authUtils.js";

const router = Router();

// ── Upload de documentos ──────────────────────────────────────
const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads", "operadores-seguranca");
const ALLOWED_MIME = new Set(["application/pdf","image/jpeg","image/png","image/webp"]);

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const slug = (req.body?.email || "tmp").replace(/[^\w@.-]/g,"_").slice(0,40);
    const dest = path.join(UPLOAD_ROOT, slug);
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname || "").toLowerCase();
    const safe = file.fieldname.replace(/[^\w-]/g,"_");
    cb(null, `${safe}_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype))
      return cb(Object.assign(new Error("Formato inválido."), { statusCode: 415 }));
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024, files: 2 },
});

const uploadFields = upload.fields([
  { name:"doc_cc_frente", maxCount:1 },
  { name:"doc_cc_verso",  maxCount:1 },
]);

function mapFile(arr) {
  if (!arr?.[0]) return null;
  const f = arr[0];
  const raw = String(f.path||"").replace(/\\/g,"/");
  const idx = raw.indexOf("uploads/");
  const url = idx !== -1 ? "/"+raw.slice(idx) : "/uploads/"+f.filename;
  return { file:{ filename:f.filename, mimetype:f.mimetype, size:f.size, url, path:url } };
}

// ── Auth middleware ───────────────────────────────────────────
export function authOperadorSeguranca(req, res, next) {
  try {
    const token  = extractToken(req, "rm_operador_token");
    if (!token) return res.status(401).json({ ok:false, code:"UNAUTHORIZED", message:"Sessão necessária." });
    const secret = process.env.JWT_SECRET || "";
    const payload = jwt.verify(token, secret);
    if (String(payload?.typ||"") !== "operador_seguranca") {
      return res.status(403).json({ ok:false, code:"FORBIDDEN", message:"Acesso negado." });
    }
    req.operador = payload;
    next();
  } catch(e) {
    const exp = e?.name === "TokenExpiredError";
    return res.status(401).json({ ok:false, code: exp?"TOKEN_EXPIRED":"TOKEN_INVALID", message: exp?"Sessão expirada.":"Não autenticado." });
  }
}

/* ══════════════════════════════════════════════════════════════
   POST /api/operadores-seguranca/registar
══════════════════════════════════════════════════════════════ */
router.post("/registar", uploadFields, async (req, res) => {
  try {
    const { token, nome, nif, cc, contacto, endereco, email, password } = req.body || {};

    if (!token)    return res.status(400).json({ ok:false, message:"Token obrigatório." });
    if (!nome)     return res.status(400).json({ ok:false, message:"Nome obrigatório." });
    if (!nif)      return res.status(400).json({ ok:false, message:"NIF obrigatório." });
    if (!cc)       return res.status(400).json({ ok:false, message:"Nº CC obrigatório." });
    if (!contacto) return res.status(400).json({ ok:false, message:"Contacto obrigatório." });
    if (!endereco) return res.status(400).json({ ok:false, message:"Endereço obrigatório." });
    if (!email)    return res.status(400).json({ ok:false, message:"Email obrigatório." });
    if (!password) return res.status(400).json({ ok:false, message:"Palavra-passe obrigatória." });

    if (password.length < 8)
      return res.status(400).json({ ok:false, message:"Palavra-passe mínimo 8 caracteres." });
    if (!/^\d{9}$/.test(nif.replace(/\s/g,"")))
      return res.status(400).json({ ok:false, message:"NIF inválido." });
    if (!req.files?.doc_cc_frente?.[0] || !req.files?.doc_cc_verso?.[0])
      return res.status(400).json({ ok:false, message:"Frente e verso do CC obrigatórios." });

    const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");
    const operador  = await OperadorSeguranca.findOne({ tokenHash });

    if (!operador)        return res.status(404).json({ ok:false, code:"INVALID_TOKEN",    message:"Convite inválido ou expirado." });
    if (operador.tokenUsadoEm) return res.status(409).json({ ok:false, code:"TOKEN_USED", message:"Este convite já foi utilizado." });

    const emailNorm = email.toLowerCase().trim();
    const existe = await OperadorSeguranca.findOne({ email:emailNorm, _id:{ $ne:operador._id } }).lean();
    if (existe) return res.status(409).json({ ok:false, code:"EMAIL_EXISTS", message:"Email já registado." });

    operador.email        = emailNorm;
    operador.passwordHash = await bcrypt.hash(password, 12);
    operador.nome         = nome.trim();
    operador.nif          = nif.replace(/\s/g,"");
    operador.cc           = cc.trim();
    operador.contacto     = contacto.trim();
    operador.endereco     = endereco.trim();
    operador.tokenUsadoEm = new Date();
    operador.aprovado     = false;
    operador.documentos   = {
      ccFrente: mapFile(req.files?.doc_cc_frente),
      ccVerso:  mapFile(req.files?.doc_cc_verso),
    };
    operador.validacao = { status:"pendente", observacoes:"", validadoEm:null, validadoPorId:"", validadoPorNome:"" };
    await operador.save();

    logger.info({ email:emailNorm, regiao:operador.regiao }, "✅ Operador de segurança registado");
    return res.status(201).json({ ok:true, message:"Registo concluído. Aguarda aprovação do administrador." });
  } catch(err) {
    logger.error({ err }, "❌ /operadores-seguranca/registar");
    return res.status(500).json({ ok:false, message:"Erro interno." });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/operadores-seguranca/login
══════════════════════════════════════════════════════════════ */
router.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email||"").toLowerCase().trim();
    const senha = String(req.body?.senha||req.body?.password||"");

    if (!email || !senha)
      return res.status(400).json({ ok:false, message:"Email e palavra-passe obrigatórios." });

    const operador = await OperadorSeguranca.findOne({ email });
    if (!operador || !operador.passwordHash)
      return res.status(401).json({ ok:false, message:"Credenciais inválidas." });
    if (!operador.aprovado)
      return res.status(403).json({ ok:false, code:"NOT_APPROVED", message:"Conta ainda não aprovada pelo administrador." });

    const ok = await bcrypt.compare(senha, operador.passwordHash);
    if (!ok) return res.status(401).json({ ok:false, message:"Credenciais inválidas." });

    const secret = process.env.JWT_SECRET || "";
    const token  = jwt.sign(
      { typ:"operador_seguranca", id:String(operador._id), email:operador.email, regiao:operador.regiao, nome:operador.nome },
      secret,
      { expiresIn:"8h" }
    );

    setCookieToken(res, "rm_operador_token", token, 1); // 1 dia — sessão de turno
    logger.info({ email, regiao:operador.regiao }, "✅ Login operador segurança");

    return res.json({
      ok:true,
      token: isAppClient(req) ? token : undefined,
      operador:{ id:String(operador._id), nome:operador.nome, email:operador.email, regiao:operador.regiao },
    });
  } catch(err) {
    logger.error({ err }, "❌ /operadores-seguranca/login");
    return res.status(500).json({ ok:false, message:"Erro interno." });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/operadores-seguranca/me
══════════════════════════════════════════════════════════════ */
router.get("/me", authOperadorSeguranca, async (req, res) => {
  try {
    const operador = await OperadorSeguranca.findById(req.operador.id)
      .select("-passwordHash -tokenHash").lean();
    if (!operador) return res.status(404).json({ ok:false, message:"Operador não encontrado." });
    return res.json({ ok:true, operador });
  } catch(err) {
    logger.error({ err }, "❌ /operadores-seguranca/me");
    return res.status(500).json({ ok:false });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/operadores-seguranca/logout
══════════════════════════════════════════════════════════════ */
router.post("/logout", (req, res) => {
  clearCookieToken(res, "rm_operador_token");
  return res.json({ ok:true, message:"Sessão terminada." });
});

export default router;