// src/middlewares/authPartnerApi.js
// ══════════════════════════════════════════════════════════════
// Middleware de autenticação para empresas parceiras externas.
//
// Lê a API Key do header X-Api-Key (ou Authorization: Bearer ...).
// Valida contra o hash guardado na BD.
// Injeta req.partner com os dados da empresa.
//
// Uso nas rotas:
//   import authPartnerApi from "../middlewares/authPartnerApi.js";
//   router.post("/submissions/driver", authPartnerApi, upload.fields([...]), handler);
// ══════════════════════════════════════════════════════════════

import crypto       from "crypto";
import PartnerApiKey from "../models/PartnerApiKey.js";

export async function authPartnerApi(req, res, next) {
  try {
    // ── 1. Extrair a chave ──────────────────────────────────────
    const raw =
      req.headers["x-api-key"] ||
      req.headers["x-apikey"] ||
      (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "").trim();

    if (!raw) {
      return res.status(401).json({
        ok:      false,
        code:    "API_KEY_MISSING",
        message: 'API Key em falta. Envie no header "X-Api-Key: <chave>".',
      });
    }

    // ── 2. Calcular hash e procurar na BD ──────────────────────
    const keyHash = crypto.createHash("sha256").update(raw).digest("hex");
    const partner = await PartnerApiKey.findOne({ keyHash, ativo: true }).lean();

    if (!partner) {
      return res.status(401).json({
        ok:      false,
        code:    "API_KEY_INVALID",
        message: "API Key inválida ou revogada. Contacte o administrador REALMETROPOLIS.",
      });
    }

    // ── 3. Verificar permissão para a rota actual ───────────────
    const routePermMap = {
      "/submissions/driver":  "submit:driver",
      "/submissions/vehicle": "submit:vehicle",
    };

    // extrair a parte relevante do path (depois do prefixo da rota base)
    const routePath = req.path || req.url || "";
    const required  = Object.entries(routePermMap).find(([k]) => routePath.includes(k))?.[1];

    if (required && !partner.permissoes.includes(required)) {
      return res.status(403).json({
        ok:      false,
        code:    "API_KEY_PERMISSION",
        message: `Esta API Key não tem permissão "${required}". Contacte o administrador.`,
      });
    }

    // ── 4. Actualizar auditoria (sem bloquear o pedido) ────────
    PartnerApiKey.updateOne(
      { _id: partner._id },
      { $set: { lastUsedAt: new Date() }, $inc: { totalUsos: 1 } }
    ).catch(() => {});

    // ── 5. Injectar dados do parceiro no request ───────────────
    req.partner = {
      id:         String(partner._id),
      empresa:    partner.empresa,
      email:      partner.email,
      ambiente:   partner.ambiente,
      permissoes: partner.permissoes,
      webhookUrl: partner.webhookUrl || null,
    };

    next();
  } catch (err) {
    console.error("❌ authPartnerApi:", err);
    return res.status(500).json({ ok: false, message: "Erro de autenticação." });
  }
}

export default authPartnerApi;