// src/routes/clientes.contactos.routes.js
// ── SaaS-level — rate limit por utilizador autenticado ────────

import express    from "express";
import rateLimit  from "express-rate-limit";
import {
  listarContactos,
  adicionarContacto,
  removerContacto,
} from "../controllers/clientes.contactos.controller.js";

const router = express.Router();

/* ── Rate limiting por ID de cliente autenticado ──────────────
   authCliente já correu no app.js — req.cliente._id garantido.
   Não usamos req.ip como fallback para evitar problemas IPv6
   e porque esta rota SEMPRE requer autenticação.
─────────────────────────────────────────────────────────────── */

/** Leitura — generosa: 60 req / 1 min */
const limiterRead = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => `ctc_r_${req.cliente._id}`,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { ok: false, code: "RATE_LIMIT", message: "Demasiados pedidos. Aguarde um momento." },
});

/** Escrita — restritiva: 20 req / 15 min */
const limiterWrite = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => `ctc_w_${req.cliente._id}`,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  skipSuccessfulRequests: true,
  message: { ok: false, code: "RATE_LIMIT_WRITE", message: "Demasiadas alterações. Aguarde 15 minutos." },
});

/** Remoção — moderada: 30 req / 15 min */
const limiterDelete = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => `ctc_d_${req.cliente._id}`,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  skipSuccessfulRequests: true,
  message: { ok: false, code: "RATE_LIMIT_DELETE", message: "Demasiadas remoções. Aguarde 15 minutos." },
});

/* ── ROTAS ──────────────────────────────────────────────────── */

// GET  /api/clientes/me/contactos?q=&page=&limit=
router.get("/",       limiterRead,   listarContactos);

// POST /api/clientes/me/contactos   { nome, tel }
router.post("/",      limiterWrite,  adicionarContacto);

// DELETE /api/clientes/me/contactos/:id
router.delete("/:id", limiterDelete, removerContacto);

export default router;