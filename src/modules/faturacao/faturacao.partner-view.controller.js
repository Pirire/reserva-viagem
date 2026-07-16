import asyncHandler from "../../utils/asyncHandler.js";
import { obterFaturaParaParceiro } from "./faturacao.partner-view.service.js";

export const obterFaturaParceiroController = asyncHandler(async (req, res) => {
  const invoiceId = req.params.id;

  const fatura = await obterFaturaParaParceiro(invoiceId);

  return res.status(200).json({
    success: true,
    message: "Fatura do parceiro carregada com sucesso.",
    fatura,
  });
});