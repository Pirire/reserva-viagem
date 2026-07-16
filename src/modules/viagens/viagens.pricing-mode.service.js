import mongoose from "mongoose";

function createError(message, statusCode = 500) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function viagensCollection() {
  return mongoose.connection.db.collection("viagens");
}

export async function definirPricingModeDaViagem(viagemId, pricingMode) {
  if (!viagemId) {
    throw createError("viagemId é obrigatório.", 400);
  }

  if (!mongoose.Types.ObjectId.isValid(viagemId)) {
    throw createError("viagemId inválido.", 400);
  }

  const mode = String(pricingMode || "").trim().toLowerCase();

  if (!["normal", "repeat_driver"].includes(mode)) {
    throw createError("pricingMode inválido.", 400);
  }

  const result = await viagensCollection().findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId(viagemId) },
    {
      $set: {
        pricingMode: mode,
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" }
  );

  const viagem = result?.value || result;

  if (!viagem) {
    throw createError("Viagem não encontrada.", 404);
  }

  return viagem;
}
