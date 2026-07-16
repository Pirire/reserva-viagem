import express from "express";
import * as viagensPricingModeController from "./viagens.pricing-mode.controller.js";
import * as viagensColaboradorController from "./viagens.colaborador-link.controller.js";
import * as viagensController from "./viagens.controller.js";
import * as viagensReassignController from "./viagens.reassign.controller.js";
import * as viagensVehicleReassignController from "./viagens.vehicle-reassign.controller.js";
import authAdmin from "../../middlewares/authAdmin.js";
import authAdminMaster from "../../middlewares/authAdminMaster.js";

const router = express.Router();

router.get("/", authAdmin, viagensController.listarViagens);
router.get("/:id/candidatos", authAdmin, viagensController.listarCandidatos);

router.post("/:id/atribuir", authAdminMaster, viagensController.atribuirViagem);

router.post("/:id/auto-atribuir", authAdminMaster, viagensController.autoAtribuirViagem);
router.post("/:id/pagar", authAdminMaster, viagensController.marcarPago);

router.post("/:id/reassign-driver", authAdminMaster, viagensReassignController.reassignDriver);
router.post("/:id/reassign-vehicle", authAdminMaster, viagensVehicleReassignController.reassignVehicle);

router.post("/:id/set-client", authAdminMaster, viagensController.definirCliente);
router.post("/:id/colaborador", authAdminMaster, viagensColaboradorController.associarColaboradorController);
router.post("/:id/pricing-mode", authAdminMaster, viagensPricingModeController.definirPricingModeController);

export default router;