import asyncHandler from "../../utils/asyncHandler.js";
import { verificarOfertaUltimoMotorista } from "./dispatch.repeat-driver.service.js";

export const verificarOfertaUltimoMotoristaController = asyncHandler(async (req, res) => {
  const clienteId = req.params.clienteId;

  const origemAtual = {
    lat: req.query.lat ?? req.body?.lat,
    lng: req.query.lng ?? req.body?.lng,
  };

  const resultado = await verificarOfertaUltimoMotorista(clienteId, origemAtual);

  return res.status(200).json({
    success: true,
    message: "Verificação do último motorista concluída com sucesso.",
    ...resultado,
  });
});