import { Router } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import ConviteParceiro from "../models/convitesParceiros.js";

const router = Router();

/* ================================================================
   AUTH — AdminMaster (cookie admin_token OU Bearer)
================================================================ */
function getAdminSecret() {
  return String(process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || "").trim();
}

router.use((req, _res, next) => {
  try {
    const SECRET = getAdminSecret();
    if (!SECRET) { req.admin = null; return next(); }
    const auth    = String(req.headers.authorization || "");
    const bearer  = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const cookie  = String(req.cookies?.admin_token || "").trim();
    const token   = bearer || cookie;
    if (!token) { req.admin = null; return next(); }
    req.admin = jwt.verify(token, SECRET) || null;
  } catch {
    req.admin = null;
  }
  next();
});

function requireAdminMaster(req, res, next) {
  const tipo = String(req.admin?.tipo || req.admin?.typ || "").toLowerCase();
  if (tipo !== "adminmaster" && tipo !== "admin_master") {
    return res.status(403).json({ ok: false, message: "Sem permissão (AdminMaster)." });
  }
  next();
}

/* ================================================================
   SMTP
================================================================ */
function createSmtpTransport() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host, port,
    secure: port === 465,
    auth: { user, pass },
  });
}

/* ================================================================
   EMAIL 1 — CONVITE (enviado pelo admin ao criar convite)
   Botão PRATA obrigatório — "COMPLETAR REGISTO"
   Mostra dados pré-preenchidos: empresa, NIF, email, contacto
================================================================ */
async function sendInviteEmail({ to, link, empresa, nif, contacto, tipo }) {
  const transporter = createSmtpTransport();
  const from = String(process.env.SMTP_FROM || process.env.SMTP_USER || "").trim();

  if (!transporter || !from) {
    console.warn("⚠️ SMTP não configurado. Link do convite:", link);
    return;
  }

  const tipoLabel = tipo === "frota"      ? "Gestor de Frota"
                  : tipo === "hotel"      ? "Hotel"
                  : tipo === "alojamento" ? "Alojamento"
                  : String(tipo || "Parceiro");

  const subject = "REALMETROPOLIS — Convite de Registo";
  const html = `<!DOCTYPE html>
<html lang="pt">
<body style="margin:0;padding:0;background:#050507;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
        style="background:linear-gradient(180deg,#0e1012,#08090b);
               border:1px solid rgba(196,201,212,.18);border-radius:18px;
               overflow:hidden;max-width:560px;width:100%;">

        <!-- Cabeçalho -->
        <tr>
          <td style="padding:22px 28px 18px;border-bottom:1px solid rgba(196,201,212,.10);">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="width:42px;height:42px;border-radius:50%;
                         border:1.5px solid rgba(196,201,212,.35);
                         text-align:center;vertical-align:middle;
                         background:#0a0c0f;color:#c4c9d4;
                         font-weight:900;font-size:11px;">RM</td>
              <td style="padding-left:12px;color:#c4c9d4;font-size:14px;
                         font-weight:900;letter-spacing:.12em;">REALMETROPOLIS</td>
            </tr></table>
          </td>
        </tr>

        <!-- Corpo -->
        <tr><td style="padding:28px 28px 24px;">

          <p style="color:#edf0f5;font-size:20px;font-weight:900;margin:0 0 8px;">
            Convite de Registo
          </p>
          <p style="color:#8b95a2;font-size:13px;margin:0 0 22px;line-height:1.55;">
            Foi convidado para se registar como
            <b style="color:#c4c9d4;">${tipoLabel}</b>
            na plataforma REALMETROPOLIS.<br>
            Os seus dados foram pré-preenchidos no formulário.
            Apenas precisa de carregar os documentos e submeter o registo.
          </p>

          <!-- Tabela de dados pré-preenchidos -->
          <table cellpadding="0" cellspacing="0" width="100%"
            style="margin-bottom:24px;
                   background:rgba(196,201,212,.05);
                   border:1px solid rgba(196,201,212,.12);
                   border-radius:12px;overflow:hidden;">
            <tr style="border-bottom:1px solid rgba(196,201,212,.08);">
              <td style="padding:11px 16px;width:38%;background:rgba(0,0,0,.15);">
                <p style="margin:0;color:#5f6874;font-size:10px;font-weight:700;
                           letter-spacing:.1em;text-transform:uppercase;">Empresa</p>
              </td>
              <td style="padding:11px 16px;">
                <p style="margin:0;color:#edf0f5;font-size:13px;font-weight:700;">
                  ${String(empresa || "—")}
                </p>
              </td>
            </tr>
            <tr style="border-bottom:1px solid rgba(196,201,212,.08);">
              <td style="padding:11px 16px;background:rgba(0,0,0,.15);">
                <p style="margin:0;color:#5f6874;font-size:10px;font-weight:700;
                           letter-spacing:.1em;text-transform:uppercase;">NIF</p>
              </td>
              <td style="padding:11px 16px;">
                <p style="margin:0;color:#edf0f5;font-size:13px;font-weight:700;">
                  ${String(nif || "—")}
                </p>
              </td>
            </tr>
            <tr style="border-bottom:1px solid rgba(196,201,212,.08);">
              <td style="padding:11px 16px;background:rgba(0,0,0,.15);">
                <p style="margin:0;color:#5f6874;font-size:10px;font-weight:700;
                           letter-spacing:.1em;text-transform:uppercase;">Email</p>
              </td>
              <td style="padding:11px 16px;">
                <p style="margin:0;color:#edf0f5;font-size:13px;font-weight:700;">
                  ${String(to || "—")}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:11px 16px;background:rgba(0,0,0,.15);">
                <p style="margin:0;color:#5f6874;font-size:10px;font-weight:700;
                           letter-spacing:.1em;text-transform:uppercase;">Contacto</p>
              </td>
              <td style="padding:11px 16px;">
                <p style="margin:0;color:#edf0f5;font-size:13px;font-weight:700;">
                  ${String(contacto || "—")}
                </p>
              </td>
            </tr>
          </table>

          <p style="color:#8b95a2;font-size:12px;margin:0 0 20px;line-height:1.6;">
            Após submeter o registo, a equipa irá validar os documentos.<br>
            Quando aprovado, receberá um segundo email para ativar o acesso ao portal.
          </p>

          <!-- BOTÃO PRATA — COMPLETAR REGISTO -->
          <table cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
            <tr><td>
              <a href="${link}"
                style="display:inline-block;
                       background:linear-gradient(180deg,#e0e4ea,#bec6d1);
                       color:#07080a;text-decoration:none;
                       padding:14px 34px;border-radius:13px;
                       font-weight:900;font-size:14px;letter-spacing:.06em;
                       box-shadow:0 4px 16px rgba(0,0,0,.4),
                                  inset 0 1px 0 rgba(255,255,255,.6);">
                COMPLETAR REGISTO
              </a>
            </td></tr>
          </table>

          <p style="color:#434a55;font-size:11px;margin:0 0 5px;">
            Ou copie este link:
          </p>
          <p style="word-break:break-all;color:#6b7585;font-size:11px;margin:0 0 22px;">
            ${link}
          </p>
          <p style="color:#434a55;font-size:11px;
                    border-top:1px solid rgba(196,201,212,.08);
                    padding-top:14px;margin:0;">
            Este convite expira em 72 horas.
            Se não solicitou este registo, ignore este email.
          </p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({ from, to, subject, html });
}

/* ================================================================
   EMAIL 2 — APROVAÇÃO (enviado quando admin aprova o convite)
   Botão PRATA — "ATIVAR CONTA" → colaborador-definir-senha.html
================================================================ */
async function sendApprovalEmail({ to, empresa, linkSenha }) {
  const transporter = createSmtpTransport();
  const from = String(process.env.SMTP_FROM || process.env.SMTP_USER || "").trim();

  if (!transporter || !from) {
    console.warn("⚠️ SMTP não configurado. Link aprovação:", linkSenha);
    return;
  }

  const subject = "REALMETROPOLIS — Conta Aprovada ✅";
  const html = `<!DOCTYPE html>
<html lang="pt">
<body style="margin:0;padding:0;background:#050507;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
        style="background:linear-gradient(180deg,#0e1012,#08090b);
               border:1px solid rgba(196,201,212,.18);border-radius:18px;
               overflow:hidden;max-width:560px;width:100%;">

        <!-- Cabeçalho -->
        <tr>
          <td style="padding:22px 28px 18px;border-bottom:1px solid rgba(196,201,212,.10);">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="width:42px;height:42px;border-radius:50%;
                         border:1.5px solid rgba(196,201,212,.35);
                         text-align:center;vertical-align:middle;
                         background:#0a0c0f;color:#c4c9d4;
                         font-weight:900;font-size:11px;">RM</td>
              <td style="padding-left:12px;color:#c4c9d4;font-size:14px;
                         font-weight:900;letter-spacing:.12em;">REALMETROPOLIS</td>
            </tr></table>
          </td>
        </tr>

        <!-- Corpo -->
        <tr><td style="padding:28px 28px 24px;">

          <p style="font-size:36px;margin:0 0 12px;">✅</p>
          <p style="color:#edf0f5;font-size:20px;font-weight:900;margin:0 0 8px;">
            Conta Aprovada!
          </p>
          <p style="color:#8b95a2;font-size:13px;margin:0 0 22px;line-height:1.55;">
            A candidatura de
            <b style="color:#c4c9d4;">${String(empresa || "—")}</b>
            foi validada com sucesso pela equipa REALMETROPOLIS.
          </p>
          <p style="color:#8b95a2;font-size:13px;margin:0 0 22px;line-height:1.55;">
            Clique no botão abaixo para definir a sua senha e
            ativar o acesso ao portal de Gestor de Frota.
          </p>

          <!-- BOTÃO PRATA — ATIVAR CONTA -->
          <table cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
            <tr><td>
              <a href="${linkSenha}"
                style="display:inline-block;
                       background:linear-gradient(180deg,#e0e4ea,#bec6d1);
                       color:#07080a;text-decoration:none;
                       padding:14px 34px;border-radius:13px;
                       font-weight:900;font-size:14px;letter-spacing:.06em;
                       box-shadow:0 4px 16px rgba(0,0,0,.4),
                                  inset 0 1px 0 rgba(255,255,255,.6);">
                ATIVAR CONTA
              </a>
            </td></tr>
          </table>

          <p style="color:#434a55;font-size:11px;margin:0 0 5px;">
            Ou copie este link:
          </p>
          <p style="word-break:break-all;color:#6b7585;font-size:11px;margin:0 0 22px;">
            ${linkSenha}
          </p>
          <p style="color:#434a55;font-size:11px;
                    border-top:1px solid rgba(196,201,212,.08);
                    padding-top:14px;margin:0;">
            Este link expira em 24 horas.
            Após ativar, aceda sempre pelo portal de login.
          </p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({ from, to, subject, html });
}

/* ================================================================
   HELPERS
================================================================ */
function normalizeEmail(v) { return String(v || "").trim().toLowerCase(); }
function isEmailValid(v)   { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim()); }

/* ================================================================
   POST /api/admin/convites
   Cria convite e envia EMAIL 1 (COMPLETAR REGISTO)
================================================================ */
router.post("/convites", requireAdminMaster, async (req, res) => {
  try {
    const empresa  = String(req.body?.empresa  || "").trim();
    const nif      = String(req.body?.nif      || "").trim();
    const contacto = String(req.body?.contacto || "").trim();
    const email    = normalizeEmail(req.body?.email);
    const tipo     = String(req.body?.tipo     || "").trim().toLowerCase();

    if (!empresa || !nif || !contacto || !email || !tipo) {
      return res.status(400).json({ ok: false, message: "Campos obrigatórios: empresa, nif, contacto, email, tipo." });
    }
    if (!["frota", "hotel", "alojamento"].includes(tipo)) {
      return res.status(400).json({ ok: false, message: "Tipo inválido." });
    }
    if (!isEmailValid(email)) {
      return res.status(400).json({ ok: false, message: "Email inválido." });
    }

    const token     = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 72); // 72h

    const convite = await ConviteParceiro.create({
      empresa, nif, contacto, email, tipo,
      tokenHash, expiresAt,
      status: "pendente",
      enviadoEm: new Date(),
    });

    const baseUrl = String(process.env.PUBLIC_BASE_URL || "http://localhost:10000").trim();

    // Link para página de registo correta por tipo
    const paginaRegisto = tipo === "frota"
      ? "convite-registo-gestor.html"
      : "convite-registo-colaborador.html";
    const link = `${baseUrl}/${paginaRegisto}?token=${encodeURIComponent(token)}`;

    // Enviar EMAIL 1 — convite com dados pré-preenchidos
    await sendInviteEmail({ to: email, link, empresa, nif, contacto, tipo });

    return res.json({
      ok: true,
      message: "Convite enviado com sucesso!",
      convite: {
        id:         String(convite._id),
        empresa, nif, contacto, email, tipo,
        status:     convite.status,
        bloqueado:  convite.bloqueado,
        enviadoEm:  convite.enviadoEm,
        expiresAt:  convite.expiresAt,
      }
    });
  } catch (err) {
    console.error("❌ POST /api/admin/convites:", err);
    return res.status(500).json({ ok: false, message: "Erro ao enviar convite." });
  }
});

/* ================================================================
   GET /api/admin/convites
================================================================ */
router.get("/convites", requireAdminMaster, async (req, res) => {
  const list = await ConviteParceiro.find().sort({ createdAt: -1 }).lean();
  res.json({ ok: true, convites: list });
});

/* ================================================================
   PATCH /api/admin/convites/:id
   Quando status → "aprovado": envia EMAIL 2 (ATIVAR CONTA)
================================================================ */
router.patch("/convites/:id", requireAdminMaster, async (req, res) => {
  const { id } = req.params;
  const patch = {};
  if (req.body?.status)                         patch.status          = req.body.status;
  if (typeof req.body?.bloqueado === "boolean")  patch.bloqueado       = req.body.bloqueado;
  if (req.body?.motivoBloqueio !== undefined)    patch.motivoBloqueio  = String(req.body.motivoBloqueio || "");

  const doc = await ConviteParceiro.findByIdAndUpdate(id, { $set: patch }, { new: true });
  if (!doc) return res.status(404).json({ ok: false, message: "Convite não encontrado." });

  // Aprovação → gerar token de senha e enviar EMAIL 2
  if (req.body?.status === "aprovado" && doc.email) {
    try {
      const tokenSenha    = crypto.randomBytes(32).toString("hex");
      const tokenSenhaHash = crypto.createHash("sha256").update(tokenSenha).digest("hex");
      const tokenSenhaExp  = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h

      await ConviteParceiro.findByIdAndUpdate(id, {
        $set: {
          tokenSenhaHash,
          tokenSenhaExpires: tokenSenhaExp,
          aprovadoEm: new Date(),
        }
      });

      const baseUrl   = String(process.env.PUBLIC_BASE_URL || "http://localhost:10000").trim();
      const linkSenha = `${baseUrl}/colaborador-definir-senha.html?token=${encodeURIComponent(tokenSenha)}`;

      // Enviar EMAIL 2 — aprovação com link para definir senha
      await sendApprovalEmail({ to: doc.email, empresa: doc.empresa, linkSenha });

      console.log(`✅ Email de aprovação enviado para ${doc.email}`);
    } catch (err) {
      console.error("❌ Erro ao enviar email de aprovação:", err);
      // Não falha o PATCH — admin pode reenviar manualmente
    }
  }

  res.json({ ok: true, convite: doc });
});

/* ================================================================
   GET /api/admin/convites/verificar-token-senha?token=...
   Valida token de ativação (usado por colaborador-definir-senha.html)
================================================================ */
router.get("/convites/verificar-token-senha", async (req, res) => {
  const token = String(req.query?.token || "").trim();
  if (!token) return res.status(400).json({ ok: false, message: "Token em falta." });

  const hash = crypto.createHash("sha256").update(token).digest("hex");

  const doc = await ConviteParceiro.findOne({
    tokenSenhaHash:    hash,
    tokenSenhaExpires: { $gt: new Date() },
    status:            "aprovado",
  }).lean();

  if (!doc) return res.status(400).json({ ok: false, message: "Link inválido ou expirado." });
  return res.json({ ok: true, empresa: doc.empresa, email: doc.email });
});

export default router;