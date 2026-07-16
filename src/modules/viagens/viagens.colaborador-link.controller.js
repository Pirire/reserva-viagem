import asyncHandler from "../../utils/asyncHandler.js";
import { associarColaboradorNaViagem } from "./viagens.colaborador-link.service.js";

export const associarColaboradorController = asyncHandler(async (req, res) => {
  const viagemId = req.params.id;

  const viagem = await associarColaboradorNaViagem({
    viagemId,
    colaboradorId: req.body?.colaboradorId,
    partnerType: req.body?.partnerType,
    partnerName: req.body?.partnerName,
    payerType: req.body?.payerType,
  });

  return res.status(200).json({
    success: true,
    message: "Colaborador associado à viagem com sucesso.",
    viagem,
  });
});
