import { Router } from "express";
import Cliente from "../models/Cliente.js";
// (Import de Colaborador removido — os endpoints /colaboradores/* migraram
// para /api/colaboradores/* em src/routes/colaboradores.routes.js, que usa
// cookie httpOnly + bcrypt como padrão único de autenticação para gestores.)
import Motorista from "../models/Motorista.js"; // ✅ ADICIONADO (ajusta o caminho se necessário)
import { signJwt } from "../config/jwt.js";

import jwt from "jsonwebtoken"; // ✅ ADICIONADO (para validar token)

const router = Router();

/* =========================
   HELPERS
========================= */
function normEmail(email) {
  return String(email || "").toLowerCase().trim();
}

function isEmailValid(email) {
  // simples e suficiente para validação básica
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function cleanString(v) {
  return String(v ?? "").trim();
}

/* =========================
   ✅ AUTH TOKEN (cookie ou Authorization)
========================= */
function getTokenFromReq(req) {
  const header = req.headers?.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();

  // cookies comuns
  return (
    req.cookies?.token ||
    req.cookies?.auth ||
    req.cookies?.jwt ||
    req.cookies?.access_token ||
    null
  );
}

function verifyToken(req) {
  const token = getTokenFromReq(req);
  if (!token) return null;

  try {
    // usa o teu secret (mesmo que o signJwt usa)
    const secret = process.env.JWT_SECRET || process.env.JWT_KEY || process.env.SECRET;
    if (!secret) return null;
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

function authMotorista(req, res, next) {
  const payload = verifyToken(req);
  if (!payload) {
    return res.status(401).json({ success: false, message: "Não autenticado" });
  }
  if (payload.role !== "motorista") {
    return res.status(403).json({ success: false, message: "Sem permissão" });
  }
  req.user = payload;
  return next();
}

/* =========================
   CLIENTES
========================= */
router.post("/clientes/register", async (req, res) => {
  try {
    const { nome, sobrenome, email, contacto, senha, password } = req.body || {};
    const pass = cleanString(password || senha);

    const nomeClean = cleanString(nome);
    const sobrenomeClean = cleanString(sobrenome);
    const emailNorm = normEmail(email);
    const contactoClean = cleanString(contacto);

    if (!nomeClean || !emailNorm || !contactoClean || !pass) {
      return res.status(400).json({
        success: false,
        message: "nome, email, contacto e senha obrigatórios",
      });
    }

    if (!isEmailValid(emailNorm)) {
      return res.status(400).json({ success: false, message: "Email inválido" });
    }

    if (pass.length < 6) {
      return res.status(400).json({ success: false, message: "A senha deve ter pelo menos 6 caracteres" });
    }

    const exists = await Cliente.findOne({ email: emailNorm }).lean();
    if (exists) {
      return res.status(409).json({ success: false, message: "Email já registado" });
    }

    // Cria e guarda (mantém a tua abordagem passwordHash + setPassword)
    const cliente = new Cliente({
      nome: nomeClean,
      sobrenome: sobrenomeClean || "",
      email: emailNorm,
      contacto: contactoClean,
      passwordHash: "tmp",
    });

    if (typeof cliente.setPassword !== "function") {
      return res.status(500).json({
        success: false,
        message: "Model Cliente sem setPassword()",
      });
    }

    await cliente.setPassword(pass);
    await cliente.save();

    const token = signJwt(
      { role: "cliente", id: cliente._id.toString(), email: cliente.email, nome: cliente.nome },
      process.env.JWT_EXPIRES_CLIENTE || "7d"
    );

    return res.json({ success: true, token });
  } catch (err) {
    console.error("❌ Erro /api/clientes/register:", err);

    // devolve debug (ajuda a encontrar o problema real)
    return res.status(500).json({
      success: false,
      message: "Erro ao registar cliente",
      debug: err?.message,
      code: err?.code,
    });
  }
});

router.post("/clientes/login", async (req, res) => {
  try {
    const { email, senha, password } = req.body || {};
    const pass = cleanString(password || senha);
    const emailNorm = normEmail(email);

    if (!emailNorm || !pass) {
      return res.status(400).json({ success: false, message: "email e senha obrigatórios" });
    }

    if (!isEmailValid(emailNorm)) {
      return res.status(400).json({ success: false, message: "Email inválido" });
    }

    const cliente = await Cliente.findOne({ email: emailNorm }).select("+passwordHash");
    if (!cliente) {
      return res.status(401).json({ success: false, message: "Credenciais inválidas" });
    }

    if (typeof cliente.comparePassword !== "function") {
      return res.status(500).json({
        success: false,
        message: "Model Cliente sem comparePassword()",
      });
    }

    const ok = await cliente.comparePassword(pass);
    if (!ok) {
      return res.status(401).json({ success: false, message: "Credenciais inválidas" });
    }

    const token = signJwt(
      { role: "cliente", id: cliente._id.toString(), email: cliente.email, nome: cliente.nome },
      process.env.JWT_EXPIRES_CLIENTE || "7d"
    );

    return res.json({ success: true, token });
  } catch (err) {
    console.error("❌ Erro /api/clientes/login:", err);
    return res.status(500).json({
      success: false,
      message: "Erro no login do cliente",
      debug: err?.message,
      code: err?.code,
    });
  }
});


/* =========================
   COLABORADORES (PARCEIROS) — MIGRADO
   Os endpoints /colaboradores/register e /colaboradores/login foram
   removidos daqui. A autenticação de gestores/parceiros (colaboradores)
   agora vive em src/routes/colaboradores.routes.js, montado em
   /api/colaboradores/* (e alias /api/gestor/*).

   Motivos:
     • Uma única fonte de verdade para autenticação de colaboradores
     • Cookie httpOnly (colab_token) em vez de token JWT no localStorage
       — mais resistente a XSS
     • Middleware híbrido authGestorOrPartner aceita cookie OU X-Api-Key,
       permitindo integrações externas e uso interno pelo painel do gestor
     • Cookies com SameSite=lax (proteção CSRF razoável para navegação)
========================= */

/* =========================
   ✅ MOTORISTAS
   - login (opcional)
   - localização (para o mapa do Admin)
========================= */

// ✅ Se já tens login de motorista noutro ficheiro, podes apagar esta rota.
router.post("/motoristas/login", async (req, res) => {
  try {
    const { email, senha, password } = req.body || {};
    const pass = cleanString(password || senha);
    const emailNorm = normEmail(email);

    if (!emailNorm || !pass) {
      return res.status(400).json({ success: false, message: "email e senha obrigatórios" });
    }

    if (!isEmailValid(emailNorm)) {
      return res.status(400).json({ success: false, message: "Email inválido" });
    }

    const motorista = await Motorista.findOne({ email: emailNorm }).select("+passwordHash");
    if (!motorista) {
      return res.status(401).json({ success: false, message: "Credenciais inválidas" });
    }

    if (typeof motorista.comparePassword !== "function") {
      return res.status(500).json({
        success: false,
        message: "Model Motorista sem comparePassword()",
      });
    }

    const ok = await motorista.comparePassword(pass);
    if (!ok) {
      return res.status(401).json({ success: false, message: "Credenciais inválidas" });
    }

    const token = signJwt(
      { role: "motorista", id: motorista._id.toString(), email: motorista.email, nome: motorista.nome },
      process.env.JWT_EXPIRES_MOTORISTA || "7d"
    );

    return res.json({ success: true, token });
  } catch (err) {
    console.error("❌ Erro /api/motoristas/login:", err);
    return res.status(500).json({
      success: false,
      message: "Erro no login do motorista",
      debug: err?.message,
      code: err?.code,
    });
  }
});

/**
 * ✅ Endpoint esperado pelo frontend do motorista:
 * POST /api/motorista/localizacao
 * Body: { lat, lng, accuracy?, speed?, heading?, ts? }
 *
 * Guarda em Motorista.location = { lat, lng, updatedAt }
 */
router.post("/motorista/localizacao", authMotorista, async (req, res) => {
  try {
    const { lat, lng, accuracy, speed, heading, ts } = req.body || {};

    const latNum = Number(lat);
    const lngNum = Number(lng);

    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return res.status(400).json({ success: false, message: "lat/lng inválidos" });
    }

    const updatedAt = ts ? new Date(Number(ts)) : new Date();

    await Motorista.findByIdAndUpdate(
      req.user.id,
      {
        $set: {
          location: {
            lat: latNum,
            lng: lngNum,
            updatedAt,
            accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
            speed: Number.isFinite(Number(speed)) ? Number(speed) : null,
            heading: Number.isFinite(Number(heading)) ? Number(heading) : null,
          },
        },
      },
      { new: false }
    );

    return res.json({ success: true, updatedAt });
  } catch (err) {
    console.error("❌ Erro /api/motorista/localizacao:", err);
    return res.status(500).json({
      success: false,
      message: "Erro ao atualizar localização",
      debug: err?.message,
      code: err?.code,
    });
  }
});

export default router;