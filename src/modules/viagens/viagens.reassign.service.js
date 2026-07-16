// src/modules/viagens/viagens.reassign.service.js
// CONFLITO RESOLVIDO: raw MongoDB → ViagemRepository

import Motorista from "../../models/Motorista.js";
import AuditLog  from "../../models/AuditLog.js";
import * as ViagemRepository from "../../repositories/viagem.repository.js";

export async function reatribuirMotorista({ viagemId, motoristaId, motivo }) {
  if (!viagemId)    throw Object.assign(new Error("ID da viagem obrigatório."),   { statusCode: 400 });
  if (!motoristaId) throw Object.assign(new Error("ID do motorista obrigatório."), { statusCode: 400 });

  const novoMotorista = await Motorista.findById(motoristaId).lean();
  if (!novoMotorista) throw Object.assign(new Error("Motorista não encontrado."), { statusCode: 404 });

  const viagem = await ViagemRepository.reatribuirMotorista(viagemId, novoMotorista, motivo);

  await AuditLog.create({
    action:         "REASSIGN_DRIVER",
    actorAdminId:   "ADMIN",
    actorAdminName: "AdminMaster",
    targetType:     "Trip",
    targetModel:    "Trip",
    targetId:       viagem._id,
    details:        { motivo: String(motivo || ""), novoMotoristaId: String(novoMotorista._id), novoMotorista: novoMotorista.nome },
  }).catch(() => {});

  return viagem;
}
