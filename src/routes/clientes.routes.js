// src/routes/clientes.routes.js
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import Cliente from "../models/Cliente.js";
import authCliente from "../middlewares/authCliente.js";
import { isAppClient, setCookieToken, clearCookieToken } from "../utils/authUtils.js";

const router = Router();

console.log("✅ clientes.routes.js carregado");

function normalizeEmail(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ""); // remove espaços
}

function isEmailValid(v) {
  const s = String(v || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return false;
  if (/\.\@/.test(s)) return false; // bloqueia ".@"
  return true;
}

function requireJwtSecret(res) {
  const secret = String(process.env.JWT_SECRET || process.env.CLIENT_JWT_SECRET || "").trim();
  if (!secret) {
    res.status(500).json({ ok: false, message: "JWT_SECRET não definido no .env" });
    return null;
  }
  return secret;
}

/**
 * GET /api/clientes/me
 * Devolve o perfil do cliente autenticado.
 * Aceita: Authorization: Bearer <token>  (enviado pelo frontend após login)
 */
router.get("/me", async (req, res) => {
  try {
    // Lê token do cookie httpOnly (preferência) ou header Authorization
    const cookieToken = req.cookies?.rm_cliente_token || "";
    const auth        = String(req.headers.authorization || "");
    const bearerToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const token       = cookieToken || bearerToken;

    if (!token) {
      return res.status(401).json({ ok: false, message: "Sem token de autenticação." });
    }

    const secret = String(process.env.JWT_SECRET || process.env.CLIENT_JWT_SECRET || "").trim();
    if (!secret) {
      return res.status(500).json({ ok: false, message: "JWT_SECRET não definido no .env" });
    }

    const payload = jwt.verify(token, secret);
    const typ = String(payload?.typ || "").toLowerCase();
    if (typ && typ !== "cliente") {
      return res.status(403).json({ ok: false, message: "Token não é de cliente." });
    }

    const cliente = await Cliente.findById(payload.id).lean();
    if (!cliente) {
      return res.status(401).json({ ok: false, message: "Utilizador não encontrado." });
    }

    return res.json({
      ok: true,
      user: {
        id:        String(cliente._id),
        nome:      cliente.nome,
        email:     cliente.email,
        contacto:  cliente.contacto,
        createdAt: cliente.createdAt || null,
        updatedAt: cliente.updatedAt || null,
      },
    });
  } catch (e) {
    return res.status(401).json({ ok: false, message: "Não autenticado." });
  }
});

// POST /api/clientes/register
router.post("/register", async (req, res) => {
  try {
    const nome = String(req.body?.nome || "").trim();
    const email = normalizeEmail(req.body?.email);
    const contacto = String(req.body?.contacto || "").trim();
    const senha = String(req.body?.senha || req.body?.password || "").trim();

    console.log("RAW email:", req.body?.email);
    console.log("NORM email:", email);

    if (!nome || !email || !contacto || !senha) {
      return res.status(400).json({
        ok: false,
        message: "Campos obrigatórios: nome, email, contacto, senha.",
      });
    }
    if (!isEmailValid(email)) {
      return res.status(400).json({ ok: false, message: "Email inválido." });
    }
    if (senha.length < 4) {
      return res.status(400).json({ ok: false, message: "Senha muito curta." });
    }

    const exists = await Cliente.findOne({ email }).lean();
    if (exists) {
      return res.status(409).json({ ok: false, message: "Email já registado." });
    }

    const passwordHash = await bcrypt.hash(senha, 10);
    const doc = await Cliente.create({ nome, email, contacto, passwordHash });

    const secret = requireJwtSecret(res);
    if (!secret) return;

    const token = jwt.sign(
      { typ: "cliente", id: String(doc._id), email: doc.email },
      secret,
      { expiresIn: "7d" }
    );

    // Web: cookie httpOnly | App: token no body
    setCookieToken(res, "rm_cliente_token", token);

    return res.json({
      ok: true,
      message: "Cliente registado com sucesso!",
      // token devolvido no body para apps móveis
      // (browser ignora e usa o cookie httpOnly)
      token: isAppClient(req) ? token : undefined,
      user: {
        id:       String(doc._id),
        nome:     doc.nome,
        email:    doc.email,
        contacto: doc.contacto,
      },
    });
  } catch (err) {
    console.error("❌ /clientes/register:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

// POST /api/clientes/login
router.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const senha = String(req.body?.senha || req.body?.password || "").trim();

    if (!email || !senha) {
      return res.status(400).json({ ok: false, message: "email e senha são obrigatórios." });
    }
    if (!isEmailValid(email)) {
      return res.status(400).json({ ok: false, message: "Email inválido." });
    }

    const doc = await Cliente.findOne({ email });
    if (!doc) {
      return res.status(401).json({ ok: false, message: "Credenciais inválidas." });
    }

    const ok = await bcrypt.compare(senha, String(doc.passwordHash || ""));
    if (!ok) {
      return res.status(401).json({ ok: false, message: "Credenciais inválidas." });
    }

    const secret = requireJwtSecret(res);
    if (!secret) return;

    const token = jwt.sign(
      { typ: "cliente", id: String(doc._id), email: doc.email },
      secret,
      { expiresIn: "7d" }
    );

    // Web: cookie httpOnly | App: token no body
    setCookieToken(res, "rm_cliente_token", token);

    return res.json({
      ok: true,
      message: "Login efetuado com sucesso!",
      // token devolvido no body para apps móveis
      token: isAppClient(req) ? token : undefined,
      user: {
        id:       String(doc._id),
        nome:     doc.nome,
        email:    doc.email,
        contacto: doc.contacto,
      },
    });
  } catch (err) {
    console.error("❌ /clientes/login:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

// POST /api/clientes/logout
router.post("/logout", (_req, res) => {
  clearCookieToken(res, "rm_cliente_token");
  return res.json({ ok: true });
});

export default router;