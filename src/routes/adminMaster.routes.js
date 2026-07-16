// src/routes/adminMaster.routes.js
import { Router } from "express";

import authAdminMaster from "../middlewares/authAdminMaster.js";
import KmConfig from "../models/KmConfig.js";
import PartnerLimits from "../models/PartnerLimits.js";

const router = Router();
console.log("✅ adminMaster.routes.js carregado");

const norm = (v) => String(v ?? "").trim();

/* =========================================================
   KMS CONFIG
   GET /api/admin/kms
   PUT /api/admin/kms
========================================================= */

// GET /api/admin/kms
router.get("/api/admin/kms", authAdminMaster, async (_req, res) => {
  try {
    const categorias = await KmConfig.find({}).sort({ key: 1 }).lean();
    return res.json({ ok: true, categorias });
  } catch (e) {
    console.error("❌ GET /api/admin/kms:", e);
    return res.status(500).json({
      ok: false,
      message: "Erro ao carregar configuração de kms.",
    });
  }
});

// PUT /api/admin/kms
router.put("/api/admin/kms", authAdminMaster, async (req, res) => {
  try {
    const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];

    if (!updates.length) {
      return res.status(400).json({
        ok: false,
        message: "updates vazio.",
      });
    }

    for (const u of updates) {
      const key = norm(u?.key);
      if (!key) continue;

      const valorPorKm = Number(u?.valorPorKm);
      const label = norm(u?.label);
      const ativo = typeof u?.ativo === "boolean" ? u.ativo : true;

      await KmConfig.updateOne(
        { key },
        {
          $set: {
            key,
            ...(label ? { label } : {}),
            valorPorKm: Number.isFinite(valorPorKm) ? valorPorKm : 0,
            ativo,
          },
        },
        { upsert: true }
      );
    }

    return res.json({
      ok: true,
      message: "KMs atualizados com sucesso.",
    });
  } catch (e) {
    console.error("❌ PUT /api/admin/kms:", e);
    return res.status(500).json({
      ok: false,
      message: "Erro ao atualizar kms.",
    });
  }
});

/* =========================================================
   PARCEIROS / LIMITES
   GET /api/admin/parceiros
   PUT /api/admin/parceiros/:nif
========================================================= */

// GET /api/admin/parceiros
router.get("/api/admin/parceiros", authAdminMaster, async (_req, res) => {
  try {
    const rows = await PartnerLimits.find({}).sort({ nome: 1, nif: 1 }).lean();

    const parceiros = rows.map((p) => ({
      nome: p?.nome || p?.parceiroNome || "-",
      nif: norm(p?.nif),
      email: p?.email || "-",
      contacto: p?.contacto || p?.contato || p?.telefone || "-",
      semLimites: !!p?.semLimites,
      maxVeiculos: Number(p?.maxVeiculos || 0),
      maxMotoristas: Number(p?.maxMotoristas || 0),
      ativo: p?.ativo !== false,
    }));

    return res.json({ ok: true, parceiros });
  } catch (e) {
    console.error("❌ GET /api/admin/parceiros:", e);
    return res.status(500).json({
      ok: false,
      message: "Erro ao carregar parceiros.",
    });
  }
});

// PUT /api/admin/parceiros/:nif
router.put("/api/admin/parceiros/:nif", authAdminMaster, async (req, res) => {
  try {
    const nif = norm(req.params.nif);
    if (!nif) {
      return res.status(400).json({
        ok: false,
        message: "NIF inválido.",
      });
    }

    const semLimites = !!req.body?.semLimites;
    const maxVeiculos = Number(req.body?.maxVeiculos);
    const maxMotoristas = Number(req.body?.maxMotoristas);

    await PartnerLimits.updateOne(
      { nif },
      {
        $set: {
          nif,
          ...(norm(req.body?.nome) ? { nome: norm(req.body?.nome) } : {}),
          ...(norm(req.body?.email) ? { email: norm(req.body?.email) } : {}),
          ...(norm(req.body?.contacto) ? { contacto: norm(req.body?.contacto) } : {}),
          semLimites,
          maxVeiculos: Number.isFinite(maxVeiculos) ? maxVeiculos : 0,
          maxMotoristas: Number.isFinite(maxMotoristas) ? maxMotoristas : 0,
        },
      },
      { upsert: true }
    );

    return res.json({
      ok: true,
      message: "Parceiro atualizado com sucesso.",
    });
  } catch (e) {
    console.error("❌ PUT /api/admin/parceiros/:nif:", e);
    return res.status(500).json({
      ok: false,
      message: "Erro ao atualizar parceiro.",
    });
  }
});

export default router;