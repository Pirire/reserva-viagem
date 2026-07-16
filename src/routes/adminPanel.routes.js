// src/routes/adminPanel.routes.js
import { Router } from "express";
import KmConfig from "../models/KmConfig.js";
import PartnerLimits from "../models/PartnerLimits.js";

const router = Router();

// ✅ Admin Master only
function requireMaster(req, res) {
  if (!req?.admin?.isAdminMaster) {
    res.status(403).json({ ok: false, message: "Admin apenas." });
    return false;
  }
  return true;
}

function hasField(model, field) {
  return model?.schema?.paths?.[field] != null;
}

// =========================
// KMS: listar
// GET /api/admin/kms
// =========================
router.get("/admin/kms", async (req, res) => {
  try {
    if (!requireMaster(req, res)) return;

    const hasAtivo = hasField(KmConfig, "ativo");

    // se não existir nada, cria defaults
    const count = await KmConfig.countDocuments();
    if (!count) {
      const defaults = [
        { key: "economy", label: "ECONOMY", valorPorKm: 0 },
        { key: "comfort", label: "COMFORT", valorPorKm: 0 },
        { key: "executive", label: "EXECUTIVE", valorPorKm: 0 },
        { key: "van", label: "VAN", valorPorKm: 0 },
      ].map((d) => (hasAtivo ? { ...d, ativo: true } : d));

      await KmConfig.insertMany(defaults);
    } else if (hasAtivo) {
      // ✅ garante que os defaults aparecem mesmo que estejam ativo:false
      await KmConfig.updateMany(
        { key: { $in: ["economy", "comfort", "executive", "van"] } },
        { $set: { ativo: true } }
      );
    }

    // ✅ NÃO filtra por ativo (para nunca vir vazio)
    const items = await KmConfig.find({}).sort({ createdAt: 1 }).lean();
    return res.json({ ok: true, categorias: items });
  } catch (err) {
    console.error("❌ GET /admin/kms:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

// =========================
// KMS: atualizar valores
// PUT /api/admin/kms
// body: { updates: [{ key, valorPorKm }] }
// =========================
router.put("/admin/kms", async (req, res) => {
  try {
    if (!requireMaster(req, res)) return;

    const hasAtivo = hasField(KmConfig, "ativo");
    const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];

    for (const u of updates) {
      const key = String(u?.key || "").trim();
      const valor = Number(u?.valorPorKm);
      if (!key || !Number.isFinite(valor)) continue;

      await KmConfig.updateOne(
        { key },
        { $set: { valorPorKm: valor, ...(hasAtivo ? { ativo: true } : {}) } },
        { upsert: true }
      );
    }

    return res.json({ ok: true, message: "Valores atualizados." });
  } catch (err) {
    console.error("❌ PUT /admin/kms:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

// =========================
// PARCEIROS: listar limites
// GET /api/admin/parceiros
// =========================
router.get("/admin/parceiros", async (req, res) => {
  try {
    if (!requireMaster(req, res)) return;

    const items = await PartnerLimits.find({}).sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, parceiros: items });
  } catch (err) {
    console.error("❌ GET /admin/parceiros:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

// =========================
// PARCEIROS: atualizar limites
// PUT /api/admin/parceiros/:nif
// body: { semLimites, maxVeiculos, maxMotoristas }
// =========================
router.put("/admin/parceiros/:nif", async (req, res) => {
  try {
    if (!requireMaster(req, res)) return;

    const nif = String(req.params.nif || "").trim();
    if (!nif) return res.status(400).json({ ok: false, message: "nif obrigatório" });

    const semLimites = !!req.body?.semLimites;
    const maxVeiculos = Number(req.body?.maxVeiculos);
    const maxMotoristas = Number(req.body?.maxMotoristas);

    await PartnerLimits.updateOne(
      { nif },
      {
        $set: {
          semLimites,
          maxVeiculos: Number.isFinite(maxVeiculos) ? Math.max(0, maxVeiculos) : 0,
          maxMotoristas: Number.isFinite(maxMotoristas) ? Math.max(0, maxMotoristas) : 0,
        },
      },
      { upsert: true }
    );

    return res.json({ ok: true, message: "Parceiro atualizado." });
  } catch (err) {
    console.error("❌ PUT /admin/parceiros/:nif:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

export default router;