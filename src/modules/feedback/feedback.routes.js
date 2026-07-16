import express from "express";

import * as feedbackController from "./feedback.controller.js";
import authAdmin from "../../middlewares/authAdmin.js";
import authAdminMaster from "../../middlewares/authAdminMaster.js";
import * as rankingController from "./feedback.ranking.controller.js";
const router = express.Router();

// criar link de feedback
router.post("/create-link", authAdminMaster, feedbackController.criarLinkFeedbackController);

// página pública / token público
router.get("/token/:token", feedbackController.obterFeedbackPorTokenController);
router.post("/token/:token/respond", feedbackController.responderFeedbackPorTokenController);

// portal do colaborador / admin
router.get(
  "/colaborador/:colaboradorId",
  authAdmin,
  feedbackController.listarFeedbacksPorColaboradorController
);

// estatísticas do colaborador
router.get(
  "/colaborador/:colaboradorId/stats",
  authAdmin,
  feedbackController.obterEstatisticasColaboradorController
);
router.get(
  "/ranking/motoristas",
  authAdmin,
  rankingController.obterRankingMotoristasController
);
export default router;