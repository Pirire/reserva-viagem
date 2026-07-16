import asyncHandler from "../../utils/asyncHandler.js";
import { gerarFaturaAutomatica } from "./faturacao.auto.service.js";

export const gerarFaturaAutomaticaController = asyncHandler(async (req, res) => {
  const viagemId = req.params.id;

  const resultado = await gerarFaturaAutomatica(viagemId);

  return res.status(201).json({
    success: true,
    message: "Fatura automática gerada com sucesso.",
    ...resultado,
  });
});