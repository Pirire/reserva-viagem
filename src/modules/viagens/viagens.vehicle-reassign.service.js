// src/modules/viagens/viagens.vehicle-reassign.service.js
// CONFLITO RESOLVIDO: raw MongoDB → ViagemRepository

import Veiculo   from "../../models/Veiculo.js";
import AuditLog  from "../../models/AuditLog.js";
import * as ViagemRepository from "../../repositories/viagem.repository.js";

export async function reatribuirVeiculo({ viagemId, veiculoId, motivo }) {
  if (!viagemId)  throw Object.assign(new Error("ID da viagem obrigatório."),  { statusCode: 400 });
  if (!veiculoId) throw Object.assign(new Error("ID do veículo obrigatório."), { statusCode: 400 });

  const novoVeiculo = await Veiculo.findById(veiculoId).lean();
  if (!novoVeiculo) throw Object.assign(new Error("Veículo não encontrado."), { statusCode: 404 });

  const viagem = await ViagemRepository.reatribuirVeiculo(viagemId, novoVeiculo, motivo);

  await AuditLog.create({
    action:         "REASSIGN_VEHICLE",
    actorAdminId:   "ADMIN",
    actorAdminName: "AdminMaster",
    targetType:     "Trip",
    targetModel:    "Trip",
    targetId:       viagem._id,
    details:        { motivo: String(motivo || ""), novoVeiculoId: String(novoVeiculo._id), matricula: novoVeiculo.matricula },
  }).catch(() => {});

  return viagem;
}
