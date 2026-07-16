import { Router } from "express";
import crypto from "crypto";
import nodemailer from "nodemailer";
import Motorista from "../models/Motorista.js";

// Se você quiser proteger depois, descomente a linha abaixo e use no router.post
// import { authRole } from "../middlewares/auth.js";

const router = Router();

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function makeInviteEmailHtml({ nome, link }) {
  return `
  <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
    <h2 style="margin:0 0 12px">Bem-vindo(a), ${nome || "Motorista"} 👋</h2>
    <p>Foi criado o seu acesso à <b>Área do Motorista</b> da REALMETROPOLIS.</p>
    <p>Para definir a sua senha e concluir o primeiro acesso, clique no botão abaixo:</p>
    <p style="margin:18px 0">
      <a href="${link}" style="display:inline-block;padding:12px 16px;background:#f6c343;color:#000;text-decoration:none;border-radius:10px;font-weight:bold;border-radius:10px">
        Definir senha
      </a>
    </p>
    <p style="color:#444;font-size:13px">Este link expira em 24 horas.</p>
  </div>`;
}

/**
 * POST /api/admin/motoristas
 * body: { nome, contacto, email, categoria?, idiomas?, frota?, aprovacao? }
 *
 * Cria motorista SEM senha e envia link por email para definir senha.
 */
router.post("/motoristas", async (req, res) => {
  try {
    const { nome, contacto, email, categoria, idiomas, frota, aprovacao } = req.body || {};

    if (!nome || !contacto || !email) {
      return res.status(400).json({ success: false, message: "nome, contacto e email são obrigatórios" });
    }

    const emailNorm = String(email).toLowerCase().trim();

    const existe = await Motorista.findOne({ email: emailNorm }).select("_id");
    if (existe) {
      return res.status(409).json({ success: false, message: "Já existe motorista com este email" });
    }

    // Token convite (guardamos hash)
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const m = await Motorista.create({
      nome: String(nome).trim(),
      contacto: String(contacto).trim(),
      email: emailNorm,
      categoria: categoria || "ECONOMICA",
      idiomas: Array.isArray(idiomas) ? idiomas : [],
      frota: frota || null,
      aprovacao: aprovacao || "pendente",
      convite: { tokenHash, expiresAt, usadoEm: null },
      passwordHash: null,
    });

    const baseUrl = process.env.FRONTEND_BASE_URL || "http://localhost:10000";
    const link = `${baseUrl}/motorista-primeiro-acesso.html?token=${token}`;

    // Enviar email
    const transporter = getTransporter();
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: m.email,
      subject: "Defina sua senha — Área do Motorista (REALMETROPOLIS)",
      html: makeInviteEmailHtml({ nome: m.nome, link }),
    });

    return res.status(201).json({
      success: true,
      motorista: { id: m._id, email: m.email, aprovacao: m.aprovacao },
      conviteLinkTeste: link, // útil para testes locais
    });
  } catch (err) {
    console.error("Erro criar motorista + convite:", err);
    return res.status(500).json({ success: false, message: "Erro ao criar motorista" });
  }
});

export default router;
