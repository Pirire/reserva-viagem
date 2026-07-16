import express from "express";
import * as faturacaoAutoController from "./faturacao.auto.controller.js";
import * as faturacaoController from "./faturacao.controller.js";
import authAdmin from "../../middlewares/authAdmin.js";
import * as faturacaoPartnerController from "./faturacao.partner-view.controller.js";
import authAdminMaster from "../../middlewares/authAdminMaster.js";

const router = express.Router();

router.get("/", authAdminMaster, faturacaoController.listarFaturasController);
router.post("/create", authAdminMaster, faturacaoController.criarFaturaController);
router.post("/:id/pay", authAdminMaster, faturacaoController.marcarFaturaComoPagaController);
router.post("/auto/:id", authAdminMaster, faturacaoAutoController.gerarFaturaAutomaticaController);
router.get("/partner-view/:id",authAdminMaster, faturacaoPartnerController.obterFaturaParceiroController);

export default router;
