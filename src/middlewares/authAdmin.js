// src/middlewares/authAdmin.js
// ══════════════════════════════════════════════════════════════
// Autenticação híbrida de admin — Web + App
// ══════════════════════════════════════════════════════════════

import jwt from "jsonwebtoken";
import { extractToken } from "../utils/authUtils.js";

function getAdminSecret() {
  return String(process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || "").trim();
}

export default function authAdmin(req, res, next) {
  try {
    const token = extractToken(req, 'admin_token', ['admin_bearer_token']);

    if (!token) {
      return res.status(401).json({ ok: false, code: "TOKEN_MISSING", message: "Sem autenticação admin." });
    }

    const secret = getAdminSecret();
    if (!secret) {
      return res.status(500).json({ ok: false, message: "ADMIN_JWT_SECRET não definido." });
    }

    const decoded = jwt.verify(token, secret);

    const tipo = String(decoded?.tipo || "").toLowerCase();
    const typ  = String(decoded?.typ  || "").toLowerCase();
    const role = String(decoded?.role || "").toLowerCase();

    const isAdmin =
      tipo === "admin" || tipo === "adminmaster" ||
      typ  === "admin" || typ  === "admin_master" ||
      role === "admin" || role === "adminmaster"  ||
      decoded?.isAdminMaster === true;

    if (!isAdmin) {
      return res.status(403).json({ ok: false, code: "FORBIDDEN", message: "Sem permissão de admin." });
    }

    const id = decoded?.id || decoded?._id || null;
    const isAdminMaster =
      decoded?.isAdminMaster === true ||
      tipo === "adminmaster" ||
      typ  === "admin_master" ||
      role === "adminmaster";

    req.admin = {
      id, _id: id,
      user:  decoded?.user || "",
      nome:  decoded?.nome || decoded?.user || "Admin",
      tipo:  isAdminMaster ? "adminmaster" : (decoded?.tipo || "admin"),
      typ:   isAdminMaster ? "admin_master" : (decoded?.typ || "admin"),
      isAdminMaster,
      raw:   decoded,
    };
    req.isAdmin = true;
    return next();

  } catch (e) {
    const isExpired = e?.name === "TokenExpiredError";
    return res.status(401).json({
      ok: false,
      code: isExpired ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
      message: "Sessão admin inválida ou expirada.",
    });
  }
}