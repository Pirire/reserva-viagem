// src/routes/motoristaVeiculos.routes.js
// ═════════════════════════════════════════════════════════════════════
// Rotas dedicadas ao MOTORISTA para gestão de veículos da frota.
//
// Fluxo profissional:
//   1. Motorista faz login
//   2. Chama GET /api/motorista/frota-disponivel para ver os veículos
//      aprovados do seu gestor
//   3. Escolhe um LIVRE via POST /api/motorista/veiculo/selecionar/:id
//      → fica associado a esse veículo (motoristaId preenchido)
//   4. Quando faz logout ou clica "libertar", chama
//      POST /api/motorista/veiculo/libertar → veículo volta a livre
//
// Estados possíveis por veículo (na resposta):
//   - "livre"   → ninguém está online, pode escolher
//   - "em_uso"  → outro motorista já está associado
//   - "meu"     → o próprio motorista já está a usá-lo
//
// Segurança:
//   - authMotorista protege todas as rotas
//   - gestorId FORÇADO no backend (motorista nunca vê frotas de outros)
//   - Selecionar veículo usa updateOne condicional (protecção anti race)
// ═════════════════════════════════════════════════════════════════════

import express from "express";
import mongoose from "mongoose";
import Veiculo from "../models/Veiculo.js";
import Motorista from "../models/Motorista.js";
import { authMotorista } from "../middlewares/authMotorista.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────
// Helper: obtém gestorId do motorista autenticado.
// O authMotorista só coloca { id, email, nome } em req.motorista,
// portanto temos de ir buscar o gestorId à BD (uma vez por request).
// ─────────────────────────────────────────────────────────────────────
async function getGestorIdDoMotorista(motoristaId) {
  const m = await Motorista.findById(motoristaId).select("gestorId gestor").lean();
  if (!m) return null;
  return String(m.gestorId || m.gestor?.id || "");
}

/* =========================================================
   GET /api/motorista/frota-disponivel
   Devolve todos os veículos aprovados do gestor deste motorista,
   com o estado real ("livre" | "em_uso" | "meu").
========================================================= */
router.get("/frota-disponivel", authMotorista, async (req, res) => {
  try {
    const motoristaId = req.motorista.id;
    const gestorId = await getGestorIdDoMotorista(motoristaId);

    if (!gestorId) {
      return res.status(400).json({
        ok: false,
        message: "Motorista sem gestor associado. Contacte o suporte.",
      });
    }

    // Buscar veículos aprovados do mesmo gestor.
    // gestorId pode estar guardado como string OU ObjectId — cobrimos ambos.
    const filtro = mongoose.Types.ObjectId.isValid(gestorId)
      ? {
          aprovacao: "aprovado",
          $or: [
            { gestorId: gestorId },
            { gestorId: new mongoose.Types.ObjectId(gestorId) },
          ],
        }
      : { aprovacao: "aprovado", gestorId };

    const veiculos = await Veiculo.find(filtro)
      .sort({ marca: 1, modelo: 1 })
      .select("marca modelo matricula motoristaId disponivel")
      .lean();

    // Mapear cada veículo para o formato simples pedido:
    //   { id, marca, modelo, matricula, estado }
    const meuIdStr = String(motoristaId);
    const items = veiculos.map(v => {
      const motAssociado = v.motoristaId ? String(v.motoristaId) : "";
      let estado = "livre";
      if (motAssociado === meuIdStr) estado = "meu";
      else if (motAssociado) estado = "em_uso";
      return {
        id:        String(v._id),
        marca:     v.marca     || "",
        modelo:    v.modelo    || "",
        matricula: v.matricula || "",
        estado,
      };
    });

    return res.json({
      ok: true,
      items,
      totals: {
        livres:  items.filter(i => i.estado === "livre").length,
        em_uso:  items.filter(i => i.estado === "em_uso").length,
        meu:     items.filter(i => i.estado === "meu").length,
        total:   items.length,
      },
    });
  } catch (err) {
    console.error("❌ GET /frota-disponivel:", err);
    return res.status(500).json({ ok: false, message: "Erro ao listar frota." });
  }
});

/* =========================================================
   POST /api/motorista/veiculo/selecionar/:id
   Motorista escolhe um veículo LIVRE da frota do seu gestor.
   Protecção contra race: updateOne condicional (só actualiza
   se motoristaId === null).
========================================================= */
router.post("/veiculo/selecionar/:id", authMotorista, async (req, res) => {
  try {
    const motoristaId = req.motorista.id;
    const veiculoId   = String(req.params.id || "").trim();

    if (!mongoose.Types.ObjectId.isValid(veiculoId)) {
      return res.status(400).json({ ok: false, message: "ID de veículo inválido." });
    }

    const gestorId = await getGestorIdDoMotorista(motoristaId);
    if (!gestorId) {
      return res.status(400).json({
        ok: false,
        message: "Motorista sem gestor associado.",
      });
    }

    // 1. Verificar que este veículo pertence ao gestor do motorista
    const veiculo = await Veiculo.findById(veiculoId).lean();
    if (!veiculo) {
      return res.status(404).json({ ok: false, message: "Veículo não encontrado." });
    }
    if (veiculo.aprovacao !== "aprovado") {
      return res.status(400).json({ ok: false, message: "Este veículo ainda não foi aprovado." });
    }
    const veiculoGestorStr = String(veiculo.gestorId || "");
    if (veiculoGestorStr !== String(gestorId)) {
      return res.status(403).json({
        ok: false,
        message: "Este veículo não pertence ao seu gestor.",
      });
    }

    const meuIdStr = String(motoristaId);
    const motAssociadoStr = veiculo.motoristaId ? String(veiculo.motoristaId) : "";

    // Se já estava associado a mim mesmo → confirmar
    if (motAssociadoStr === meuIdStr) {
      return res.json({
        ok: true,
        message: "Já está a utilizar este veículo.",
        veiculo: {
          id:        String(veiculo._id),
          marca:     veiculo.marca,
          modelo:    veiculo.modelo,
          matricula: veiculo.matricula,
        },
      });
    }

    // Se está com outro → recusar
    if (motAssociadoStr && motAssociadoStr !== meuIdStr) {
      return res.status(409).json({
        ok: false,
        message: "Este veículo está a ser utilizado por outro motorista.",
      });
    }

    // 2. Libertar qualquer outro veículo que EU já esteja a usar
    //    (motorista só pode estar online com um veículo de cada vez)
    await Veiculo.updateMany(
      { motoristaId: new mongoose.Types.ObjectId(meuIdStr) },
      { $set: { motoristaId: null, disponivel: true } }
    );

    // 3. Selecionar este veículo — condicional (protecção anti race).
    //    Só faz update se motoristaId AINDA for null neste instante.
    //    disponivel:true = "pronto para receber despacho" (definição
    //    oficial do campo em Veiculo.js). Passa a false só quando uma
    //    viagem estiver EM CURSO (ver TODO no início do fluxo de
    //    início de viagem) — nunca aqui, no momento da seleção.
    const resultado = await Veiculo.updateOne(
      { _id: veiculo._id, motoristaId: null, aprovacao: "aprovado" },
      { $set: {
          motoristaId: new mongoose.Types.ObjectId(meuIdStr),
          disponivel:  true,
      }}
    );

    if (resultado.modifiedCount === 0) {
      // Alguém ficou com o veículo entre a nossa verificação e o update
      return res.status(409).json({
        ok: false,
        message: "Este veículo acabou de ser reservado por outro motorista.",
      });
    }

    console.log(`✅ Motorista ${motoristaId} selecionou veículo ${veiculo.matricula} (${veiculoId})`);

    // Memoriza este veículo como "último usado" — usado pelo frontend
    // para o atalho "USAR ESTE VEÍCULO" no modal de seleção. Falha aqui
    // nunca deve impedir a seleção em si (não é crítico), por isso
    // apanhamos o erro isoladamente.
    try {
      await Motorista.updateOne(
        { _id: meuIdStr },
        { $set: {
            ultimoVeiculo: {
              id:           veiculo._id,
              marca:        veiculo.marca     || "",
              modelo:       veiculo.modelo    || "",
              matricula:    veiculo.matricula || "",
              atualizadoEm: new Date(),
            },
        }}
      );
    } catch (err) {
      console.error("⚠️  Falha ao gravar ultimoVeiculo (não crítico):", err);
    }

    return res.json({
      ok: true,
      message: "Veículo selecionado com sucesso.",
      veiculo: {
        id:        String(veiculo._id),
        marca:     veiculo.marca,
        modelo:    veiculo.modelo,
        matricula: veiculo.matricula,
      },
    });
  } catch (err) {
    console.error("❌ POST /veiculo/selecionar:", err);
    return res.status(500).json({ ok: false, message: "Erro ao selecionar veículo." });
  }
});

/* =========================================================
   POST /api/motorista/veiculo/libertar
   Motorista sai do veículo (fica offline).
========================================================= */
router.post("/veiculo/libertar", authMotorista, async (req, res) => {
  try {
    const motoristaId = req.motorista.id;

    const resultado = await Veiculo.updateMany(
      { motoristaId: new mongoose.Types.ObjectId(motoristaId) },
      { $set: { motoristaId: null, disponivel: true } }
    );

    console.log(`↩️ Motorista ${motoristaId} libertou ${resultado.modifiedCount} veículo(s)`);

    return res.json({
      ok: true,
      message: "Veículo libertado.",
      libertados: resultado.modifiedCount,
    });
  } catch (err) {
    console.error("❌ POST /veiculo/libertar:", err);
    return res.status(500).json({ ok: false, message: "Erro ao libertar veículo." });
  }
});

/* =========================================================
   GET /api/motorista/veiculo/atual
   Devolve o veículo que o motorista está a usar agora (ou null).
========================================================= */
router.get("/veiculo/atual", authMotorista, async (req, res) => {
  try {
    const motoristaId = req.motorista.id;

    const v = await Veiculo.findOne({
      motoristaId: new mongoose.Types.ObjectId(motoristaId),
    })
      .select("marca modelo matricula")
      .lean();

    if (!v) {
      return res.json({ ok: true, veiculo: null });
    }

    return res.json({
      ok: true,
      veiculo: {
        id:        String(v._id),
        marca:     v.marca     || "",
        modelo:    v.modelo    || "",
        matricula: v.matricula || "",
      },
    });
  } catch (err) {
    console.error("❌ GET /veiculo/atual:", err);
    return res.status(500).json({ ok: false, message: "Erro ao obter veículo atual." });
  }
});

/* =========================================================
   GET /api/motorista/veiculo/ultimo
   Devolve o último veículo que este motorista usou com sucesso
   (gravado automaticamente em /veiculo/selecionar/:id), ou null
   se nunca escolheu nenhum. Não valida se ainda está livre —
   essa verificação é feita pelo frontend contra /frota-disponivel.
========================================================= */
router.get("/veiculo/ultimo", authMotorista, async (req, res) => {
  try {
    const motoristaId = req.motorista.id;
    const m = await Motorista.findById(motoristaId).select("ultimoVeiculo").lean();
    const uv = m?.ultimoVeiculo;

    if (!uv || !uv.id) {
      return res.json({ ok: true, veiculo: null });
    }

    return res.json({
      ok: true,
      veiculo: {
        id:        String(uv.id),
        marca:     uv.marca     || "",
        modelo:    uv.modelo    || "",
        matricula: uv.matricula || "",
      },
    });
  } catch (err) {
    console.error("❌ GET /veiculo/ultimo:", err);
    return res.status(500).json({ ok: false, message: "Erro ao obter último veículo." });
  }
});

export default router;