import mongoose from "mongoose";

function createError(message, statusCode = 500) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function viagensCollection() {
  return mongoose.connection.db.collection("viagens");
}

async function obterViagemPorId(viagemId) {
  if (!viagemId) {
    throw createError("viagemId é obrigatório.", 400);
  }

  if (!mongoose.Types.ObjectId.isValid(viagemId)) {
    throw createError("viagemId inválido.", 400);
  }

  const viagem = await viagensCollection().findOne({
    _id: new mongoose.Types.ObjectId(viagemId),
  });

  if (!viagem) {
    throw createError("Viagem não encontrada.", 404);
  }

  return viagem;
}

export async function associarColaboradorNaViagem(payload = {}) {
  const {
    viagemId,
    colaboradorId,
    partnerType = "outro",
    partnerName = "",
    payerType = "cliente",
  } = payload;

  if (!viagemId) {
    throw createError("viagemId é obrigatório.", 400);
  }

  if (!colaboradorId) {
    throw createError("colaboradorId é obrigatório.", 400);
  }

  if (!mongoose.Types.ObjectId.isValid(colaboradorId)) {
    throw createError("colaboradorId inválido.", 400);
  }

  const viagem = await obterViagemPorId(viagemId);

  const result = await viagensCollection().findOneAndUpdate(
    { _id: viagem._id },
    {
      $set: {
        colaboradorId: new mongoose.Types.ObjectId(colaboradorId),
        partnerType: String(partnerType || "outro").trim(),
        partnerName: String(partnerName || "").trim(),
        payerType: String(payerType || "cliente").trim(),
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" }
  );

  const viagemAtualizada = result?.value || result;

  if (!viagemAtualizada) {
    throw createError("Falha ao associar colaborador na viagem.", 500);
  }

  return viagemAtualizada;
}
