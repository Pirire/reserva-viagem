// src/utils/authUtils.js
// ══════════════════════════════════════════════════════════════
// Utilitários de autenticação híbrida — Web + App
//
// ESTRATÉGIA:
//   Web  → token em cookie httpOnly (automático pelo browser)
//   App  → token no body da resposta (guardado em SecureStorage)
//          enviado via: Authorization: Bearer <token>
//
// Detecção automática do cliente:
//   Header "X-Client: app" → cliente móvel (React Native / Flutter)
//   Sem header             → cliente web (browser)
// ══════════════════════════════════════════════════════════════

/**
 * Detecta se o pedido vem de uma app móvel.
 * A app deve enviar o header: X-Client: app
 */
export function isAppClient(req) {
  return String(req.headers?.['x-client'] || '').toLowerCase() === 'app';
}

/**
 * Define cookie httpOnly com as opções correctas.
 * sameSite: "lax" em vez de "strict" para compatibilidade híbrida.
 */
export function setCookieToken(res, name, token, maxAgeDays = 7) {
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  res.cookie(name, token, {
    httpOnly: true,
    secure:   isProd,
    sameSite: 'lax',           // lax em vez de strict — necessário para híbrido
    maxAge:   maxAgeDays * 24 * 60 * 60 * 1000,
    path:     '/',
  });
}

/**
 * Limpa um cookie de autenticação.
 */
export function clearCookieToken(res, name) {
  res.clearCookie(name, { httpOnly: true, sameSite: 'lax', path: '/' });
}

/**
 * Extrai token de:
 *   1. Cookie httpOnly (nome fornecido)     → web
 *   2. Authorization: Bearer <token>        → app + web
 *   3. Cookies alternativos (fallback)      → compatibilidade
 */
export function extractToken(req, cookieName, altCookies = []) {
  // 1. Cookie principal
  const cookieToken = req.cookies?.[cookieName] || '';
  if (cookieToken) return cookieToken.trim();

  // 2. Bearer header — preferido por apps móveis
  const auth = String(req.headers?.authorization || '');
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();

  // 3. Cookies alternativos (fallback legacy)
  for (const name of altCookies) {
    const t = req.cookies?.[name];
    if (t) return String(t).trim();
  }

  return null;
}