import express from "express";
import crypto from "crypto";
import InviteMotorista from "../models/InviteMotorista.js";
import MotoristaPendente from "../models/MotoristaPendente.model.js";

const router = express.Router();


// =======================================
// CRIAR CONVITE
// POST /api/invites/motorista/create
// =======================================

router.post("/invites/motorista/create", async (req, res) => {
  try {

    const { email, frotaId } = req.body;

    if (!email || !frotaId)
      return res.status(400).json({ message: "email e frotaId são obrigatórios" });


    // gerar token real
    const token = crypto.randomBytes(32).toString("hex");

    // hash seguro
    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");


    // expira em 7 dias
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);


    await InviteMotorista.create({
      email,
      frotaId,
      createdById: frotaId,
      tokenHash,
      expiresAt,
      status: "sent"
    });


    const link = `${process.env.FRONTEND_URL || "http://localhost:10000"}/convite-motorista.html?token=${token}`;

    res.json({
      ok: true,
      link
    });

  }
  catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao criar convite" });
  }
});


// =======================================
// REGISTO VIA CONVITE
// POST /api/invites/motorista/register
// =======================================

router.post("/invites/motorista/register", async (req, res) => {
  try {

    const { token, nome, contacto, email } = req.body;

    if (!token)
      return res.status(400).json({ message: "Token obrigatório" });


    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");


    const invite = await InviteMotorista.findOne({
      tokenHash,
      status: "sent",
      expiresAt: { $gt: new Date() }
    });


    if (!invite)
      return res.status(400).json({ message: "Convite inválido ou expirado" });


    await MotoristaPendente.create({
      nome,
      contacto,
      email,
      frotaId: invite.frotaId,
      aprovacao: "pendente"
    });


    invite.status = "used";
    invite.usedAt = new Date();
    await invite.save();


    res.json({
      ok: true,
      message: "Registo enviado com sucesso"
    });

  }
  catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro no registo" });
  }
});

export default router;
