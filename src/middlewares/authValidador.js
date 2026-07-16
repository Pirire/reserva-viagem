// src/middlewares/authValidador.js
// ══════════════════════════════════════════════════════════════
// Autenticação do validador — cookie httpOnly com JWT.
//
// Preenche req.validador com { id, email, scope } para as rotas
// que precisam de saber quem está autenticado (para filtrar
// submissões, gravar auditoria, etc.).
//
// COMPATIBILIDADE:
//   • Nome do cookie:  rm_validador_token  (o que o /login define)
//   • Fallback:        validador_token / token (versões antigas)
//   • Fallback:        Authorization: Bearer <token>
//
//   • Formato do payload esperado:
//       typ === "validador_auth"   (o formato que /login gera hoje)
//       Compatível também com tipo === "validador" (formato legado)
//
//   • Também aceita adminmaster (perfil super-utilizador)
// ══════════════════════════════════════════════════════════════

import jwt from "jsonwebtoken";

function getSecret() {
  return String(process.env.JWT_SECRET || process.env.COLAB_JWT_SECRET || "").trim();
}

export default function authValidador(req, res, next) {
  // ── 1. Extrair token ─────────────────────────────────────
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7).trim()
    : null;

  const token =
    req.cookies?.rm_validador_token ||    // ← nome que o /login usa hoje
    req.cookies?.validador_token   ||    // ← legado (compatibilidade)
    req.cookies?.token             ||    // ← legado
    bearer;

  if (!token) {
    return res.status(401).json({
      ok:      false,
      code:    "AUTH_MISSING",
      message: "Sem sessão de validador.",
    });
  }

  // ── 2. Verificar assinatura e expiração ─────────────────
  const secret = getSecret();
  if (!secret) {
    console.error("[authValidador] JWT_SECRET não configurado!");
    return res.status(500).json({ ok: false, message: "Configuração inválida." });
  }

  let payload;
  try {
    payload = jwt.verify(token, secret);
  } catch (err) {
    return res.status(401).json({
      ok:      false,
      code:    "SESSION_INVALID",
      message: "Sessão inválida ou expirada. Faça login de novo.",
    });
  }

  // ── 3. Verificar tipo (aceita ambos os formatos históricos) ──
  const typ    = String(payload?.typ  || "").toLowerCase();
  const tipo   = String(payload?.tipo || "").toLowerCase();
  const ehValidador = 
    typ  === "validador_auth" || typ  === "validador" ||
    tipo === "validador"      || tipo === "adminmaster";

  if (!ehValidador) {
    return res.status(403).json({
      ok:      false,
      code:    "AUTH_WRONG_TYPE",
      message: "Sessão inválida (tipo errado).",
    });
  }

  // ── 4. Preencher req.validador ─────────────────────────
  // Nome do request field usado pelo validador.routes.js
  req.validador = {
    id:    String(payload.id || ""),
    email: payload.email || "",
    scope: String(payload.scope || "").toLowerCase() || "motoristas",
    typ:   typ || tipo || "validador",
  };
  // Também preenche req.user para compatibilidade retroactiva
  req.user = req.validador;

  next();
}