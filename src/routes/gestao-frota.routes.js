// src/routes/gestao-frota.routes.js
// ══════════════════════════════════════════════════════════════
// NOVO FICHEIRO — rotas do gestor de frota para gerir a sua
// equipa de motoristas e veículos.
//
// Registar em app.js:
//   import gestaoFrotaRoutes from "./routes/gestao-frota.routes.js";
//   app.use("/api/frota", gestaoFrotaRoutes);
//
// Endpoints:
//   GET  /api/frota/motoristas          — listar os seus motoristas
//   GET  /api/frota/veiculos            — listar os seus veículos
//   POST /api/frota/atribuir            — ligar motorista ↔ veículo
//   POST /api/frota/remover-motorista   — desligar motorista do veículo
//   GET  /api/frota/reservas-ativas     — reservas activas da sua frota
//   POST /api/frota/substituir          — trocar par numa reserva activa
// ══════════════════════════════════════════════════════════════

import { Router } from "express";
import jwt         from "jsonwebtoken";
import Motorista   from "../models/Motorista.js";
import Veiculo     from "../models/Veiculo.js";
import Reserva     from "../models/Reserva.js";
import logger      from "../config/logger.js";
import {
  atribuirMotoristaAVeiculo,
  removerMotoristaDeVeiculo,
  substituirParEmReserva,
} from "../services/dispatch.service.js";

const router = Router();

/* ── Auth — gestor de frota (Colaborador tipo="frota") ─────── */
function requireGestor(req, res, next) {
  try {
    const secret = String(process.env.JWT_SECRET || "").trim();
    const token  =
      req.cookies?.rm_colaborador_token ||
      req.cookies?.colaborador_token    ||
      (req.headers.authorization || "").replace("Bearer ", "").trim();
    if (!token) return res.status(401).json({ ok: false, message: "Sessão de gestor necessária." });
    const p = jwt.verify(token, secret);
    if (!["frota","colaborador"].includes(String(p?.tipo || p?.typ || "")))
      return res.status(403).json({ ok: false, message: "Acesso reservado a gestores de frota." });
    req.gestorId    = p.id;
    req.gestorEmail = p.email;
    next();
  } catch {
    return res.status(401).json({ ok: false, message: "Token inválido ou expirado." });
  }
}

/* ════════════════════════════════════════════════════════════════
   GET /api/frota/motoristas
   Lista todos os motoristas do gestor autenticado.
════════════════════════════════════════════════════════════════ */
router.get("/motoristas", requireGestor, async (req, res) => {
  try {
    const motoristas = await Motorista.find({ gestorId: req.gestorId })
      .populate("veiculoId", "marca modelo matricula categoria disponivel")
      .select("nome email contacto aprovacao disponivel categorias veiculoId rating gestorId")
      .sort({ nome: 1 })
      .lean();
    return res.json({ ok: true, motoristas });
  } catch (err) {
    logger.error({ err }, "❌ GET /frota/motoristas");
    return res.status(500).json({ ok: false, message: "Erro ao listar motoristas." });
  }
});

/* ════════════════════════════════════════════════════════════════
   GET /api/frota/veiculos
   Lista todos os veículos do gestor autenticado.
════════════════════════════════════════════════════════════════ */
router.get("/veiculos", requireGestor, async (req, res) => {
  try {
    const veiculos = await Veiculo.find({ gestorId: req.gestorId })
      .populate("motoristaId", "nome email contacto disponivel aprovacao")
      .select("marca modelo matricula cor categoria capacidade disponivel aprovacao motoristaId gestorId")
      .sort({ marca: 1 })
      .lean();
    return res.json({ ok: true, veiculos });
  } catch (err) {
    logger.error({ err }, "❌ GET /frota/veiculos");
    return res.status(500).json({ ok: false, message: "Erro ao listar veículos." });
  }
});

/* ════════════════════════════════════════════════════════════════
   POST /api/frota/atribuir
   Liga um motorista a um veículo.
   Body: { motoristaId, veiculoId }
   Verifica que ambos pertencem ao gestor autenticado.
════════════════════════════════════════════════════════════════ */
router.post("/atribuir", requireGestor, async (req, res) => {
  try {
    const { motoristaId, veiculoId } = req.body || {};
    if (!motoristaId || !veiculoId)
      return res.status(400).json({ ok: false, message: "motoristaId e veiculoId obrigatórios." });

    // Garantir que o gestor é dono de ambos
    const [m, v] = await Promise.all([
      Motorista.findOne({ _id: motoristaId, gestorId: req.gestorId }),
      Veiculo.findOne(  { _id: veiculoId,   gestorId: req.gestorId }),
    ]);
    if (!m) return res.status(403).json({ ok: false, message: "Motorista não pertence a esta frota." });
    if (!v) return res.status(403).json({ ok: false, message: "Veículo não pertence a esta frota." });

    await atribuirMotoristaAVeiculo(veiculoId, motoristaId);

    logger.info({ gestorId: req.gestorId, motoristaId, veiculoId }, "✅ Atribuição feita pelo gestor");
    return res.json({ ok: true, message: `${m.nome} atribuído a ${v.marca} ${v.modelo} (${v.matricula}).` });
  } catch (err) {
    logger.error({ err }, "❌ POST /frota/atribuir");
    return res.status(err.status || 500).json({ ok: false, message: err.message || "Erro ao atribuir." });
  }
});

/* ════════════════════════════════════════════════════════════════
   POST /api/frota/remover-motorista
   Remove o motorista de um veículo (saída, substituição, etc.)
   Body: { veiculoId }
════════════════════════════════════════════════════════════════ */
router.post("/remover-motorista", requireGestor, async (req, res) => {
  try {
    const { veiculoId } = req.body || {};
    if (!veiculoId) return res.status(400).json({ ok: false, message: "veiculoId obrigatório." });

    const v = await Veiculo.findOne({ _id: veiculoId, gestorId: req.gestorId });
    if (!v) return res.status(403).json({ ok: false, message: "Veículo não pertence a esta frota." });

    await removerMotoristaDeVeiculo(veiculoId);

    return res.json({ ok: true, message: "Motorista removido do veículo. Ambos ficam indisponíveis até nova atribuição." });
  } catch (err) {
    logger.error({ err }, "❌ POST /frota/remover-motorista");
    return res.status(500).json({ ok: false, message: "Erro ao remover motorista." });
  }
});

/* ════════════════════════════════════════════════════════════════
   GET /api/frota/reservas-ativas
   Reservas activas (atribuida|em_viagem) da frota do gestor.
════════════════════════════════════════════════════════════════ */
router.get("/reservas-ativas", requireGestor, async (req, res) => {
  try {
    // Obter IDs dos motoristas da frota
    const motoristasIds = await Motorista.find({ gestorId: req.gestorId }).select("_id").lean();
    const ids = motoristasIds.map(m => m._id);

    const reservas = await Reserva.find({
      motoristaId: { $in: ids },
      status:      { $in: ["atribuida","em_viagem"] },
    })
      .populate("motoristaId", "nome disponivel")
      .populate("veiculoId",   "marca modelo matricula")
      .select("codigo categoria partida destino datahora status valor nome contacto motoristaId veiculoId")
      .sort({ datahora: 1 })
      .lean();

    return res.json({ ok: true, reservas });
  } catch (err) {
    logger.error({ err }, "❌ GET /frota/reservas-ativas");
    return res.status(500).json({ ok: false, message: "Erro ao listar reservas." });
  }
});

/* ════════════════════════════════════════════════════════════════
   POST /api/frota/substituir
   Troca o par (motorista + veículo) numa reserva activa.
   Permite substituir quando um motorista fica indisponível.
   Body: { reservaId, novoMotoristaId, novoVeiculoId }
════════════════════════════════════════════════════════════════ */
router.post("/substituir", requireGestor, async (req, res) => {
  try {
    const { reservaId, novoMotoristaId, novoVeiculoId } = req.body || {};
    if (!reservaId || !novoMotoristaId || !novoVeiculoId)
      return res.status(400).json({ ok: false, message: "reservaId, novoMotoristaId e novoVeiculoId obrigatórios." });

    // Verificar que ambos os novos pertencem a este gestor
    const [m, v] = await Promise.all([
      Motorista.findOne({ _id: novoMotoristaId, gestorId: req.gestorId }),
      Veiculo.findOne(  { _id: novoVeiculoId,   gestorId: req.gestorId }),
    ]);
    if (!m) return res.status(403).json({ ok: false, message: "Novo motorista não pertence a esta frota." });
    if (!v) return res.status(403).json({ ok: false, message: "Novo veículo não pertence a esta frota." });

    const io = req.app.get("io");
    await substituirParEmReserva(reservaId, novoMotoristaId, novoVeiculoId, io);

    return res.json({ ok: true, message: `Reserva reatribuída a ${m.nome} (${v.matricula}).` });
  } catch (err) {
    logger.error({ err }, "❌ POST /frota/substituir");
    return res.status(err.status || 500).json({ ok: false, message: err.message || "Erro ao substituir." });
  }
});

export default router;