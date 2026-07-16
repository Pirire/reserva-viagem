import express from "express";
import authAdmin from "../../middlewares/authAdmin.js";
import authAdminMaster from "../../middlewares/authAdminMaster.js";
import * as dispatchController from "./dispatch.controller.js";
import * as dispatchAutoController from "./dispatch.auto.controller.js";
import * as dispatchRepeatDriverController from "./dispatch.repeat-driver.controller.js";

const router = express.Router();

router.get("/:tripId", authAdmin, dispatchController.obterDispatch);
router.post("/:tripId/auto", authAdminMaster, dispatchAutoController.executarAutoDispatch);

// oferta do último motorista
router.get(
  "/repeat-driver/:clienteId",
  authAdmin,
  dispatchRepeatDriverController.verificarOfertaUltimoMotoristaController
);

export default router;