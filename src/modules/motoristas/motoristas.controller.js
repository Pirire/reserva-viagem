import asyncHandler from "../../utils/asyncHandler.js";
import * as motoristasService from "./motoristas.service.js";

/* =========================
   REGISTO
========================= */
export const registarMotorista = asyncHandler(async (req, res) => {
  console.log("📥 BODY completo:", JSON.stringify(req.body));
  console.log("📥 nome:", req.body?.nome);
  console.log("📥 email:", req.body?.email);
  console.log("📄 FILES:", Object.keys(req.files || {}));

  const motorista = await motoristasService.criarMotoristaService(
    req.body,
    req.files,
    req
  );
  res.status(201).json({
    success: true,
    message: "Motorista enviado para validação",
    motorista,
  });
});

/* =========================
   LISTAR PENDENTES
========================= */
export const listarPendentes = asyncHandler(async (req, res) => {
  const data = await motoristasService.listarPendentes();
  res.json({ success: true, data });
});

/* =========================
   APROVAR
========================= */
export const aprovarMotorista = asyncHandler(async (req, res) => {
  const motorista = await motoristasService.aprovar(req.params.id);
  res.json({ success: true, message: "Motorista aprovado", motorista });
});

/* =========================
   REJEITAR
========================= */
export const rejeitarMotorista = asyncHandler(async (req, res) => {
  const motorista = await motoristasService.rejeitar(req.params.id);
  res.json({ success: true, message: "Motorista rejeitado", motorista });
});