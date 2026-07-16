// src/routes/admin.colaboradores.routes.js
import express from "express";
import Colaborador from "../models/colaboradores.js";

const router = express.Router();

// GET /admin/validacoes/colaboradores?status=pendente|aprovado|all
router.get("/validacoes/colaboradores", async (req, res) => {
  try {
    const status = String(req.query.status || "pendente").toLowerCase();

    const filter = {};
    if (status === "pendente") filter.aprovado = false;
    else if (status === "aprovado") filter.aprovado = true;
    else if (status === "all") {
      // sem filtro
    } else {
      return res.status(400).json({ ok: false, message: "status inválido" });
    }

    const colaboradores = await Colaborador.find(filter)
      .sort({ createdAt: -1 })
      .select("empresa nome email contacto tipo concelho cidade aprovado validacao createdAt updatedAt")
      .lean();

    return res.json({ ok: true, colaboradores });
  } catch (e) {
    console.error("❌ GET /admin/validacoes/colaboradores:", e);
    return res.status(500).json({ ok: false, message: "Erro ao listar colaboradores" });
  }
});

// GET /admin/validacoes/colaboradores/:id
router.get("/validacoes/colaboradores/:id", async (req, res) => {
  try {
    const colab = await Colaborador.findById(req.params.id).lean();
    if (!colab) return res.status(404).json({ ok: false, message: "Colaborador não encontrado" });
    return res.json({ ok: true, colaborador: colab });
  } catch (e) {
    console.error("❌ GET /admin/validacoes/colaboradores/:id:", e);
    return res.status(500).json({ ok: false, message: "Erro ao carregar colaborador" });
  }
});

// POST /admin/validacoes/colaboradores/:id  { status: "aprovado"|"rejeitado", observacoes }
router.post("/validacoes/colaboradores/:id", async (req, res) => {
  try {
    const { status, observacoes } = req.body || {};
    const st = String(status || "").toLowerCase();

    if (!["aprovado", "rejeitado"].includes(st)) {
      return res.status(400).json({ ok: false, message: "status inválido" });
    }

    const aprovado = st === "aprovado";

    const update = {
      aprovado,
      "validacao.status": st,
      "validacao.observacoes": String(observacoes || ""),
      "validacao.validadoEm": new Date(),
      "validacao.validadoPorId": req.admin?.id || null,
      "validacao.validadoPorNome": req.admin?.user || "AdminMaster",
    };

    const colab = await Colaborador.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!colab) return res.status(404).json({ ok: false, message: "Colaborador não encontrado" });

    return res.json({ ok: true, colaborador: colab });
  } catch (e) {
    console.error("❌ POST /admin/validacoes/colaboradores/:id:", e);
    return res.status(500).json({ ok: false, message: "Erro ao validar colaborador" });
  }
});

export default router;
