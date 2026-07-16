import mongoose from "mongoose";

function createError(message, statusCode = 500) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function faturasCollection() {
  return mongoose.connection.db.collection("faturas");
}

function viagensCollection() {
  return mongoose.connection.db.collection("viagens");
}

export async function obterFaturaParaParceiro(invoiceId) {
  if (!invoiceId) {
    throw createError("invoiceId é obrigatório.", 400);
  }

  if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
    throw createError("invoiceId inválido.", 400);
  }

  const fatura = await faturasCollection().findOne({
    _id: new mongoose.Types.ObjectId(invoiceId),
  });

  if (!fatura) {
    throw createError("Fatura não encontrada.", 404);
  }

  const viagem = fatura.tripId
    ? await viagensCollection().findOne({ _id: new mongoose.Types.ObjectId(fatura.tripId) })
    : null;

  return {
    invoiceId: String(fatura._id),
    referenceCode: fatura.referenceCode || "",
    status: fatura.status || "",
    partnerName: fatura.partnerName || "",
    partnerType: fatura.partnerType || "",
    payerType: fatura.payerType || "",
    valorTotal: Number(fatura.valorTotal || 0).toFixed(2),
    moeda: fatura.moeda || "EUR",
    ivaIncluido: true,
    issuedAt: fatura.issuedAt || fatura.createdAt || null,
    viagem: {
      id: viagem?._id ? String(viagem._id) : "",
      origem: viagem?.origem || viagem?.pickup || "",
      destino: viagem?.destino || viagem?.dropoff || "",
      dataHora: viagem?.when || viagem?.createdAt || null,
      categoria: viagem?.categoria || viagem?.quote?.categoria || "",
    },
  };
}