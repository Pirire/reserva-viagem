import express from "express";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

router.post("/", async (req, res) => {
  try {
    const { nome, email, mensagem } = req.body || {};
    if (!nome || !email || !mensagem) {
      return res.status(400).json({
        success: false,
        message: "Campos obrigatórios: nome, email, mensagem",
      });
    }

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.ADMIN_EMAIL,
      replyTo: email,
      subject: `Novo contacto - ${nome}`,
      html: `
        <h2>Novo contacto</h2>
        <p><b>Nome:</b> ${nome}</p>
        <p><b>Email:</b> ${email}</p>
        <p><b>Mensagem:</b><br/>${String(mensagem).replace(/\n/g, "<br/>")}</p>
      `,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("Erro /contact:", err);
    return res.status(500).json({
      success: false,
      message: "Erro ao enviar contacto",
    });
  }
});

export default router;
