import asyncHandler from "../../utils/asyncHandler.js";
import { atualizarLocalizacaoMotorista } from "./motoristas.location.service.js";

export const atualizarLocalizacao = asyncHandler(async (req, res) => {
  const motoristaId = req.params.id;

  const resultado = await atualizarLocalizacaoMotorista(motoristaId, req.body);

  return res.status(200).json({
    success: true,
    message: "Localização do motorista atualizada com sucesso.",
    motorista: resultado,
  });
});