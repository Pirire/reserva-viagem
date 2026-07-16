import asyncHandler from "../../utils/asyncHandler.js";
import { reatribuirMotorista } from "./viagens.reassign.service.js";

export const reassignDriver = asyncHandler(async (req, res) => {
  const viagemId = req.params.id;
  const motoristaId = req.body?.motoristaId || req.body?.novoMotoristaId;
  const motivo = req.body?.motivo || "";

  const viagem = await reatribuirMotorista({
    viagemId,
    motoristaId,
    motivo,
  });

  return res.status(200).json({
    success: true,
    message: "Motorista reatribuído com sucesso.",
    viagem,
  });
});