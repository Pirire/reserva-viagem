// src/services/email.service.js
import nodemailer from "nodemailer";

export function makeTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("SMTP não configurado. Define SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS no .env");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendValidationEmail({
  to,
  cc,
  subject,
  html,
}) {
  const transporter = makeTransporter();
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;

  await transporter.sendMail({
    from,
    to,
    cc,
    subject,
    html,
  });
}