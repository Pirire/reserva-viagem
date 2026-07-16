// src/utils/clienteAuth.js
// ══════════════════════════════════════════════════════════════
// Autenticação de sessão de cliente/hotel — extraída de
// reservas.routes.js, onde vivia sozinha e duplicada nesse
// ficheiro. Qualquer rota noutro ficheiro (partilha.routes.js,
// tracking.routes.js, ...) que precise de saber "que hotel/cliente
// está autenticado?" deve importar daqui, nunca reescrever esta
// lógica outra vez local a esse ficheiro — é exactamente esse tipo
// de duplicação que causou vários dos bugs encontrados hoje
// (sistemas paralelos a resolver o mesmo problema, ligeiramente
// diferentes, e a desalinhar com o tempo).
// ══════════════════════════════════════════════════════════════
import jwt from "jsonwebtoken";

/**
 * Lê e valida o token de sessão do cliente/hotel, a partir do
 * cookie ou do cabeçalho Authorization. Devolve o payload
 * descodificado, ou null se não houver sessão válida.
 */
export function getClientePayload(req) {
  try {
    const secret = String(process.env.JWT_SECRET || process.env.CLIENT_JWT_SECRET || "").trim();
    if (!secret) return null;
    const cookieToken =
      req.cookies?.rm_cliente_token ||
      req.cookies?.cliente_token    ||
      req.cookies?.token            || "";
    const auth        = String(req.headers.authorization || "");
    const bearerToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const token = cookieToken || bearerToken;
    if (!token) return null;
    const payload = jwt.verify(token, secret);
    const typ = String(payload?.typ || "").toLowerCase();
    if (typ && typ !== "cliente") return null;
    return payload;
  } catch (_) {
    return null;
  }
}

/**
 * Middleware — injeta req.clienteId/req.clienteEmail SE houver
 * sessão, mas nunca bloqueia o pedido (rota continua mesmo sem
 * sessão, com clienteId a null). Para rotas que servem tanto
 * visitantes anónimos como clientes com conta.
 */
export function injetarCliente(req, _res, next) {
  const p = getClientePayload(req);
  req.clienteId    = p?.id    || null;
  req.clienteEmail = p?.email || null;
  next();
}

/**
 * Middleware — exige sessão válida, ou devolve 401. Para rotas só
 * acessíveis a hotéis/clientes autenticados.
 */
export function requireCliente(req, res, next) {
  const p = getClientePayload(req);
  if (!p?.id) return res.status(401).json({ ok: false, code: "UNAUTHORIZED", message: "Sessão necessária." });
  req.clienteId    = p.id;
  req.clienteEmail = p.email || null;
  next();
}
