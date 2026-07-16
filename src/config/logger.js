// src/config/logger.js
// ══════════════════════════════════════════════════════════════
// Logger estruturado — pino
//
// Desenvolvimento : output legível com cores (pino-pretty)
// Produção        : JSON puro, 1 linha por evento
//                   → compatível com Datadog, Logtail, Papertrail,
//                     Render Logs, Railway, AWS CloudWatch, etc.
//
// Níveis (do mais para o menos verboso):
//   trace | debug | info | warn | error | fatal
//
// Variáveis de ambiente:
//   LOG_LEVEL  — nível mínimo (default: debug em dev, info em prod)
//   NODE_ENV   — "production" ativa JSON puro
// ══════════════════════════════════════════════════════════════

import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),

  // ── Redacção de campos sensíveis ──────────────────────────
  // Nunca aparecem em logs — nem em desenvolvimento
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.passwordHash",
      "*.tokenHash",
      "*.token",
      "*.secret",
      "*.iban",
      "*.nif",
    ],
    censor: "[REDACTED]",
  },

  // ── Formatação em desenvolvimento ─────────────────────────
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize:      true,
        translateTime: "HH:MM:ss.l",
        ignore:        "pid,hostname",
        messageFormat: "{msg}",
      },
    },
  }),

  // ── Base de cada log em produção ──────────────────────────
  base: {
    env:  process.env.NODE_ENV ?? "development",
    app:  "realmetropolis-backend",
    pid:  process.pid,
  },
});

export default logger;