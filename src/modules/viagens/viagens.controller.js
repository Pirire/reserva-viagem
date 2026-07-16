import mongoose from "mongoose";
import asyncHandler from "../../utils/asyncHandler.js";
import * as viagensService from "./viagens.service.js";
import { listarCandidatosParaViagem } from "./viagens.candidatos.service.js";

export const listarViagens = asyncHandler(async (req, res) => {
  const viagens = await viagensService.listarViagens();

  return res.status(200).json({
    success: true,
    message: "Viagens carregadas com sucesso.",
    viagens,
  });
});

export const listarCandidatos = asyncHandler(async (req, res) => {
  const viagemId = req.params.id;
  const raioKm = Number(req.query.raioKm || 5);

  const resultado = await listarCandidatosParaViagem(viagemId, raioKm);

  return res.status(200).json({
    success: true,
    message: "Candidatos carregados com sucesso.",
    ...resultado,
  });
});

export const atribuirViagem = asyncHandler(async (req, res) => {
  const viagemId = req.params.id;

  const motoristaId =
    req.body.motorista ||
    req.body.motoristaId ||
    req.body.motorista_id;

  const viagem = await viagensService.atribuirViagem({
    viagemId,
    motoristaId,
  });

  return res.status(200).json({
    success: true,
    message: "Viagem atribuída com sucesso.",
    viagem,
  });
});

export const marcarPago = asyncHandler(async (req, res) => {
  const viagemId = req.params.id;
  const viagem = await viagensService.marcarPago(viagemId);

  return res.status(200).json({
    success: true,
    message: "Pagamento atualizado com sucesso.",
    viagem,
  });
});

export const definirCliente = asyncHandler(async (req, res) => {
  const viagemId = req.params.id;
  const { clienteId } = req.body || {};

  if (!clienteId) {
    return res.status(400).json({
      success: false,
      message: "clienteId é obrigatório.",
    });
  }

  if (!mongoose.Types.ObjectId.isValid(viagemId)) {
    return res.status(400).json({
      success: false,
      message: "ID da viagem inválido.",
    });
  }

  const result = await mongoose.connection.db
    .collection("viagens")
    .findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(viagemId) },
      {
        $set: {
          clienteId: String(clienteId),
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );

  const viagem = result?.value || result;

  if (!viagem) {
    return res.status(404).json({
      success: false,
      message: "Viagem não encontrada.",
    });
  }

  return res.status(200).json({
    success: true,
    message: "Cliente associado à viagem.",
    viagem,
  });
});

export const autoAtribuirViagem = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const resultado = await viagensService.autoAtribuirViagem(id);

  if (!resultado.ok) {
    return res.status(200).json(resultado);
  }

  return res.status(200).json({
    success: true,
    message: "Viagem atribuída automaticamente.",
    ...resultado,
  });
});
