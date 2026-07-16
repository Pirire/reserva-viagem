import asyncHandler from "../../utils/asyncHandler.js";
import { cancelarViagem } from "./viagens.cancel.service.js";

export const cancelarViagemController = asyncHandler(async (req, res) => {
  const viagemId = req.params.id;
  const motivo = req.body?.motivo || "";

  const resultado = await cancelarViagem(viagemId, {
    canceladoPor: "admin",
    motivo,
  });

  const io = req.app.get("io");
  if (io && resultado.viagem?.meta?.shareId) {
    io.to(`share_${resultado.viagem.meta.shareId}`).emit("viagem_cancelada", {
      tripId: String(resultado.viagem._id),
      motivo,
      reembolsos: resultado.reembolsos,
    });
  }

  return res.status(200).json({
    success: true,
    message: "Viagem cancelada com sucesso.",
    viagem: resultado.viagem,
    reembolsos: resultado.reembolsos,
  });
});
