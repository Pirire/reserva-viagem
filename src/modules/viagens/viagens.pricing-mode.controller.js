import asyncHandler from "../../utils/asyncHandler.js";
import { definirPricingModeDaViagem } from "./viagens.pricing-mode.service.js";

export const definirPricingModeController = asyncHandler(async (req, res) => {
  const viagemId = req.params.id;
  const pricingMode = req.body?.pricingMode;

  const viagem = await definirPricingModeDaViagem(viagemId, pricingMode);

  return res.status(200).json({
    success: true,
    message: "Modo de pricing da viagem atualizado com sucesso.",
    viagem,
  });
});
