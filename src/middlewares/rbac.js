// src/middleware/rbac.js

export function requireAdmin(req, res, next) {
  if (!req.admin) {
    return res.status(401).json({ ok: false, message: "Não autenticado (admin)" });
  }
  if (req.admin.ativo === false) {
    return res.status(403).json({ ok: false, message: "Admin inativo" });
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    const adminRoles = Array.isArray(req.admin?.roles) ? req.admin.roles : [];
    const allowed = roles.some((r) => adminRoles.includes(r));
    if (!allowed) {
      return res.status(403).json({ ok: false, message: "Sem permissão" });
    }
    next();
  };
}
