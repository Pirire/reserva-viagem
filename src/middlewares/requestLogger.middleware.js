// src/middlewares/requestLogger.middleware.js
// ══════════════════════════════════════════════════════════════
// Logging automático de todos os pedidos HTTP.
//
// Cada request recebe um ID único (X-Request-ID) para rastrear
// toda a cadeia de logs de um pedido específico em produção.
//
// O ID é devolvido no header de resposta — útil para o cliente
// reportar um erro ao suporte com o ID exato.
// ══════════════════════════════════════════════════════════════

import pinoHttp         from "pino-http";
import { randomUUID }   from "crypto";
import logger           from "../config/logger.js";

export const requestLogger = pinoHttp({
  logger,

  // ── ID único por request ──────────────────────────────────
  // Usa o header X-Request-ID se vier do cliente (ex: frontend),
  // caso contrário gera um UUID novo.
  genReqId: (req, res) => {
    const existing = req.headers["x-request-id"];
    const id = existing || randomUUID();
    res.setHeader("x-request-id", id);
    return id;
  },

  // ── Nível de log por status code ─────────────────────────
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400)        return "warn";
    if (res.statusCode >= 300)        return "debug";
    return "info";
  },

  // ── Mensagem legível ──────────────────────────────────────
  customSuccessMessage: (req, res) =>
    `${req.method} ${req.url} → ${res.statusCode}`,

  customErrorMessage: (req, res, err) =>
    `${req.method} ${req.url} → ${res.statusCode} | ${err?.message ?? "erro desconhecido"}`,

  // ── Campos serializados por request ──────────────────────
  serializers: {
    req: (req) => ({
      id:        req.id,
      method:    req.method,
      url:       req.url,
      userAgent: req.headers?.["user-agent"] ?? "",
      ip:        req.remoteAddress ?? "",
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },

  // ── Rotas a ignorar (reduzem ruído nos logs) ──────────────
  autoLogging: {
    ignore: (req) => {
      const skip = [
        "/api/__health",
        "/favicon.ico",
        "/uploads/",
      ];
      return skip.some((p) => req.url?.startsWith(p));
    },
  },
});