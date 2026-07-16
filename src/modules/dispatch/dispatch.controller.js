import asyncHandler from "../../utils/asyncHandler.js";
import { autoDispatch } from "./dispatch.auto.service.js";

export const obterDispatch = asyncHandler(async (req, res) => {
  const tripId = req.params.tripId;
  const raioKm = Number(req.query.raioKm || 5);

  const resultado = await autoDispatch(tripId, raioKm);

  return res.status(200).json({
    success: true,
    message: "Dispatch carregado com sucesso.",
    ...resultado,
  });
});