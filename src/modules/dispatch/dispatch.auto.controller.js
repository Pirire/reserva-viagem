import asyncHandler from "../../utils/asyncHandler.js";
import { autoDispatch } from "./dispatch.auto.service.js";
import { runOfferEngine } from "./dispatch.offer.engine.js";

export const executarAutoDispatch = asyncHandler(async (req, res) => {
  const tripId = req.params.tripId;

  const resultado = await autoDispatch(tripId);

  const io = req.app.get("io");

  // 🔥 IMPORTANTE: agora o socket é controlado pelo OFFER ENGINE
  if (resultado?.ok && io) {
    console.log("🚀 Iniciando Offer Engine para trip:", tripId);

    const offerResult = await runOfferEngine({
      io,
      tripId: resultado.tripId,
    });

    if (!offerResult?.ok) {
      console.log("⚠️ Offer Engine não iniciou:", offerResult?.reason);
    }
  } else {
    console.log("⚠️ Dispatch sem resultado válido ou socket não disponível");
  }

  return res.status(200).json({
    success: true,
    message: "Auto-dispatch executado com Offer Engine ativo.",
    ...resultado,
  });
});