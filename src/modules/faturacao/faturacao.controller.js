import asyncHandler from "../../utils/asyncHandler.js";
import {
  criarFaturaDaViagem,
  listarFaturas,
  marcarFaturaComoPaga,
} from "./faturacao.service.js";

export const criarFaturaController = asyncHandler(async (req, res) => {
  const resultado = await criarFaturaDaViagem(req.body || {});

  return res.status(resultado.created ? 201 : 200).json({
    success: true,
    created: resultado.created,
    message: resultado.created
      ? "Fatura criada com sucesso."
      : "Esta reserva já possui uma fatura.",
    fatura: resultado.fatura,
  });
});
export const listarFaturasController = asyncHandler(async (req, res) => {
  const faturas = await listarFaturas(req.query || {});

  return res.status(200).json({
    success: true,
    message: "Faturas carregadas com sucesso.",
    faturas,
  });
});

export const marcarFaturaComoPagaController = asyncHandler(async (req, res) => {
  const invoiceId = req.params.id;

  const fatura = await marcarFaturaComoPaga(invoiceId);

  return res.status(200).json({
    success: true,
    message: "Fatura marcada como paga com sucesso.",
    fatura,
  });
});