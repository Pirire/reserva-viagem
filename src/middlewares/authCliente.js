// src/middlewares/authCliente.js
// ══════════════════════════════════════════════════════════════
// Autenticação híbrida de clientes — Web + App
// ══════════════════════════════════════════════════════════════

import jwt from "jsonwebtoken";
import Cliente from "../models/Cliente.js";
import { extractToken } from "../utils/authUtils.js";

export default async function authCliente(req, res, next) {
  try {
    const token = extractToken(req, 'rm_cliente_token', ['cliente_token', 'token']);

    if (!token) {
      return res.status(401).json({
        ok: false, code: "TOKEN_MISSING",
        message: "Sessão não encontrada. Por favor inicie sessão.",
      });
    }

    const secret  = process.env.JWT_SECRET || process.env.CLIENT_JWT_SECRET || "";
    const payload = jwt.verify(token, secret);

    // Aceita tokens com typ:"cliente" ou sem typ (legacy)
    const typ = String(payload?.typ || "").toLowerCase();
    if (typ && typ !== "cliente") {
      return res.status(403).json({
        ok: false, code: "TOKEN_TYPE_INVALID",
        message: "Token não é de cliente.",
      });
    }

    const cliente = await Cliente.findById(payload.id || payload._id)
      .select("-passwordHash")
      .lean();

    if (!cliente) {
      return res.status(401).json({
        ok: false, code: "CLIENT_NOT_FOUND",
        message: "Sessão inválida. Por favor inicie sessão novamente.",
      });
    }

    req.cliente = cliente;
    return next();

  } catch (e) {
    const isExpired = e?.name === "TokenExpiredError";
    return res.status(401).json({
      ok: false,
      code: isExpired ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
      message: isExpired
        ? "Sessão expirada. Por favor inicie sessão novamente."
        : "Não autenticado.",
    });
  }
}