import mongoose from "mongoose";

function viagensCollection() {
  return mongoose.connection.db.collection("viagens");
}

function faturasCollection() {
  return mongoose.connection.db.collection("faturas");
}

function createError(message, statusCode = 500) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function obterPercentuaisDaViagem(viagem) {
  const mode = String(viagem?.pricingMode || "normal").trim().toLowerCase();

  if (mode === "repeat_driver") {
    return {
      pricingMode: "repeat_driver",
      empresaPercent: 7.5,
      motoristaPercent: 92.5,
    };
  }

  return {
    pricingMode: "normal",
    empresaPercent: 15,
    motoristaPercent: 85,
  };
}

export async function gerarFaturaAutomatica(viagemId) {
  if (!mongoose.Types.ObjectId.isValid(viagemId)) {
    throw createError("viagemId inválido.", 400);
  }

  const viagem = await viagensCollection().findOne({
    _id: new mongoose.Types.ObjectId(viagemId),
  });

  if (!viagem) {
    throw createError("Viagem não encontrada.", 404);
  }

  if (!viagem.colaboradorId) {
    throw createError("Viagem não possui colaborador associado.", 400);
  }

  const faturaExistente = await faturasCollection().findOne({
    tripId: viagem._id,
    status: { $in: ["emitida", "paga"] },
  });

  if (faturaExistente) {
    return {
      faturaId: faturaExistente._id,
      fatura: faturaExistente,
      jaExistia: true,
    };
  }

  const valorTotal = Number(viagem.valor || 0);

  if (!Number.isFinite(valorTotal) || valorTotal <= 0) {
    throw createError("Valor da viagem inválido para faturação.", 400);
  }

  const { pricingMode, empresaPercent, motoristaPercent } =
    obterPercentuaisDaViagem(viagem);

  const empresaValor = Number(((valorTotal * empresaPercent) / 100).toFixed(2));
  const motoristaValor = Number(((valorTotal * motoristaPercent) / 100).toFixed(2));

  const fatura = {
    tripId: viagem._id,
    colaboradorId: viagem.colaboradorId,
    motoristaId: viagem.motorista?.id || null,
    partnerType: viagem.partnerType || null,
    partnerName: viagem.partnerName || null,
    payerType: viagem.payerType || "cliente",
    pricingMode,
    valorTotal,
    empresaPercent,
    motoristaPercent,
    empresaValor,
    motoristaValor,
    status: "emitida",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await faturasCollection().insertOne(fatura);

  return {
    faturaId: result.insertedId,
    fatura,
    jaExistia: false,
  };
}