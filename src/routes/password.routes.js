// src/routes/password.routes.js
import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";

import Cliente from "../models/Cliente.js";
import colaborador from "../models/colaboradores.js";


const router = Router();

/**
 * Transporter SMTP (usa as tuas vars do .env)
 * SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS
 */
function makeTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "false") === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("SMTP_* não definido no .env (SMTP_HOST/SMTP_USER/SMTP_PASS)");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

/**
 * Gera token (hex) e hash sha256 (hex)
 */
function makeResetToken() {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

/**
 * POST /api/password/forgot
 * body: { email }
 *
 * Segurança:
 * - Responde sempre ok:true (não revela se o email existe)
 */
router.post("/password/forgot", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.json({ ok: true });

    const FRONTEND_URL = String(process.env.FRONTEND_URL || "").trim();
    if (!FRONTEND_URL) {
      return res.status(500).json({ ok: false, message: "FRONTEND_URL não definido no .env" });
    }

    const { token, hash } = makeResetToken();
    const expiresMs = Date.now() + 30 * 60 * 1000; // 30 min

    // 1) tenta Cliente (resetToken/resetExpire)
    let userType = null;
    let user = await Cliente.findOne({ email }).select("+resetToken +resetExpire");
    if (user) {
      userType = "cliente";
      user.resetToken = hash;          // guarda o hash
      user.resetExpire = expiresMs;    // ms
      await user.save();
    } else {
      // 2) tenta Colaborador (resetTokenHash/resetExpireAt)
      user = await Colaborador.findOne({ email }).select("+resetTokenHash +resetExpireAt");
      if (user) {
        userType = "colaborador";
        user.resetTokenHash = hash;                // guarda o hash
        user.resetExpireAt = new Date(expiresMs);  // Date
        await user.save();
      }
    }

    // Se não existir, responde ok na mesma
    if (!user) return res.json({ ok: true });

    // Link (manda token puro para o frontend)
    const link = `${FRONTEND_URL}/reset?token=${encodeURIComponent(token)}&type=${encodeURIComponent(userType)}`;

    // Email
    const transporter = makeTransporter();
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: email,
      subject: "Reset de password",
      html: `
        <p>Recebemos um pedido para redefinir a tua password.</p>
        <p>Clica aqui (válido por 30 minutos):</p>
        <p><a href="${link}">${link}</a></p>
        <p>Se não foste tu, ignora este email.</p>
      `,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ /password/forgot:", err);
    // não revela detalhes
    return res.json({ ok: true });
  }
});

/**
 * POST /api/password/reset
 * body: { token, type, password }
 *
 * type: "cliente" | "colaborador"
 */
router.post("/password/reset", async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const type = String(req.body?.type || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!token || !type || !password) {
      return res.status(400).json({ ok: false, message: "token, type e password são obrigatórios." });
    }

    if (password.length < 6) {
      return res.status(400).json({ ok: false, message: "Password muito curta (mín. 6)." });
    }

    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const nowMs = Date.now();

    if (type === "cliente") {
      const user = await Cliente.findOne({ resetToken: hash }).select("+resetToken +resetExpire +passwordHash");
      if (!user) return res.status(400).json({ ok: false, message: "Token inválido." });
      if (!user.resetExpire || nowMs > Number(user.resetExpire)) {
        return res.status(400).json({ ok: false, message: "Token expirado." });
      }

      // usa método do model
      await user.setPassword(password);

      // limpa reset
      user.resetToken = undefined;
      user.resetExpire = undefined;
      await user.save();

      return res.json({ ok: true });
    }

    if (type === "colaborador") {
      const user = await Colaborador.findOne({ resetTokenHash: hash }).select("+resetTokenHash +resetExpireAt +passwordHash");
      if (!user) return res.status(400).json({ ok: false, message: "Token inválido." });

      const exp = user.resetExpireAt ? new Date(user.resetExpireAt).getTime() : 0;
      if (!exp || nowMs > exp) {
        return res.status(400).json({ ok: false, message: "Token expirado." });
      }

      await user.setPassword(password);

      // limpa reset
      user.resetTokenHash = null;
      user.resetExpireAt = null;
      await user.save();

      return res.json({ ok: true });
    }

    return res.status(400).json({ ok: false, message: "type inválido (cliente|colaborador)." });
  } catch (err) {
    console.error("❌ /password/reset:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

export default router;
