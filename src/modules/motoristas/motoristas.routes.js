import express         from "express";
import { randomUUID }  from "crypto";
import { uploadRegisto } from "../../middlewares/upload.middleware.js";
import * as motoristasController from "./motoristas.controller.js";
import authAdmin        from "../../middlewares/authAdmin.js";

const router = express.Router();

function injetarRegistoId(req, _res, next) {
  req.registoId = randomUUID();
  next();
}

const camposUpload = uploadRegisto.fields([
  { name: "fotoRosto",        maxCount: 1 },
  { name: "ibanComprovativo", maxCount: 1 },
  { name: "docIdFrente",      maxCount: 1 },
  { name: "docIdVerso",       maxCount: 1 },
  { name: "docObgIdFrente",   maxCount: 1 },
  { name: "docObgIdVerso",    maxCount: 1 },
  { name: "cartaFrente",      maxCount: 1 },
  { name: "cartaVerso",       maxCount: 1 },
  { name: "imttTvde",         maxCount: 1 },
]);

function uploadMiddleware(req, res, next) {
  camposUpload(req, res, (err) => {
    if (err) {
      console.error("❌ Multer erro:", err.message, err.code);
      return res.status(400).json({
        success: false,
        message: err.message || "Erro ao processar ficheiros.",
        code: err.code || "UPLOAD_ERROR",
      });
    }
    next();
  });
}

/* ================================================================
   ROTAS
================================================================ */
router.post(
  "/registo",
  (req, _res, next) => { console.log("🔵 /registo recebido — body keys:", Object.keys(req.body||{})); next(); },
  injetarRegistoId,
  uploadMiddleware,
  motoristasController.registarMotorista
);

router.get(
  "/validacoes/motoristas",
  authAdmin,
  motoristasController.listarPendentes
);

router.patch("/:id/aprovar",  authAdmin, motoristasController.aprovarMotorista);
router.patch("/:id/rejeitar", authAdmin, motoristasController.rejeitarMotorista);

export default router;