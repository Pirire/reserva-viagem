// src/modules/viagens/viagens.service.js
// ══════════════════════════════════════════════════════════════
// VERSÃO DEFINITIVA — usa ViagemRepository em vez de raw MongoDB.
//
// CONFLITO RESOLVIDO:
//   Era: mongoose.connection.db.collection("viagens").findOne(...)
//   Agora: ViagemRepository.findById(id) — com schema + hooks
// ══════════════════════════════════════════════════════════════

import Motorista from "../../models/Motorista.js";
import AuditLog  from "../../models/AuditLog.js";
import * as ViagemRepository from "../../repositories/viagem.repository.js";

/* ── Listar ──────────────────────────────────────────────────── */
export async function listarViagens() {
  return ViagemRepository.findMany({}, { limit: 100, sort: { when: -1 } });
}

/* ── Atribuir motorista manualmente ──────────────────────────── */
export async function atribuirViagem({ viagemId, motoristaId }) {
  if (!viagemId)    throw Object.assign(new Error("ID da viagem obrigatório."),   { statusCode: 400 });
  if (!motoristaId) throw Object.assign(new Error("ID do motorista obrigatório."), { statusCode: 400 });

  const motorista = await Motorista.findById(motoristaId).lean();
  if (!motorista) throw Object.assign(new Error("Motorista não encontrado."), { statusCode: 404 });

  const viagem = await ViagemRepository.atribuirMotorista(viagemId, {
    id:   motorista._id,
    nome: motorista.nome || "",
  });

  await AuditLog.create({
    action:         "ASSIGN_TRIP",
    actorAdminId:   "ADMIN",
    actorAdminName: "AdminMaster",
    targetType:     "Trip",
    targetModel:    "Trip",
    targetId:       viagem._id,
    details:        { motoristaId: String(motorista._id), motoristaNome: motorista.nome },
  }).catch(() => {});

  return viagem;
}

/* ── Marcar pago ─────────────────────────────────────────────── */
export async function marcarPago(viagemId) {
  if (!viagemId) throw Object.assign(new Error("ID da viagem obrigatório."), { statusCode: 400 });
  return ViagemRepository.marcarPago(viagemId);
}

/* ── Auto-atribuição por proximidade ─────────────────────────── */
export async function autoAtribuirViagem(viagemId) {
  if (!viagemId) throw Object.assign(new Error("ID da viagem obrigatório."), { statusCode: 400 });

  const viagem = await ViagemRepository.findById(viagemId);
  if (!viagem) throw Object.assign(new Error("Viagem não encontrada."), { statusCode: 404 });

  const origemLat = viagem?.origemGeo?.lat ?? viagem?.lat;
  const origemLng = viagem?.origemGeo?.lng ?? viagem?.lng;

  if (origemLat == null || origemLng == null) {
    return { ok: false, code: "SEM_COORDENADAS", message: "Viagem sem coordenadas de origem." };
  }

  const motoristas = await Motorista.find({ ativo: true, disponivel: true }).lean();
  if (!motoristas.length) {
    return { ok: false, code: "SEM_MOTORISTA", message: "Nenhum motorista disponível." };
  }

  function distKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = v => (v * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  const candidatos = motoristas
    .filter(m => m.location?.lat != null && m.location?.lng != null)
    .map(m => ({ motorista: m, dist: distKm(Number(origemLat), Number(origemLng), Number(m.location.lat), Number(m.location.lng)) }))
    .sort((a, b) => a.dist - b.dist);

  if (!candidatos.length) {
    return { ok: false, code: "SEM_MOTORISTA", message: "Nenhum motorista com localização válida." };
  }

  const { motorista, dist } = candidatos[0];

  const viagemActualizada = await ViagemRepository.atribuirMotorista(viagemId, {
    id:            motorista._id,
    nome:          motorista.nome || "",
    modoAtribuicao: "AUTO",
  });

  await AuditLog.create({
    action:         "AUTO_ASSIGN_TRIP",
    actorAdminId:   "SISTEMA",
    actorAdminName: "Sistema",
    targetType:     "Trip",
    targetModel:    "Trip",
    targetId:       viagemActualizada._id,
    details:        { motoristaId: String(motorista._id), motoristaNome: motorista.nome, distanciaKm: dist },
  }).catch(() => {});

  return { ok: true, viagem: viagemActualizada, motorista: { id: motorista._id, nome: motorista.nome }, distanciaKm: dist };
}
