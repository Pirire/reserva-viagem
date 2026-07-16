// src/middlewares/auth.middleware.js
// ══════════════════════════════════════════════════════════════
// Middlewares de autenticação e autorização unificados.
// Substitui auth.js e auth_middleware.js (eram duplicados).
//
// Exports:
//   authRequired          — valida JWT Bearer, injeta req.user
//   authRole(role)        — autoriza por role ou tipo
//   authColaboradorTipo   — autoriza colaborador por tipo específico
// ══════════════════════════════════════════════════════════════

import { verifyJwt } from "../config/jwt.js";

/* ── Helper: extrai token Bearer ─────────────────────────────── */
function getBearerToken(req) {
  const auth = String(req.headers?.authorization || "");
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
}

/* ── authRequired ────────────────────────────────────────────
   Valida o token JWT e injeta req.user.
   Compatível com tokens que usem "role" ou "tipo".
─────────────────────────────────────────────────────────────── */
export function authRequired(req, res, next) {
  const token = getBearerToken(req);

  if (!token) {
    return res.status(401).json({
      ok: false, success: false,
      code: "TOKEN_MISSING",
      message: "Token de autenticação ausente.",
    });
  }

  try {
    req.user = verifyJwt(token);
    return next();
  } catch {
    return res.status(401).json({
      ok: false, success: false,
      code: "TOKEN_INVALID",
      message: "Token inválido ou expirado.",
    });
  }
}

/* ── authRole ────────────────────────────────────────────────
   Autoriza por role ou tipo (compatível com ambos os formatos
   de JWT em uso no sistema).

   Uso: authRole("admin") | authRole("cliente") | authRole("motorista")
─────────────────────────────────────────────────────────────── */
export function authRole(role) {
  return (req, res, next) => {
    authRequired(req, res, () => {
      // Suporta tokens com "role" ou "tipo"
      const userRole = String(
        req.user?.role || req.user?.tipo || ""
      ).toLowerCase();

      const expected = String(role || "").toLowerCase();

      if (!userRole || userRole !== expected) {
        return res.status(403).json({
          ok: false, success: false,
          code: "FORBIDDEN",
          message: "Sem permissão para aceder a este recurso.",
        });
      }

      return next();
    });
  };
}

/* ── authColaboradorTipo ─────────────────────────────────────
   Autoriza colaboradores por tipo específico.

   Uso: authColaboradorTipo("hotel" | "frota" | "alojamento")
─────────────────────────────────────────────────────────────── */
export function authColaboradorTipo(tipo) {
  return (req, res, next) => {
    authRequired(req, res, () => {
      const userRole = String(req.user?.role || req.user?.tipo || "").toLowerCase();

      if (userRole !== "colaborador") {
        return res.status(403).json({
          ok: false, success: false,
          code: "FORBIDDEN",
          message: "Acesso restrito a colaboradores.",
        });
      }

      const userTipo = String(req.user?.colabTipo || "").toLowerCase();
      const expected = String(tipo || "").toLowerCase();

      if (!userTipo || userTipo !== expected) {
        return res.status(403).json({
          ok: false, success: false,
          code: "FORBIDDEN_TIPO",
          message: `Acesso restrito a colaboradores do tipo '${expected}'.`,
        });
      }

      return next();
    });
  };
}