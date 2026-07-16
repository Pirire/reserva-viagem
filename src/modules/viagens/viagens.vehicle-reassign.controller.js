import asyncHandler from "../../utils/asyncHandler.js";
import { reatribuirVeiculo } from "./viagens.vehicle-reassign.service.js";

export const reassignVehicle = asyncHandler(async (req, res) => {
  const viagemId = req.params.id;
  const veiculoId = req.body?.veiculoId || req.body?.novoVeiculoId;
  const motivo = req.body?.motivo || "";

  const viagem = await reatribuirVeiculo({
    viagemId,
    veiculoId,
    motivo,
  });

  return res.status(200).json({
    success: true,
    message: "Veículo reatribuído com sucesso.",
    viagem,
  });
});