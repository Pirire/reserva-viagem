// src/middlewares/authMotorista.js
// ══════════════════════════════════════════════════════════════
// Autenticação híbrida de motoristas — Web + App
// ══════════════════════════════════════════════════════════════

import jwt from "jsonwebtoken";
import { extractToken } from "../utils/authUtils.js";

export function authMotorista(req, res, next) {
  const token = extractToken(req, 'rm_motorista_token');

  if (!token) {
    return res.status(401).json({
      ok: false, success: false,
      code: "TOKEN_MISSING",
      message: "Sessão não encontrada. Por favor inicie sessão.",
    });
  }

  try {
    const secret  = process.env.JWT_SECRET || process.env.CLIENT_JWT_SECRET || "";
    const payload = jwt.verify(token, secret);

    if (payload?.tipo !== "motorista") {
      return res.status(403).json({
        ok: false, success: false,
        code: "TOKEN_TYPE_INVALID",
        message: "Acesso negado.",
      });
    }

    req.motorista = {
      id:    payload.id,
      email: payload.email,
      nome:  payload.nome,
    };
    return next();

  } catch (e) {
    const isExpired = e?.name === "TokenExpiredError";
    return res.status(401).json({
      ok: false, success: false,
      code: isExpired ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
      message: isExpired ? "Sessão expirada." : "Sessão inválida.",
    });
  }
}