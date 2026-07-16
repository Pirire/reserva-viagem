// src/middlewares/error.middleware.js
// ══════════════════════════════════════════════════════════════
// Middleware de erro global — captura todos os erros não tratados
// e devolve uma resposta JSON consistente ao cliente.
//
// Em produção: nunca expõe stack traces ao cliente.
// Em qualquer ambiente: regista o erro completo nos logs.
// ══════════════════════════════════════════════════════════════

import logger from "../config/logger.js";

const isDev = process.env.NODE_ENV !== "production";

function errorMiddleware(err, req, res, _next) {
  const statusCode = err.statusCode || err.status || 500;
  const isServer   = statusCode >= 500;

  // ── Log estruturado ───────────────────────────────────────
  const logPayload = {
    requestId: res.getHeader?.("x-request-id") ?? req.id ?? "—",
    method:    req.method,
    url:       req.originalUrl ?? req.url,
    statusCode,
    code:      err.code     ?? "INTERNAL_ERROR",
    message:   err.message  ?? "Erro interno",
    ...(isDev && { stack: err.stack }),
  };

  if (isServer) {
    logger.error(logPayload, "❌ Erro de servidor");
  } else {
    logger.warn(logPayload, "⚠️ Erro de cliente");
  }

  // ── Resposta ao cliente ───────────────────────────────────
  // Nunca expõe stack trace em produção
  return res.status(statusCode).json({
    ok:      false,
    success: false,
    code:    err.code ?? (isServer ? "INTERNAL_ERROR" : "BAD_REQUEST"),
    message: isServer && !isDev
      ? "Erro interno do servidor. Por favor tente mais tarde."
      : err.message ?? "Erro interno do servidor.",
    requestId: res.getHeader?.("x-request-id") ?? null,
  });
}

export default errorMiddleware;