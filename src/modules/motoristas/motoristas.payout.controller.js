import asyncHandler from "../../utils/asyncHandler.js";
import mongoose from "mongoose";
import { calcularPayoutMotorista } from "./motoristas.payout.service.js";

function viagensCollection() {
  return mongoose.connection.db.collection("viagens");
}

export const obterPayoutDaViagemController = asyncHandler(async (req, res) => {
  const viagemId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(viagemId)) {
    return res.status(400).json({
      success: false,
      message: "ID da viagem inválido.",
    });
  }

  const viagem = await viagensCollection().findOne({
    _id: new mongoose.Types.ObjectId(viagemId),
  });

  if (!viagem) {
    return res.status(404).json({
      success: false,
      message: "Viagem não encontrada.",
    });
  }

  const payout = await calcularPayoutMotorista(viagem);

  return res.status(200).json({
    success: true,
    message: "Payout do motorista calculado com sucesso.",
    viagem: {
      id: String(viagem._id),
      origem: viagem.origem || viagem.pickup || "",
      destino: viagem.destino || viagem.dropoff || "",
      valor: viagem.valor || viagem?.quote?.total || 0,
      pricingMode: viagem.pricingMode || "normal",
    },
    payout,
  });
});