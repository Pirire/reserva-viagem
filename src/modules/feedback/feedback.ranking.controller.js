import asyncHandler from "../../utils/asyncHandler.js";
import { obterRankingMotoristas } from "./feedback.ranking.service.js";

export const obterRankingMotoristasController = asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit || 10);

  const ranking = await obterRankingMotoristas(limit);

  return res.status(200).json({
    success: true,
    message: "Ranking de motoristas carregado com sucesso.",
    ranking
  });
});