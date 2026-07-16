// src/routes/partnerKeys.routes.js
// ══════════════════════════════════════════════════════════════
// CRUD de API Keys para empresas parceiras — acesso Admin Master.
//
// Montar em app.js:
//   import partnerKeysRoutes from "./routes/partnerKeys.routes.js";
//   app.use("/api/admin/partner-keys", authAdmin, partnerKeysRoutes);
//
// Endpoints:
//   GET    /api/admin/partner-keys          → listar todas
//   POST   /api/admin/partner-keys          → criar (gera chave)
//   PATCH  /api/admin/partner-keys/:id      → editar (permissões, webhook, notas)
//   DELETE /api/admin/partner-keys/:id      → revogar (ativo = false)
//   POST   /api/admin/partner-keys/:id/rotate → gerar nova chave
// ══════════════════════════════════════════════════════════════

import { Router } from "express";
import crypto      from "crypto";
import nodemailer   from "nodemailer";
import PartnerApiKey from "../models/PartnerApiKey.js";
import AuditLog      from "../models/AuditLog.js";
import jwt           from "jsonwebtoken";

const router = Router();

/* ════════════════════════════════════════════════════════════════
   EMAIL — Enviar API Key à empresa parceira (SaaS professional)
   
   Abordagem: não envia a chave directamente no email.
   Gera um token temporário (JWT 24h) e envia link para página segura.
   A empresa clica, vê a chave com botão de cópia real.
════════════════════════════════════════════════════════════════ */
async function sendApiKeyEmail({ to, empresa, apiKey, ambiente, permissoes = [], webhookUrl = "", isRotation = false }) {
  try {
    const transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || "false") === "true",
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    const baseUrl   = String(process.env.FRONTEND_BASE_URL || "http://localhost:10000").replace(/\/$/, "");
    const secret    = process.env.JWT_SECRET || "";
    const revealToken = jwt.sign(
      { apiKey, empresa, to, ambiente, permissoes },
      secret,
      { expiresIn: "24h" }
    );
    const revealUrl = `${baseUrl}/parceiro-boas-vindas.html?t=${revealToken}`;
    const ambienteLabel = ambiente === "live" ? "Live (Produção)" : "Sandbox (Testes)";
    const permLabel = permissoes.length
      ? permissoes.map(p => `<li style="margin:3px 0;font-family:monospace;font-size:12px;color:#94a3b8">${p}</li>`).join("")
      : "";

    const subject = isRotation
      ? `A sua API Key foi renovada — REALMETROPOLIS`
      : `A sua API Key está pronta — REALMETROPOLIS`;

    const headline = isRotation ? "Nova chave gerada" : "Bem-vindo à API REALMETROPOLIS";
    const subline  = isRotation
      ? "A sua chave anterior foi invalidada. Aceda ao link abaixo para ver e copiar a nova chave."
      : "A sua integração está configurada. Aceda ao link abaixo para ver e copiar a sua API Key.";

    const html = `<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Sora:wght@300;400;600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Sora',Arial,sans-serif;background:#050507;color:#e2e8f0}
</style>
</head>
<body style="margin:0;padding:0;background:#050507;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050507;min-height:100vh">
<tr><td align="center" style="padding:48px 16px">

  <table role="presentation" width="100%" style="max-width:560px" cellpadding="0" cellspacing="0">

    <!-- LOGO BAR -->
    <tr><td style="padding-bottom:32px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:middle">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="width:36px;height:36px;border-radius:50%;border:1.5px solid rgba(226,232,240,.25);background:rgba(226,232,240,.05);text-align:center;vertical-align:middle;font-family:monospace;font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:.06em">RM</td>
              <td style="padding-left:12px;font-family:'Sora',Arial,sans-serif;font-size:12px;font-weight:600;color:#94a3b8;letter-spacing:.18em;text-transform:uppercase">REALMETROPOLIS</td>
            </tr></table>
          </td>
          <td align="right">
            <span style="display:inline-block;padding:4px 12px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;${ambiente === "live" ? "background:rgba(16,185,129,.12);color:#34d399;border:1px solid rgba(16,185,129,.25)" : "background:rgba(99,102,241,.12);color:#818cf8;border:1px solid rgba(99,102,241,.25)"}">● ${ambienteLabel}</span>
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- MAIN CARD -->
    <tr><td style="background:linear-gradient(160deg,#0f1117 0%,#090b0f 100%);border:1px solid rgba(226,232,240,.08);border-radius:20px;overflow:hidden">

      <!-- TOP STRIPE -->
      <tr><td style="height:3px;background:linear-gradient(90deg,#6366f1,#8b5cf6,#06b6d4)"></td></tr>

      <!-- BODY -->
      <tr><td style="padding:40px 40px 32px">

        <!-- Icon + Headline -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
          <tr>
            <td style="width:56px;height:56px;background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.2);border-radius:14px;text-align:center;vertical-align:middle;font-size:24px">🔑</td>
            <td style="padding-left:16px;vertical-align:middle">
              <div style="font-family:'Sora',Arial,sans-serif;font-size:22px;font-weight:700;color:#f8fafc;line-height:1.2;letter-spacing:-.02em">${headline}</div>
              <div style="font-family:'Sora',Arial,sans-serif;font-size:13px;color:#64748b;margin-top:4px">${empresa}</div>
            </td>
          </tr>
        </table>

        <!-- Description -->
        <p style="font-family:'Sora',Arial,sans-serif;font-size:14px;color:#94a3b8;line-height:1.7;margin-bottom:28px">${subline}</p>

        <!-- CTA BUTTON — único elemento de acção -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
          <tr><td align="center">
            <a href="${revealUrl}" style="display:inline-block;padding:16px 40px;border-radius:12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;font-family:'Sora',Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:.02em;box-shadow:0 8px 32px rgba(99,102,241,.35)">
              Ver e copiar a minha API Key →
            </a>
          </td></tr>
        </table>

        <!-- Expiry notice -->
        <div style="background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.18);border-radius:10px;padding:12px 16px;margin-bottom:28px">
          <p style="font-family:'Sora',Arial,sans-serif;font-size:12px;color:rgba(245,158,11,.85);line-height:1.5;margin:0">
            ⏱ Este link expira em <strong>24 horas</strong>. Após ver a chave, guarde-a num local seguro — não a voltaremos a exibir.
          </p>
        </div>

        <!-- Divider -->
        <div style="height:1px;background:rgba(226,232,240,.06);margin-bottom:24px"></div>

        <!-- Permissions + info -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:top;padding-right:20px;width:50%">
              <div style="font-family:'Sora',Arial,sans-serif;font-size:10px;font-weight:700;color:#475569;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px">Permissões</div>
              <ul style="list-style:none;padding:0;margin:0">${permLabel || '<li style="font-size:12px;color:#475569">Padrão</li>'}</ul>
            </td>
            <td style="vertical-align:top;width:50%">
              <div style="font-family:'Sora',Arial,sans-serif;font-size:10px;font-weight:700;color:#475569;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px">Começar</div>
              <p style="font-family:'Sora',Arial,sans-serif;font-size:12px;color:#475569;line-height:1.6;margin:0">Após copiar a chave, aceda ao <a href="${baseUrl}/Parceiro-submit.html" style="color:#818cf8;text-decoration:none">portal de submissão</a> para enviar motoristas e veículos.</p>
            </td>
          </tr>
        </table>

      </td></tr>

      <!-- FOOTER -->
      <tr><td style="padding:20px 40px;border-top:1px solid rgba(226,232,240,.06)">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-family:'Sora',Arial,sans-serif;font-size:11px;color:#334155">REALMETROPOLIS · Serviço de transporte executivo</td>
            <td align="right"><a href="mailto:api@realmetropolis.pt" style="font-family:'Sora',Arial,sans-serif;font-size:11px;color:#475569;text-decoration:none">Suporte</a></td>
          </tr>
        </table>
      </td></tr>

    </td></tr>

  </table>

</td></tr>
</table>
</body>
</html>`;

    await transporter.sendMail({
      from:    `"REALMETROPOLIS" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });

    console.log(`✅ Email de API Key enviado para: ${to}`);
    return true;
  } catch (err) {
    console.warn(`⚠️ Falha no envio de email para ${to}:`, err?.message);
    return false;
  }
}


/* ── helper: actor do JWT de admin ──────────────────────────── */
function actorFromReq(req) {
  try {
    const token =
      req.cookies?.admin_token ||
      (req.headers.authorization || "").replace("Bearer ", "").trim();
    const p = jwt.verify(token, process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || "");
    return { id: String(p?.id || p?.sub || ""), nome: String(p?.nome || p?.user || "Admin") };
  } catch {
    return { id: "", nome: "Admin" };
  }
}

/* ── helper: gerar chave segura ─────────────────────────────── */
function generateKey(ambiente = "sandbox") {
  const prefix = ambiente === "live" ? "rm_live_" : "rm_test_";
  const raw    = prefix + crypto.randomBytes(24).toString("hex");
  const hash   = crypto.createHash("sha256").update(raw).digest("hex");
  const preview = raw.slice(0, 16) + "...";   // apenas para exibição no painel
  return { raw, hash, preview };
}

/* ── auditoria ──────────────────────────────────────────────── */
async function audit(action, actor, targetId, details = {}) {
  try {
    await AuditLog.create({
      action,
      actorAdminId:   actor.id   || "ADMIN",
      actorAdminName: actor.nome || "Admin",
      targetType:     "PartnerApiKey",
      targetModel:    "PartnerApiKey",
      targetId,
      details,
    });
  } catch (_) {}
}

/* ════════════════════════════════════════════════════════════════
   GET /api/admin/partner-keys
   Lista todas as API Keys (sem expor o hash)
════════════════════════════════════════════════════════════════ */
router.get("/", async (req, res) => {
  try {
    const { ativo, ambiente } = req.query;
    const filter = {};
    if (ativo !== undefined) filter.ativo = ativo === "true";
    if (ambiente) filter.ambiente = String(ambiente);

    const keys = await PartnerApiKey.find(filter)
      .select("-keyHash -webhookSecret")  // nunca expor hash nem secret
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ ok: true, keys });
  } catch (err) {
    console.error("❌ GET /partner-keys:", err);
    return res.status(500).json({ ok: false, message: "Erro ao listar API Keys." });
  }
});

/* ════════════════════════════════════════════════════════════════
   POST /api/admin/partner-keys
   Criar nova API Key para uma empresa parceira.
   A chave raw é devolvida UMA ÚNICA VEZ — não é possível recuperar depois.
════════════════════════════════════════════════════════════════ */
router.post("/", async (req, res) => {
  try {
    const actor    = actorFromReq(req);
    const { empresa, email, contacto, ambiente, permissoes, webhookUrl, notas } = req.body || {};

    if (!empresa || !email) {
      return res.status(400).json({ ok: false, message: "empresa e email são obrigatórios." });
    }

    const { raw, hash, preview } = generateKey(ambiente || "sandbox");

    const webhookSecret = webhookUrl
      ? "rmwh_" + crypto.randomBytes(20).toString("hex")
      : "";

    const doc = await PartnerApiKey.create({
      empresa:       String(empresa).trim(),
      email:         String(email).trim().toLowerCase(),
      contacto:      String(contacto || "").trim(),
      notas:         String(notas || "").trim(),
      keyHash:       hash,
      keyPreview:    preview,
      ambiente:      ambiente === "live" ? "live" : "sandbox",
      permissoes:    Array.isArray(permissoes) ? permissoes : ["submit:driver", "submit:vehicle"],
      ativo:         true,
      criadoPorId:   actor.id,
      criadoPorNome: actor.nome,
      webhookUrl:    String(webhookUrl || "").trim(),
      webhookSecret,
    });

    await audit("PARTNER_KEY_CREATED", actor, doc._id, {
      empresa: doc.empresa,
      email:   doc.email,
      ambiente: doc.ambiente,
      permissoes: doc.permissoes,
    });

    // ✅ Enviar a chave por email à empresa
    const emailSent = await sendApiKeyEmail({
      to:         doc.email,
      empresa:    doc.empresa,
      apiKey:     raw,
      ambiente:   doc.ambiente,
      permissoes: doc.permissoes,
      webhookUrl: doc.webhookUrl || "",
      isRotation: false,
    });

    // ✅ Devolve a chave raw APENAS nesta resposta
    return res.status(201).json({
      ok: true,
      message: "API Key criada com sucesso. Guarde a chave — não será exibida novamente.",
      // A chave raw é para enviar à empresa
      apiKey: raw,
      emailSent,
      webhookSecret: webhookSecret || undefined,
      partner: {
        id:         String(doc._id),
        empresa:    doc.empresa,
        email:      doc.email,
        ambiente:   doc.ambiente,
        permissoes: doc.permissoes,
        keyPreview: doc.keyPreview,
        webhookUrl: doc.webhookUrl,
        ativo:      doc.ativo,
      },
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ ok: false, message: "Já existe uma API Key com esta configuração." });
    }
    console.error("❌ POST /partner-keys:", err);
    return res.status(500).json({ ok: false, message: "Erro ao criar API Key." });
  }
});

/* ════════════════════════════════════════════════════════════════
   PATCH /api/admin/partner-keys/:id
   Editar permissões, webhook, notas, estado
   (NÃO altera a chave — para isso usar /rotate)
════════════════════════════════════════════════════════════════ */
router.patch("/:id", async (req, res) => {
  try {
    const actor  = actorFromReq(req);
    const { permissoes, webhookUrl, notas, ativo, contacto } = req.body || {};

    const update = {};
    if (Array.isArray(permissoes)) update.permissoes = permissoes;
    if (typeof ativo === "boolean") update.ativo = ativo;
    if (notas    !== undefined) update.notas      = String(notas || "").trim();
    if (contacto !== undefined) update.contacto   = String(contacto || "").trim();
    if (webhookUrl !== undefined) {
      update.webhookUrl = String(webhookUrl || "").trim();
      if (update.webhookUrl && !update.webhookSecret) {
        // gerar novo webhook secret se URL foi definida e não tinha
        update.webhookSecret = "rmwh_" + crypto.randomBytes(20).toString("hex");
      }
    }

    const doc = await PartnerApiKey.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true, select: "-keyHash -webhookSecret" }
    ).lean();

    if (!doc) return res.status(404).json({ ok: false, message: "API Key não encontrada." });

    await audit("PARTNER_KEY_UPDATED", actor, doc._id, update);

    return res.json({ ok: true, message: "API Key actualizada.", partner: doc });
  } catch (err) {
    console.error("❌ PATCH /partner-keys/:id:", err);
    return res.status(500).json({ ok: false, message: "Erro ao actualizar API Key." });
  }
});

/* ════════════════════════════════════════════════════════════════
   DELETE /api/admin/partner-keys/:id
   Revogar (ativo = false). Não apaga o registo (histórico).
════════════════════════════════════════════════════════════════ */
router.delete("/:id", async (req, res) => {
  try {
    const actor = actorFromReq(req);

    const doc = await PartnerApiKey.findByIdAndUpdate(
      req.params.id,
      { $set: { ativo: false } },
      { new: true, select: "-keyHash -webhookSecret" }
    ).lean();

    if (!doc) return res.status(404).json({ ok: false, message: "API Key não encontrada." });

    await audit("PARTNER_KEY_REVOKED", actor, doc._id, { empresa: doc.empresa });

    return res.json({ ok: true, message: `API Key de "${doc.empresa}" revogada com sucesso.` });
  } catch (err) {
    console.error("❌ DELETE /partner-keys/:id:", err);
    return res.status(500).json({ ok: false, message: "Erro ao revogar API Key." });
  }
});

/* ════════════════════════════════════════════════════════════════
   POST /api/admin/partner-keys/:id/rotate
   Gerar nova chave para a mesma empresa (invalida a anterior).
   A nova chave raw é devolvida UMA ÚNICA VEZ.
════════════════════════════════════════════════════════════════ */
router.post("/:id/rotate", async (req, res) => {
  try {
    const actor = actorFromReq(req);

    const existing = await PartnerApiKey.findById(req.params.id);
    if (!existing) return res.status(404).json({ ok: false, message: "API Key não encontrada." });

    const { raw, hash, preview } = generateKey(existing.ambiente);

    existing.keyHash    = hash;
    existing.keyPreview = preview;
    existing.ativo      = true;
    await existing.save();

    await audit("PARTNER_KEY_ROTATED", actor, existing._id, { empresa: existing.empresa });

    // ✅ Enviar nova chave por email
    await sendApiKeyEmail({
      to:         existing.email,
      empresa:    existing.empresa,
      apiKey:     raw,
      ambiente:   existing.ambiente,
      permissoes: existing.permissoes || [],
      webhookUrl: existing.webhookUrl || "",
      isRotation: true,
    });

    return res.json({
      ok:      true,
      message: "Chave rotacionada. Guarde a nova — não será exibida novamente.",
      apiKey:  raw,
      partner: {
        id:         String(existing._id),
        empresa:    existing.empresa,
        keyPreview: preview,
        ambiente:   existing.ambiente,
      },
    });
  } catch (err) {
    console.error("❌ POST /partner-keys/:id/rotate:", err);
    return res.status(500).json({ ok: false, message: "Erro ao rotacionar API Key." });
  }
});

/* ════════════════════════════════════════════════════════════════
   GET /api/admin/partner-keys/:id/submissions
   Ver submissões feitas por esta empresa parceira
════════════════════════════════════════════════════════════════ */
router.get("/:id/submissions", async (req, res) => {
  try {
    const partner = await PartnerApiKey.findById(req.params.id).lean();
    if (!partner) return res.status(404).json({ ok: false, message: "Parceiro não encontrado." });

    // importar dinamicamente para evitar dependências circulares
    const { default: ValidationSubmission } = await import("../models/ValidationSubmission.js");

    const submissions = await ValidationSubmission.find({
      gestorId: String(partner._id),
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .select("type status ownerName ownerEmail gestorNome createdAt finalDecision.decidedAt")
      .lean();

    return res.json({ ok: true, partner: { empresa: partner.empresa, email: partner.email }, submissions });
  } catch (err) {
    console.error("❌ GET /partner-keys/:id/submissions:", err);
    return res.status(500).json({ ok: false, message: "Erro ao listar submissões." });
  }
});

/* ════════════════════════════════════════════════════════════════
   POST /api/admin/partner-keys/send-email
   Envia a API Key por email à empresa (chamado manualmente pelo admin).
   Útil quando o email automático falhou ou o admin quer reenviar.
════════════════════════════════════════════════════════════════ */
router.post("/send-email", async (req, res) => {
  try {
    const { to, empresa, apiKey, ambiente, permissoes, webhookUrl } = req.body || {};

    if (!to)      return res.status(400).json({ ok: false, message: "Email de destino obrigatório." });
    if (!apiKey)  return res.status(400).json({ ok: false, message: "API Key obrigatória." });
    if (!empresa) return res.status(400).json({ ok: false, message: "Nome da empresa obrigatório." });

    const sent = await sendApiKeyEmail({
      to:         String(to).trim().toLowerCase(),
      empresa:    String(empresa).trim(),
      apiKey:     String(apiKey).trim(),
      ambiente:   String(ambiente || "sandbox"),
      permissoes: Array.isArray(permissoes) ? permissoes : ["submit:driver", "submit:vehicle"],
      webhookUrl: String(webhookUrl || ""),
      isRotation: false,
    });

    if (!sent) {
      return res.status(500).json({ ok: false, message: "Falha no envio. Verifique as configurações SMTP no .env." });
    }

    return res.json({ ok: true, message: `Email enviado para ${to}` });
  } catch (err) {
    console.error("❌ POST /partner-keys/send-email:", err?.message);
    return res.status(500).json({ ok: false, message: "Erro ao enviar email." });
  }
});


export default router;