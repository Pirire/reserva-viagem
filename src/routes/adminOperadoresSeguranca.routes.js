// src/routes/adminOperadoresSeguranca.routes.js
// ══════════════════════════════════════════════════════════════
// Rotas de admin para gerir operadores de segurança.
//
// POST /api/admin/operadores-seguranca/invite  — enviar convite
// GET  /api/admin/operadores-seguranca         — listar
// POST /api/admin/operadores-seguranca/:id/aprovar — aprovar/rejeitar
// ══════════════════════════════════════════════════════════════

import { Router }   from "express";
import crypto       from "crypto";
import jwt          from "jsonwebtoken";
import nodemailer   from "nodemailer";
import OperadorSeguranca from "../models/OperadorSeguranca.js";
import AuditLog     from "../models/AuditLog.js";
import logger       from "../config/logger.js";

const router = Router();

// ── SMTP ──────────────────────────────────────────────────────
function createSmtp() {
  const host = process.env.SMTP_HOST || "";
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  const port = Number(process.env.SMTP_PORT || 587);
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure:port===465, auth:{ user, pass } });
}

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host  = req.headers["x-forwarded-host"]  || req.get("host") || "localhost:10000";
  return `${proto}://${host}`;
}

async function enviarConviteEmail({ to, nome, regiao, link }) {
  const smtp = createSmtp();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "";
  if (!smtp || !from) throw new Error("SMTP não configurado.");

  const regiaoLabel = {
    lisboa:"Lisboa", porto:"Porto", algarve:"Algarve",
    joao_pessoa:"João Pessoa", global:"Global",
  }[regiao] || regiao;

  await smtp.sendMail({
    from, to,
    subject: "REALMETROPOLIS — Convite Operador de Segurança",
    html: `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111">
      <h2 style="margin:0 0 6px">REALMETROPOLIS</h2>
      <p style="color:#555;margin:0 0 20px">Centro de Segurança</p>
      <p>Olá <b>${nome||"Operador"}</b>,</p>
      <p>Foi convidado(a) para integrar a equipa de segurança da <b>região de ${regiaoLabel}</b>.</p>
      <p>Clique no botão abaixo para completar o seu registo:</p>
      <p style="margin:24px 0">
        <a href="${link}" style="background:#1a1a1a;color:#fff;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:bold;display:inline-block">
          Completar Registo →
        </a>
      </p>
      <p style="color:#777;font-size:12px">Este link expira em 72 horas. Se não solicitou este convite, ignore esta mensagem.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
      <p style="color:#aaa;font-size:11px">REALMETROPOLIS — Sistema de Transporte</p>
    </div>`,
  });
}

/* ══════════════════════════════════════════════════════════════
   POST /api/admin/operadores-seguranca/invite
══════════════════════════════════════════════════════════════ */
router.post("/invite", async (req, res) => {
  try {
    const { nome, email, regiao, pais } = req.body || {};
    if (!nome || !email || !regiao)
      return res.status(400).json({ ok:false, message:"nome, email e regiao obrigatórios." });

    const emailNorm = email.toLowerCase().trim();

    // Verificar se já existe e está aprovado
    const existe = await OperadorSeguranca.findOne({ email:emailNorm });
    if (existe?.aprovado)
      return res.status(409).json({ ok:false, message:"Este operador já está aprovado." });

    // Gerar token único
    const rawToken  = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    let doc = existe;
    if (!doc) {
      doc = await OperadorSeguranca.create({
        email: emailNorm, nome, regiao, pais:pais||"pt",
        tokenHash, aprovado:false,
        validacao:{ status:"pendente" },
      });
    } else {
      doc.nome      = nome;
      doc.regiao    = regiao;
      doc.pais      = pais||"pt";
      doc.tokenHash = tokenHash;
      doc.tokenUsadoEm = null;
      doc.aprovado  = false;
      await doc.save();
    }

    const link = `${getBaseUrl(req)}/registo-operador-seguranca.html?token=${encodeURIComponent(rawToken)}`;

    let emailSent = false, emailError = null;
    try {
      await enviarConviteEmail({ to:emailNorm, nome, regiao, link });
      emailSent = true;
    } catch(e) {
      emailError = String(e?.message||e);
      logger.warn({ emailError }, "⚠️ Email de convite não enviado");
    }

    try {
      await AuditLog.create({
        action:"INVITE_OPERADOR_SEGURANCA",
        actorAdminId:   String(req.admin?._id||""),
        actorAdminName: req.admin?.nome||"Admin",
        targetType:"OperadorSeguranca", targetId:String(doc._id),
        details:{ email:emailNorm, regiao, emailSent },
      });
    } catch(_) {}

    logger.info({ email:emailNorm, regiao, emailSent }, "✅ Convite operador segurança enviado");
    return res.json({
      ok:true,
      message: emailSent ? "Convite enviado com sucesso." : "Operador criado mas email falhou (ver SMTP).",
      emailSent, emailError,
      link: emailSent ? null : link, // mostrar link se email falhou
    });
  } catch(err) {
    logger.error({ err }, "❌ /admin/operadores-seguranca/invite");
    return res.status(500).json({ ok:false, message:"Erro ao enviar convite." });
  }
});

/* ══════════════════════════════════════════════════════════════
   GET /api/admin/operadores-seguranca
══════════════════════════════════════════════════════════════ */
router.get("/", async (req, res) => {
  try {
    const { status, regiao } = req.query;
    const filtro = {};
    if (status === "aprovado")  filtro.aprovado = true;
    if (status === "pendente")  filtro.aprovado = false;
    if (regiao) filtro.regiao = String(regiao).toLowerCase();

    const operadores = await OperadorSeguranca.find(filtro)
      .select("-passwordHash -tokenHash")
      .sort({ createdAt:-1 }).lean();

    return res.json({ ok:true, operadores });
  } catch(err) {
    logger.error({ err }, "❌ GET /admin/operadores-seguranca");
    return res.status(500).json({ ok:false });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/admin/operadores-seguranca/:id/aprovar
══════════════════════════════════════════════════════════════ */
router.post("/:id/aprovar", async (req, res) => {
  try {
    const { status, observacoes } = req.body || {};
    const st = String(status||"").toLowerCase();
    if (!["aprovado","rejeitado"].includes(st))
      return res.status(400).json({ ok:false, message:"status inválido." });

    const aprovado = st === "aprovado";
    const operador = await OperadorSeguranca.findByIdAndUpdate(
      req.params.id,
      {
        aprovado,
        "validacao.status":          st,
        "validacao.observacoes":     String(observacoes||""),
        "validacao.validadoEm":      new Date(),
        "validacao.validadoPorId":   String(req.admin?._id||""),
        "validacao.validadoPorNome": req.admin?.nome||"Admin",
      },
      { new:true }
    );
    if (!operador) return res.status(404).json({ ok:false, message:"Operador não encontrado." });

    try {
      await AuditLog.create({
        action:"APROVACAO_OPERADOR_SEGURANCA",
        actorAdminId:   String(req.admin?._id||""),
        actorAdminName: req.admin?.nome||"Admin",
        targetType:"OperadorSeguranca", targetId:String(operador._id),
        details:{ status:st, regiao:operador.regiao },
      });
    } catch(_) {}

    logger.info({ id:req.params.id, status:st, regiao:operador.regiao }, "✅ Operador segurança aprovado/rejeitado");
    return res.json({ ok:true, operador });
  } catch(err) {
    logger.error({ err }, "❌ /admin/operadores-seguranca/:id/aprovar");
    return res.status(500).json({ ok:false });
  }
});

export default router;