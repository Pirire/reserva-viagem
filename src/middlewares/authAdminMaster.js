// src/middlewares/authAdminMaster.js (ESM)
import jwt from "jsonwebtoken";

function getToken(req) {
  const h = String(req.headers.authorization || "");
  if (h.startsWith("Bearer ")) return h.slice(7).trim();

  // fallback cookies (se algum dia usares)
  if (req.cookies?.admin_bearer_token) return String(req.cookies.admin_bearer_token);
  if (req.cookies?.token) return String(req.cookies.token);
  return "";
}

export default function authAdminMaster(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) return res.status(401).json({ ok: false, message: "Não autenticado" });

    const secret = String(process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || "").trim();
    if (!secret) return res.status(500).json({ ok: false, message: "JWT secret não configurado" });

    const payload = jwt.verify(token, secret);

    // ✅ aceita vários formatos
    const tipo = String(payload?.tipo || "").toLowerCase();
    const typ = String(payload?.typ || "").toLowerCase();

    const isAdminMaster =
      payload?.isAdminMaster === true ||
      tipo === "adminmaster" ||
      typ === "admin_master" ||
      typ === "adminmaster" ||
      typ === "admin_master_auth";

    if (!isAdminMaster) {
      return res.status(403).json({ ok: false, message: "Sem permissão (AdminMaster)" });
    }

    req.admin = payload;
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, message: "Token inválido/expirado" });
  }
}