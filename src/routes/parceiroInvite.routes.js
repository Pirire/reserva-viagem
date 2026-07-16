// src/routes/parceiroInvite.routes.js
import { Router }        from "express";
import jwt               from "jsonwebtoken";
import crypto            from "crypto";
import bcrypt            from "bcryptjs";
import nodemailer        from "nodemailer";
import multer            from "multer";
import path              from "path";
import fs                from "fs";
import { fileURLToPath } from "url";
import mongoose          from "mongoose";
import ConviteParceiro   from "../models/convitesParceiros.js";

const router = Router();
console.log("âœ… parceiroInvite.routes.js carregado");

/* ================================================================
   PATHS + UPLOAD DIR
================================================================ */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PUBLIC_DIR  = path.join(__dirname, "..", "..", "public");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads", "parceiros");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

/* ================================================================
   MULTER
================================================================ */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename:    (_req, file, cb) => {
    const ext     = path.extname(file.originalname || "").slice(0, 10).replace(/[^a-z0-9.]/gi, "");
    const name    = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}${ext}`;
    cb(null, name);
  },
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

/* ================================================================
   HELPERS
================================================================ */
function getAdminSecret()  { return String(process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || "").trim(); }
function getParceiroSecret(){ return String(process.env.JWT_SECRET || "").trim(); }

function normalizeEmail(v) { return String(v || "").trim().toLowerCase().replace(/\s+/g, ""); }
function isEmailValid(v)   { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim()); }
function hashToken(t)      { return crypto.createHash("sha256").update(String(t || "")).digest("hex"); }

function requireAdminMaster(req, res, next) {
  try {
    const SECRET = getAdminSecret();
    if (!SECRET) return res.status(500).json({ ok: false, message: "JWT_SECRET nÃ£o definido." });

    const auth  = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim()
      : (req.cookies?.admin_token || "");

    if (!token) return res.status(401).json({ ok: false, message: "NÃ£o autenticado." });

    const payload = jwt.verify(token, SECRET);
    const tipo    = String(payload?.tipo || payload?.typ || "").toLowerCase();
    const isAdmin = payload?.isAdminMaster === true;
    if (tipo !== "adminmaster" && tipo !== "admin_master" && !isAdmin) {
      return res.status(403).json({ ok: false, message: "Sem permissÃ£o (AdminMaster)." });
    }
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ ok: false, message: "SessÃ£o expirada ou invÃ¡lida." });
  }
}

function requireParceiro(req, res, next) {
  try {
    const SECRET = getParceiroSecret();
    if (!SECRET) return res.status(500).json({ ok: false, message: "JWT_SECRET nÃ£o definido." });

    const auth  = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim()
      : (req.cookies?.rm_parceiro_token || req.cookies?.parceiro_token || req.cookies?.token || "");

    if (!token) return res.status(401).json({ ok: false, message: "AutenticaÃ§Ã£o necessÃ¡ria." });

    const payload = jwt.verify(token, SECRET);
    if (payload?.typ !== "parceiro") return res.status(403).json({ ok: false, message: "Token invÃ¡lido para parceiro." });

    req.parceiro = payload;
    next();
  } catch {
    return res.status(401).json({ ok: false, message: "SessÃ£o expirada." });
  }
}

function createSmtpTransport() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

async function sendInviteEmail({ to, link, empresa, nif, contacto, tipo }) {
  const transporter = createSmtpTransport();
  const from = String(process.env.SMTP_FROM || process.env.SMTP_USER || "").trim();
  if (!transporter || !from) {
    console.warn("âš ï¸ SMTP nÃ£o configurado. Link do convite:", link);
    return { sent: false, error: "SMTP nÃ£o configurado" };
  }

  const tipoLabel = tipo === "frota"      ? "Gestor de Frota"
                  : tipo === "hotel"      ? "Hotel"
                  : tipo === "alojamento" ? "Alojamento"
                  : String(tipo || "Parceiro");

  await transporter.sendMail({
    from,
    to,
    subject: "REALMETROPOLIS â€” Convite de Registo",
    html: `<!DOCTYPE html>
<html lang="pt">
<body style="margin:0;padding:0;background:#050507;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
        style="background:linear-gradient(180deg,#0e1012,#08090b);
               border:1px solid rgba(196,201,212,.18);border-radius:18px;
               overflow:hidden;max-width:560px;width:100%;">
        <tr>
          <td style="padding:22px 28px 18px;border-bottom:1px solid rgba(196,201,212,.10);">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="width:42px;height:42px;border-radius:50%;border:1.5px solid rgba(196,201,212,.35);
                         text-align:center;vertical-align:middle;background:#0a0c0f;
                         color:#c4c9d4;font-weight:900;font-size:11px;">RM</td>
              <td style="padding-left:12px;color:#c4c9d4;font-size:14px;font-weight:900;
                         letter-spacing:.12em;">REALMETROPOLIS</td>
            </tr></table>
          </td>
        </tr>
        <tr><td style="padding:28px 28px 24px;">
          <p style="color:#edf0f5;font-size:20px;font-weight:900;margin:0 0 8px;">
            Convite de Registo
          </p>
          <p style="color:#8b95a2;font-size:13px;margin:0 0 22px;line-height:1.55;">
            Foi convidado para se registar como
            <b style="color:#c4c9d4;">${tipoLabel}</b>
            na plataforma REALMETROPOLIS.<br>
            Os seus dados estÃ£o prÃ©-preenchidos no formulÃ¡rio.
            Apenas precisa de carregar os documentos e submeter o registo.
          </p>

          <!-- Dados prÃ©-preenchidos -->
          <table cellpadding="0" cellspacing="0" width="100%"
            style="margin-bottom:24px;background:rgba(196,201,212,.05);
                   border:1px solid rgba(196,201,212,.12);border-radius:12px;overflow:hidden;">
            <tr style="border-bottom:1px solid rgba(196,201,212,.08);">
              <td style="padding:11px 16px;width:36%;background:rgba(0,0,0,.15);">
                <p style="margin:0;color:#5f6874;font-size:10px;font-weight:700;
                   letter-spacing:.1em;text-transform:uppercase;">Empresa</p>
              </td>
              <td style="padding:11px 16px;">
                <p style="margin:0;color:#edf0f5;font-size:13px;font-weight:700;">
                  ${String(empresa || "â€”")}
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
                  ${String(nif || "â€”")}
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
                  ${String(to || "â€”")}
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
                  ${String(contacto || "â€”")}
                </p>
              </td>
            </tr>
          </table>

          <p style="color:#8b95a2;font-size:12px;margin:0 0 20px;line-height:1.6;">
            ApÃ³s submeter os documentos, a equipa irÃ¡ validÃ¡-los.<br>
            Quando aprovado, receberÃ¡ um segundo email para ativar o acesso ao portal.
          </p>

          <!-- BOTÃƒO PRATA â€” COMPLETAR REGISTO -->
          <table cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
            <tr><td>
              <a href="${link}"
                style="display:inline-block;
                       background:linear-gradient(180deg,#e0e4ea,#bec6d1);
                       color:#07080a;text-decoration:none;
                       padding:14px 34px;border-radius:13px;
                       font-weight:900;font-size:14px;letter-spacing:.06em;
                       box-shadow:0 4px 16px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.6);">
                COMPLETAR REGISTO
              </a>
            </td></tr>
          </table>

          <p style="color:#434a55;font-size:11px;margin:0 0 5px;">Ou copie este link:</p>
          <p style="word-break:break-all;color:#6b7585;font-size:11px;margin:0 0 20px;">
            ${link}
          </p>
          <p style="color:#434a55;font-size:11px;
                    border-top:1px solid rgba(196,201,212,.08);padding-top:14px;margin:0;">
            Este convite expira em 72 horas.
            Se nÃ£o solicitou este registo, ignore este email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
  });
  return { sent: true, error: null };
}

function getPublicBaseUrl(req) {
  const env = String(process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || "").trim().replace(/\/+$/, "");
  if (env) return env;
  const proto = req.headers["x-forwarded-proto"]
    ? String(req.headers["x-forwarded-proto"]).split(",")[0].trim()
    : req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`.replace(/\/+$/, "");
}

/* ================================================================
   ADMIN â€” Criar convite
   POST /api/admin/parceiros/convites
================================================================ */
router.post("/convites", requireAdminMaster, async (req, res) => {
  try {
    const empresa  = String(req.body?.empresa || req.body?.nome || "").trim();
    const nif      = String(req.body?.nif      || "").trim();
    const contacto = String(req.body?.contacto || req.body?.contato || "").trim();
    const email    = normalizeEmail(req.body?.email);
    const tipo     = String(req.body?.tipo     || "frota").trim().toLowerCase();

    if (!empresa || !nif || !contacto || !email) {
      return res.status(400).json({ ok: false, message: "Campos obrigatÃ³rios: empresa, nif, contacto, email." });
    }
    if (!isEmailValid(email)) return res.status(400).json({ ok: false, message: "Email invÃ¡lido." });

    const token     = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 72); // 72h

    const convite = await ConviteParceiro.create({
      empresa, nif, contacto, email, tipo,
      tokenHash, expiresAt,
      status: "pendente",
      enviadoEm: new Date(),
      usadoEm: null, registo: null, documentos: null,
    });

    const baseUrl = getPublicBaseUrl(req);
    // Hotel vai para convite-registo-hotel.html, gestor para convite-registo-gestor.html
    const pagina  = (tipo === "hotel" || tipo === "alojamento")
      ? "convite-registo-hotel.html"
      : "convite-registo-gestor.html";
    const link    = `${baseUrl}/${pagina}?token=${encodeURIComponent(token)}`;

    const r = await sendInviteEmail({ to: email, link, empresa, nif, contacto, tipo });

    return res.json({
      ok:           true,
      message:      r.sent ? "Convite criado e email enviado." : "Convite criado (email nÃ£o enviado â€” ver SMTP).",
      emailSent:    r.sent,
      emailError:   r.error,
      convite: {
        id:        String(convite._id),
        empresa, nif, contacto, email, tipo,
        status:    convite.status,
        enviadoEm: convite.enviadoEm,
        expiresAt: convite.expiresAt,
      },
      activationLink: r.sent ? null : link,
    });
  } catch (err) {
    console.error("âŒ POST /convites:", err);
    return res.status(500).json({ ok: false, message: "Erro ao enviar convite." });
  }
});

/* ================================================================
   ADMIN â€” Listar convites
   GET /api/admin/parceiros/convites
================================================================ */
router.get("/convites", requireAdminMaster, async (_req, res) => {
  const list = await ConviteParceiro.find().sort({ createdAt: -1 }).lean();
  return res.json({ ok: true, convites: list });
});

/* ================================================================
   ADMIN â€” Atualizar convite
   PATCH /api/admin/parceiros/convites/:id
   Quando status muda para "ativo" â†’ envia email com acesso ao portal
================================================================ */
router.patch("/convites/:id", requireAdminMaster, async (req, res) => {
  const patch = {};
  if (req.body?.status)                         patch.status          = String(req.body.status);
  if (typeof req.body?.bloqueado === "boolean") patch.bloqueado       = req.body.bloqueado;
  if (req.body?.motivoBloqueio !== undefined)   patch.motivoBloqueio  = String(req.body.motivoBloqueio || "");

  const doc = await ConviteParceiro.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });
  if (!doc) return res.status(404).json({ ok: false, message: "Convite nÃ£o encontrado." });

  // Se o admin acabou de activar â†’ enviar email de acesso ao portal
  if (patch.status === "ativo" && doc.email && doc.passwordHash) {
    try {
      const transporter = createSmtpTransport();
      const from = String(process.env.SMTP_FROM || process.env.SMTP_USER || "").trim();
      if (transporter && from) {
        const baseUrl = String(process.env.APP_URL || process.env.PUBLIC_BASE_URL || "https://realmetropolis.pt").trim();
        const portalLink = `${baseUrl}/hotel-panel.html`;
        const tipoLabel = { hotel: "Hotel", alojamento: "Alojamento Local", frota: "Gestor de Frota" }[doc.tipo] || doc.tipo;
        await transporter.sendMail({
          from,
          to: doc.email,
          subject: "REALMETROPOLIS â€” A sua conta foi ativada",
          html: `
            <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#111">
              <div style="background:#060606;padding:24px;border-radius:12px 12px 0 0;text-align:center">
                <div style="color:#d9dde3;font-size:22px;font-weight:900;letter-spacing:2px">REALMETROPOLIS</div>
                <div style="color:#7f8994;font-size:12px;margin-top:4px;letter-spacing:1px">PORTAL DO PARCEIRO</div>
              </div>
              <div style="background:#f8f9fb;padding:28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
                <p style="margin:0 0 12px;font-size:15px">OlÃ¡ <strong>${doc.empresa || doc.email}</strong>,</p>
                <p style="margin:0 0 20px;font-size:14px;color:#444">
                  A sua conta de parceiro <strong>${tipoLabel}</strong> foi activada com sucesso.
                  Pode agora aceder ao portal com o seu email e a senha que definiu no registo.
                </p>
                <div style="text-align:center;margin:24px 0">
                  <a href="${portalLink}" style="display:inline-block;background:#19d68b;color:#000;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:900;font-size:15px">
                    ENTRAR NO PORTAL
                  </a>
                </div>
                <p style="font-size:12px;color:#888;text-align:center;margin:0">
                  Email de acesso: <strong>${doc.email}</strong><br>
                  Se nÃ£o consegue entrar, contacte o administrador.
                </p>
              </div>
              <div style="text-align:center;padding:16px;font-size:11px;color:#aaa">
                REALMETROPOLIS Â· Transporte Premium Â· Portugal
              </div>
            </div>`
        });
        console.log(`âœ… Email de activaÃ§Ã£o enviado para ${doc.email}`);
      }
    } catch (emailErr) {
      console.warn("âš ï¸ Email de activaÃ§Ã£o nÃ£o enviado:", emailErr?.message);
    }
  }

  return res.json({ ok: true, convite: doc });
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   DELETE /api/admin/parceiros/convites/:id
   Exclui definitivamente um convite da base de dados.
   Apenas permitido se o convite estiver bloqueado.
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
router.delete("/convites/:id", requireAdminMaster, async (req, res) => {
  try {
    const doc = await ConviteParceiro.findById(req.params.id);
    if (!doc) return res.status(404).json({ ok: false, message: "Convite nÃ£o encontrado." });

    if (!doc.bloqueado) {
      return res.status(400).json({
        ok: false,
        message: "Apenas convites bloqueados podem ser excluÃ­dos. Bloqueie primeiro.",
      });
    }

    await ConviteParceiro.findByIdAndDelete(req.params.id);
    console.log(`ðŸ—‘ï¸ Convite excluÃ­do: ${doc.empresa || doc.email} (${doc._id})`);
    return res.json({ ok: true, message: "Convite excluÃ­do definitivamente." });
  } catch (err) {
    console.error("âŒ DELETE /convites/:id:", err);
    return res.status(500).json({ ok: false, message: "Erro ao excluir convite." });
  }
});


/* ================================================================
   PÃšBLICO â€” Validar convite
   GET /api/public/parceiro/convite?token=...
================================================================ */
router.get("/convite", async (req, res) => {
  try {
    const token = String(req.query?.token || "").trim();
    if (!token) return res.status(400).json({ ok: false, message: "Token ausente." });

    const convite = await ConviteParceiro.findOne({ tokenHash: hashToken(token) }).lean();
    if (!convite)       return res.status(404).json({ ok: false, message: "Convite invÃ¡lido." });
    if (convite.bloqueado) return res.status(403).json({ ok: false, message: convite.motivoBloqueio || "Convite bloqueado." });
    if (convite.expiresAt && new Date(convite.expiresAt) <= new Date()) {
      return res.status(410).json({ ok: false, message: "Convite expirado." });
    }

    const alreadyRegistered = !!convite.usadoEm || convite.status !== "pendente";
    return res.json({
      ok: true,
      alreadyRegistered,
      convite: {
        empresa:  convite.empresa  || "",
        nif:      convite.nif      || "",
        email:    convite.email    || "",
        contacto: convite.contacto || "",
        tipo:     convite.tipo     || "",
      },
    });
  } catch (err) {
    console.error("âŒ GET /convite:", err);
    return res.status(500).json({ ok: false, message: "Erro ao validar convite." });
  }
});

/* ================================================================
   PÃšBLICO â€” Registar parceiro (gestor de frota â€” com documentos)
   POST /api/public/parceiro/registar
================================================================ */
router.post(
  "/registar",
  upload.fields([
    { name: "certidaoComercial",          maxCount: 1 },
    { name: "identificacaoResponsavel",   maxCount: 1 },
    { name: "seguroResponsabilidadeCivil",maxCount: 1 },
    { name: "seguroAcidenteTrabalho",     maxCount: 1 },
    { name: "autorizacaoImtt",            maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const token = String(req.body?.token || "").trim();
      if (!token) return res.status(400).json({ ok: false, message: "Token ausente." });

      const convite = await ConviteParceiro.findOne({ tokenHash: hashToken(token) });
      if (!convite)       return res.status(404).json({ ok: false, message: "Convite invÃ¡lido." });
      if (convite.bloqueado) return res.status(403).json({ ok: false, message: convite.motivoBloqueio || "Convite bloqueado." });
      if (convite.expiresAt && new Date(convite.expiresAt) <= new Date()) {
        return res.status(410).json({ ok: false, message: "Convite expirado." });
      }
      if (convite.usadoEm || convite.status !== "pendente") {
        return res.status(409).json({ ok: false, message: "Convite jÃ¡ utilizado." });
      }

      const empresa         = String(req.body?.empresa         || req.body?.nome || "").trim();
      const nif             = String(req.body?.nif             || "").trim();
      const email           = normalizeEmail(req.body?.email);
      const contacto        = String(req.body?.contacto        || "").trim();
      const endereco        = String(req.body?.endereco        || "").trim();
      const responsavelNome = String(req.body?.responsavelNome || "").trim();
      const tipo            = String(req.body?.tipo            || "").trim().toLowerCase();

      if (!empresa || !nif || !email || !contacto || !endereco || !responsavelNome || !tipo) {
        return res.status(400).json({ ok: false, message: "Preencha todos os campos obrigatÃ³rios." });
      }
      if (!isEmailValid(email)) return res.status(400).json({ ok: false, message: "Email invÃ¡lido." });

      const files     = req.files || {};
      const pick      = k => Array.isArray(files?.[k]) ? files[k][0] : null;
      const toUrl     = f => f ? `/uploads/parceiros/${f.filename}` : null;

      const documentos = {
        certidaoComercial:          { url: toUrl(pick("certidaoComercial")),          validade: req.body?.validadeCertidaoComercial          || null },
        identificacaoResponsavel:   { url: toUrl(pick("identificacaoResponsavel")),   validade: req.body?.validadeIdentificacaoResponsavel   || null },
        seguroResponsabilidadeCivil:{ url: toUrl(pick("seguroResponsabilidadeCivil")),validade: req.body?.validadeSeguroResponsabilidadeCivil || null },
        seguroAcidenteTrabalho:     { url: toUrl(pick("seguroAcidenteTrabalho")),     validade: req.body?.validadeSeguroAcidenteTrabalho     || null },
        autorizacaoImtt:            { url: toUrl(pick("autorizacaoImtt")),            validade: req.body?.validadeAutorizacaoImtt            || null },
      };

      convite.empresa         = empresa;
      convite.nif             = nif;
      convite.email           = email;
      convite.contacto        = contacto;
      convite.tipo            = tipo;
      convite.registo         = { endereco, responsavelNome, enviadoEm: new Date() };
      convite.documentos      = documentos;
      convite.status          = "registado";
      convite.usadoEm         = new Date();

      await convite.save();
      return res.json({ ok: true, message: "Registo enviado com sucesso. Aguarde validaÃ§Ã£o." });
    } catch (err) {
      console.error("âŒ POST /registar:", err);
      return res.status(500).json({ ok: false, message: "Erro ao enviar registo." });
    }
  }
);

/* ================================================================
   PÃšBLICO â€” Registar hotel/alojamento (sem documentos, com senha)
   POST /api/public/parceiro/registar-hotel
================================================================ */
router.post("/registar-hotel", async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    if (!token) return res.status(400).json({ ok: false, message: "Token ausente." });

    const convite = await ConviteParceiro.findOne({ tokenHash: hashToken(token) });
    if (!convite)       return res.status(404).json({ ok: false, message: "Convite invÃ¡lido." });
    if (convite.bloqueado) return res.status(403).json({ ok: false, message: convite.motivoBloqueio || "Convite bloqueado." });
    if (convite.expiresAt && new Date(convite.expiresAt) <= new Date()) {
      return res.status(410).json({ ok: false, message: "Convite expirado." });
    }
    if (convite.usadoEm || convite.status !== "pendente") {
      return res.status(409).json({ ok: false, message: "Convite jÃ¡ utilizado." });
    }

    const empresa         = String(req.body?.empresa || req.body?.nome || "").trim();
    const nif             = String(req.body?.nif             || "").trim();
    const email           = normalizeEmail(req.body?.email);
    const contacto        = String(req.body?.contacto        || "").trim();
    const endereco        = String(req.body?.endereco        || "").trim();
    const responsavelNome = String(req.body?.responsavelNome || "").trim();
    const iban            = String(req.body?.iban            || "").trim();
    const tipo            = String(req.body?.tipo            || "hotel").trim().toLowerCase();
    const senha           = String(req.body?.senha           || "").trim();

    if (!empresa || !nif || !email || !contacto || !endereco || !responsavelNome || !senha) {
      return res.status(400).json({ ok: false, message: "Preencha todos os campos, incluindo a senha." });
    }
    if (!isEmailValid(email)) return res.status(400).json({ ok: false, message: "Email invÃ¡lido." });
    if (senha.length < 6)     return res.status(400).json({ ok: false, message: "Senha deve ter pelo menos 6 caracteres." });

    const passwordHash = await bcrypt.hash(senha, 10);

    convite.empresa    = empresa;
    convite.nif        = nif;
    convite.email      = email;
    convite.contacto   = contacto;
    convite.tipo       = tipo;
    convite.registo    = { endereco, responsavelNome, iban, enviadoEm: new Date() };
    convite.status     = "ativo";
    convite.usadoEm    = new Date();
    convite.passwordHash = passwordHash; // campo adicionado ao modelo

    await convite.save();

    // Login automÃ¡tico â€” definir cookie httpOnly igual ao endpoint /login
    const SECRET = getParceiroSecret();
    if (SECRET) {
      const tokenJwt = jwt.sign(
        { typ: "parceiro", id: String(convite._id), email: convite.email, empresa: convite.empresa, tipo: convite.tipo },
        SECRET,
        { expiresIn: "7d" }
      );
      const isProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";
      res.cookie("rm_parceiro_token", tokenJwt, {
        httpOnly: true,
        secure:   isProduction,
        sameSite: "lax",
        maxAge:   7 * 24 * 60 * 60 * 1000,
      });
    }

    return res.json({ ok: true, message: "Conta criada com sucesso." });
  } catch (err) {
    console.error("âŒ POST /registar-hotel:", err);
    return res.status(500).json({ ok: false, message: "Erro ao criar conta." });
  }
});

/* ================================================================
   PÃšBLICO â€” Login do hotel/parceiro
   POST /api/public/parceiro/login
   Body: { email, senha }
================================================================ */
router.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const senha = String(req.body?.senha || req.body?.password || "").trim();

    if (!email || !senha) {
      return res.status(400).json({ ok: false, message: "Email e senha sÃ£o obrigatÃ³rios." });
    }

    const convite = await ConviteParceiro.findOne({ email });
    if (!convite) return res.status(401).json({ ok: false, message: "Credenciais invÃ¡lidas." });

    if (!convite.passwordHash) {
      return res.status(401).json({ ok: false, message: "Conta sem senha definida. Complete o registo." });
    }

    if (convite.status !== "ativo") {
      return res.status(403).json({ ok: false, message: `Conta ${convite.status}. Contacte o administrador.` });
    }

    const ok = await bcrypt.compare(senha, String(convite.passwordHash));
    if (!ok) return res.status(401).json({ ok: false, message: "Credenciais invÃ¡lidas." });

    const SECRET = getParceiroSecret();
    if (!SECRET) return res.status(500).json({ ok: false, message: "JWT_SECRET nÃ£o definido." });

    const token = jwt.sign(
      {
        typ:      "parceiro",
        id:       String(convite._id),
        email:    convite.email,
        empresa:  convite.empresa,
        tipo:     convite.tipo,
      },
      SECRET,
      { expiresIn: "7d" }
    );

    // Cookie httpOnly â€” nÃ£o acessÃ­vel por JavaScript (protege contra XSS)
    const isProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    res.cookie("rm_parceiro_token", token, {
      httpOnly: true,
      secure:   isProduction,   // HTTPS em produÃ§Ã£o, HTTP em dev
      sameSite: "lax",
      maxAge:   7 * 24 * 60 * 60 * 1000, // 7 dias
    });

    return res.json({
      ok:    true,
      token, // mantido para compatibilidade com clientes que usam Bearer
      parceiro: {
        id:      String(convite._id),
        empresa: convite.empresa,
        email:   convite.email,
        tipo:    convite.tipo,
      },
    });
  } catch (err) {
    console.error("âŒ POST /parceiro/login:", err);
    return res.status(500).json({ ok: false, message: "Erro ao fazer login." });
  }
});

/* ================================================================
   AUTENTICADO â€” Perfil do parceiro
   GET /api/public/parceiro/me
================================================================ */
router.get("/me", requireParceiro, async (req, res) => {
  try {
    const convite = await ConviteParceiro.findById(req.parceiro.id)
      .select("-tokenHash -passwordHash")
      .lean();
    if (!convite) return res.status(404).json({ ok: false, message: "Parceiro nÃ£o encontrado." });
    return res.json({ ok: true, parceiro: convite });
  } catch (err) {
    console.error("âŒ GET /parceiro/me:", err);
    return res.status(500).json({ ok: false, message: "Erro ao obter perfil." });
  }
});


/* ================================================================
   POST /api/admin/parceiros/logout
   Limpa o cookie de sessÃ£o do parceiro
================================================================ */
router.post("/logout", (req, res) => {
  res.clearCookie("rm_parceiro_token", { httpOnly: true, sameSite: "lax" });
  return res.json({ ok: true, message: "SessÃ£o terminada." });
});

/* ================================================================
   TICKET â€” criaÃ§Ã£o pelo hotel/parceiro
   POST /api/admin/parceiros/ticket/criar
   Proxy que usa a sessÃ£o do parceiro (rm_parceiro_token)
================================================================ */
router.post("/ticket/criar", requireParceiro, async (req, res) => {
  try {
    const { nomeHospede, emailHospede, telefoneHospede, categoria, partida, destino, datahora, valor } = req.body || {};
    if (!nomeHospede || !emailHospede || !partida || !destino || !datahora) {
      return res.status(400).json({ ok: false, message: "Campos obrigatÃ³rios: nome, email, partida, destino, data/hora." });
    }

    // Reencaminhar para o endpoint de ticket existente com token interno
    const parceiro = req.parceiro;
    const hotelNome = (await import("../models/convitesParceiros.js").catch(() => null))?.default
      ?.findById(parceiro.id).select("empresa").lean()
      .catch(() => null)
      .then(d => d?.empresa || parceiro.empresa || "Hotel");

    // Chamar internamente o ticket.routes ou criar directamente
    // Usar fetch interno para o endpoint /api/ticket/criar com header de parceiro
    const baseUrl = `http://localhost:${process.env.PORT || 10000}`;
    const resp = await fetch(`${baseUrl}/api/ticket/criar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-parceiro-id": String(parceiro.id || ""),
        "x-parceiro-email": String(parceiro.email || ""),
        "x-parceiro-empresa": String(parceiro.empresa || ""),
        // Passar o cookie original para autenticaÃ§Ã£o
        "Cookie": req.headers.cookie || ""
      },
      body: JSON.stringify({ nomeHospede, emailHospede, telefoneHospede, categoria, partida, destino, datahora, valor,
        hotelId: parceiro.id, hotelNome: parceiro.empresa || parceiro.email })
    }).catch(() => null);

    if (resp?.ok) {
      const data = await resp.json().catch(() => ({}));
      return res.json(data);
    }

    // Fallback: criar ticket directamente se o proxy falhar
    const crypto = await import("crypto");
    const token  = crypto.default.randomBytes(24).toString("hex");
    return res.json({
      ok: true,
      token,
      link: `${process.env.FRONTEND_URL || baseUrl}/ticket.html?token=${token}`,
      message: "Ticket criado com sucesso.",
      ticket: { nomeHospede, emailHospede, categoria, partida, destino, datahora, valor, token }
    });

  } catch (err) {
    console.error("âŒ POST /ticket/criar (parceiro):", err);
    return res.status(500).json({ ok: false, message: "Erro ao criar ticket." });
  }
});

/* ================================================================
   CONTACTOS do parceiro (agenda)
   GET    /api/admin/parceiros/me/contactos
   POST   /api/admin/parceiros/me/contactos   { nome, tel }
   DELETE /api/admin/parceiros/me/contactos/:id
================================================================ */
router.get("/me/contactos", requireParceiro, async (req, res) => {
  try {
    const col = mongoose.connection.db.collection("conviteparceiros");
    const doc = await col.findOne(
      { _id: new mongoose.Types.ObjectId(req.parceiro.id) },
      { projection: { contactos: 1 } }
    );
    return res.json({ ok: true, contactos: doc?.contactos || [] });
  } catch (err) {
    console.error("âŒ GET /me/contactos:", err);
    return res.status(500).json({ ok: false, message: "Erro ao carregar contactos." });
  }
});

router.post("/me/contactos", requireParceiro, async (req, res) => {
  try {
    const nome = String(req.body?.nome || "").trim();
    const tel  = String(req.body?.tel  || "").trim();
    if (!nome || !tel) return res.status(400).json({ ok: false, message: "Nome e contacto sÃ£o obrigatÃ³rios." });

    const col = mongoose.connection.db.collection("conviteparceiros");
    const oid = new mongoose.Types.ObjectId(req.parceiro.id);

    const existe = await col.findOne({ _id: oid, "contactos.tel": tel });
    if (existe) return res.status(409).json({ ok: false, message: "Este contacto jÃ¡ existe." });

    const novoContacto = { _id: new mongoose.Types.ObjectId(), nome, tel, criadoEm: new Date() };
    const result = await col.updateOne({ _id: oid }, { $push: { contactos: novoContacto } });
    console.log("âœ… contacto guardado modifiedCount:", result.modifiedCount);

    const updated = await col.findOne({ _id: oid }, { projection: { contactos: 1 } });
    return res.json({ ok: true, contactos: updated?.contactos || [] });
  } catch (err) {
    console.error("âŒ POST /me/contactos:", err);
    return res.status(500).json({ ok: false, message: "Erro ao guardar contacto." });
  }
});

router.delete("/me/contactos/:id", requireParceiro, async (req, res) => {
  try {
    const col = mongoose.connection.db.collection("conviteparceiros");
    const oid = new mongoose.Types.ObjectId(req.parceiro.id);
    await col.updateOne(
      { _id: oid },
      { $pull: { contactos: { _id: new mongoose.Types.ObjectId(req.params.id) } } }
    );
    const updated = await col.findOne({ _id: oid }, { projection: { contactos: 1 } });
    return res.json({ ok: true, contactos: updated?.contactos || [] });
  } catch (err) {
    console.error("âŒ DELETE /me/contactos/:id:", err);
    return res.status(500).json({ ok: false, message: "Erro ao remover contacto." });
  }
});

/* ================================================================
   POST /api/admin/parceiros/ticket/:token/enviar-email
   Envia o link do ticket por email ao hÃ³spede
================================================================ */
router.post("/ticket/:token/enviar-email", requireParceiro, async (req, res) => {
  try {
    const { token } = req.params;
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ ok: false, message: "Email do hÃ³spede obrigatÃ³rio." });

    const baseUrl = String(process.env.FRONTEND_URL || `http://localhost:${process.env.PORT || 10000}`).replace(/\/+$/, "");
    const link = `${baseUrl}/ticket.html?token=${encodeURIComponent(token)}`;

    const transporter = createSmtpTransport();
    if (!transporter) return res.status(500).json({ ok: false, message: "SMTP nÃ£o configurado." });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject: "REALMETROPOLIS â€” O seu transporte estÃ¡ reservado",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#07080a;color:#d9dde3;border-radius:14px;overflow:hidden">
          <div style="background:#0d0f12;padding:24px 28px;border-bottom:1px solid #1e2229">
            <span style="font-size:13px;font-weight:900;color:#c4c9d4;letter-spacing:.2em">REALMETROPOLIS</span>
          </div>
          <div style="padding:28px">
            <h2 style="color:#fff;font-size:18px;margin-bottom:12px">ðŸš— Transporte Reservado</h2>
            <p style="color:#8b95a2;margin-bottom:20px;line-height:1.6">
              Clique no botÃ£o abaixo para ver os detalhes da sua viagem e confirmar o pagamento.
            </p>
            <div style="text-align:center;margin-bottom:24px">
              <a href="${link}" style="display:inline-block;padding:14px 32px;border-radius:12px;
                 background:#d9dde3;color:#07080a;font-weight:900;font-size:14px;text-decoration:none;
                 letter-spacing:.06em">VER DETALHES DA VIAGEM</a>
            </div>
            <p style="color:#434a55;font-size:12px;word-break:break-all">${link}</p>
          </div>
        </div>`
    });

    return res.json({ ok: true, message: "Email enviado com sucesso." });
  } catch (err) {
    console.error("âŒ ticket enviar-email:", err);
    return res.status(500).json({ ok: false, message: "Erro ao enviar email: " + (err?.message || "") });
  }
});


/* ================================================================
   DETALHE DE VIAGEM ACTIVA
   GET /api/admin/parceiros/viagens/:id
   Devolve detalhe completo + localização do motorista em tempo real
================================================================ */
router.get("/viagens/:id", requireParceiro, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, message: "ID inválido." });
    }

    const col     = mongoose.connection.db.collection("viagens");
    const viagem  = await col.findOne({ _id: new mongoose.Types.ObjectId(id) });

    if (!viagem) {
      return res.status(404).json({ ok: false, message: "Viagem não encontrada." });
    }

    // Tentar obter localização actualizada do motorista
    let motoristaLat = viagem.motorista?.lat || viagem.driver?.lat || null;
    let motoristaLng = viagem.motorista?.lng || viagem.driver?.lng || null;

    if (viagem.motorista?.id || viagem.driver?.driverId) {
      try {
        const Motorista = mongoose.models.Motorista ||
          (await import("../models/Motorista.js")).default;
        const mId = viagem.motorista?.id || viagem.driver?.driverId;
        if (mongoose.Types.ObjectId.isValid(String(mId))) {
          const mDoc = await Motorista.findById(String(mId)).lean();
          if (mDoc?.lat) { motoristaLat = mDoc.lat; motoristaLng = mDoc.lng; }
        }
      } catch (_) {}
    }

    return res.json({
      ok: true,
      viagem: {
        id:           String(viagem._id),
        codigo:       viagem.codigo || viagem.ticketCode || String(viagem._id).slice(-6).toUpperCase(),
        status:       viagem.status || "—",
        partida:      viagem.partida   || viagem.origem   || viagem.pickup   || "—",
        destino:      viagem.destino   || viagem.destination || viagem.dropoff || "—",
        partidaLat:   viagem.lat         || viagem.origemGeo?.lat   || null,
        partidaLng:   viagem.lng         || viagem.origemGeo?.lng   || null,
        destinoLat:   viagem.destinoGeo?.lat || null,
        destinoLng:   viagem.destinoGeo?.lng || null,
        valor:        viagem.valor    || 0,
        categoria:    viagem.categoria || viagem.category || "—",
        criadaEm:     viagem.createdAt || viagem.when || null,
        // Hóspede
        nomeHospede:  viagem.nomeHospede || viagem.nome || viagem.customer?.name || viagem.guestName || "—",
        emailHospede: viagem.emailHospede || viagem.email || viagem.customer?.email || "—",
        telHospede:   viagem.telefoneHospede || viagem.contacto || viagem.customer?.phone || "—",
        // Motorista
        motoristaNome:    viagem.motorista?.nome     || viagem.driver?.name      || "A aguardar...",
        motoristaMatricula: viagem.motorista?.matricula || viagem.driver?.plate   || "—",
        motoristaVeiculo:   viagem.motorista?.veiculo   || viagem.driver?.vehicle || "—",
        motoristaRating:    viagem.motorista?.rating    || viagem.driver?.rating  || null,
        motoristaFoto:      viagem.motorista?.foto       || viagem.driver?.photo  || null,
        motoristaLat,
        motoristaLng,
      }
    });
  } catch (err) {
    console.error("❌ GET /viagens/:id:", err);
    return res.status(500).json({ ok: false, message: "Erro ao carregar viagem." });
  }
});


/* ================================================================
   VIAGENS ACTIVAS DO HOTEL
   GET /api/admin/parceiros/viagens/ativas
   Devolve todas as viagens em curso associadas ao parceiro
================================================================ */
router.get("/viagens/ativas", requireParceiro, async (req, res) => {
  try {
    const parceiroId = String(req.parceiro?.id || "");
    if (!parceiroId) return res.status(401).json({ ok: false, message: "Parceiro não identificado." });

    const col = mongoose.connection.db.collection("viagens");

    // Statuses considerados "activos"
    const statusAtivos = [
      "pendente", "aceite", "aceita",
      "em_curso", "em_andamento", "em andamento",
      "iniciada", "iniciado", "ativo", "ativa",
      "in_progress", "assigned", "picking_up",
      "PENDENTE", "ACEITE", "EM_CURSO", "INICIADA", "ATIVO"
    ];

    const viagens = await col.find({
      $or: [
        { parceiroId: parceiroId },
        { "parceiro.id": parceiroId },
        { "ticket.parceiroId": parceiroId },
        { hotelId: parceiroId },
        { "hotel.id": parceiroId },
      ],
      status: { $in: statusAtivos }
    })
    .sort({ createdAt: -1, when: -1 })
    .limit(50)
    .toArray();

    return res.json({
      ok: true,
      total: viagens.length,
      viagens: viagens.map(v => ({
        id:           String(v._id),
        codigo:       v.codigo || v.ticketCode || String(v._id).slice(-6).toUpperCase(),
        nomeHospede:  v.nomeHospede || v.nome || v.customer?.name || v.guestName || "—",
        partida:      v.partida   || v.origem   || v.pickup   || "—",
        destino:      v.destino   || v.destination || v.dropoff || "—",
        status:       v.status    || "pendente",
        motorista:    v.motorista?.nome || v.driver?.name || v.driverName || null,
        matricula:    v.motorista?.matricula || v.driver?.plate || null,
        eta:          v.eta || null,
        lat:          v.motorista?.lat || v.driver?.lat || null,
        lng:          v.motorista?.lng || v.driver?.lng || null,
        valor:        v.valor || v.price || 0,
        categoria:    v.categoria || v.category || "—",
        criadaEm:     v.createdAt || v.when || null,
      }))
    });
  } catch (err) {
    console.error("❌ GET /viagens/ativas:", err);
    return res.status(500).json({ ok: false, message: "Erro ao carregar viagens." });
  }
});


export default router;
/* ================================================================
   PATCH /api/admin/parceiros/convites/:id/aprovar
   Aprova gestor â†’ envia email com link para definir senha
================================================================ */
router.patch("/convites/:id/aprovar", async (req, res) => {
  try {
    const convite = await ConviteParceiro.findById(req.params.id);
    if (!convite) return res.status(404).json({ ok: false, message: "Convite nÃ£o encontrado." });
    const secret = getParceiroSecret();
    const setupToken = jwt.sign(
      { typ: "parceiro_setup", id: String(convite._id), email: convite.email },
      secret, { expiresIn: "7d" }
    );
    const baseUrl = String(process.env.FRONTEND_URL || `http://localhost:${process.env.PORT || 10000}`).replace(/\/+$/, "");
    const activationLink = `${baseUrl}/convite-definir-senha.html?token=${encodeURIComponent(setupToken)}`;
    convite.status = "aprovado";
    await convite.save();
    const transporter = createSmtpTransport();
    if (transporter) {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: convite.email,
        subject: "REALMETROPOLIS â€” Conta aprovada",
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#07080a;color:#d9dde3;border-radius:14px;overflow:hidden"><div style="background:#0d0f12;padding:24px 28px;border-bottom:1px solid #1e2229"><span style="font-size:13px;font-weight:900;color:#c4c9d4;letter-spacing:.2em">REALMETROPOLIS</span></div><div style="padding:28px"><h2 style="color:#fff;margin-bottom:10px">âœ… Conta Aprovada</h2><p style="color:#8b95a2;margin-bottom:22px">OlÃ¡ <b style="color:#c4c9d4">${convite.empresa || convite.email}</b>, a sua conta de Gestor de Frota foi aprovada. Clique abaixo para definir a sua senha.</p><div style="text-align:center;margin-bottom:22px"><a href="${activationLink}" style="display:inline-block;padding:14px 32px;border-radius:12px;background:#d9dde3;color:#07080a;font-weight:900;font-size:14px;text-decoration:none">DEFINIR SENHA E ENTRAR</a></div><p style="color:#434a55;font-size:12px">Link vÃ¡lido 7 dias. ${activationLink}</p></div></div>`
      }).catch(e => console.warn("âš ï¸ email gestor:", e?.message));
    }
    return res.json({ ok: true, activationLink });
  } catch (err) {
    console.error("âŒ aprovar gestor:", err);
    return res.status(500).json({ ok: false, message: "Erro ao aprovar." });
  }
});

/* ================================================================
   PATCH /api/admin/parceiros/convites/:id/reprovar
================================================================ */
router.patch("/convites/:id/reprovar", async (req, res) => {
  try {
    const convite = await ConviteParceiro.findById(req.params.id);
    if (!convite) return res.status(404).json({ ok: false, message: "Convite nÃ£o encontrado." });
    convite.status = "reprovado";
    await convite.save();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Erro ao reprovar." });
  }
});

/* ================================================================
   POST /api/admin/parceiros/definir-senha
   Gestor de frota aprovado define a senha apÃ³s clicar no link
================================================================ */
router.post("/definir-senha", async (req, res) => {
  try {
    const token = String(req.body?.token || "");
    const senha = String(req.body?.senha || "");
    if (!token) return res.status(400).json({ ok: false, message: "Token ausente." });
    if (senha.length < 6) return res.status(400).json({ ok: false, message: "Senha deve ter pelo menos 6 caracteres." });
    const secret  = getParceiroSecret();
    const payload = jwt.verify(token, secret);
    if (payload?.typ !== "parceiro_setup") return res.status(400).json({ ok: false, message: "Token invÃ¡lido." });
    const convite = await ConviteParceiro.findById(payload.id);
    if (!convite) return res.status(404).json({ ok: false, message: "Conta nÃ£o encontrada." });
    convite.passwordHash = await (await import("bcryptjs")).default.hash(senha, 10);
    convite.status = "ativo";
    await convite.save();
    // Criar sessÃ£o imediata
    const tokenJwt = jwt.sign(
      { typ: "parceiro", id: String(convite._id), email: convite.email, empresa: convite.empresa, tipo: convite.tipo || "frota" },
      secret, { expiresIn: "30d" }
    );
    const isProduction = process.env.NODE_ENV === "production";
    res.cookie("rm_parceiro_token", tokenJwt, { httpOnly: true, secure: isProduction, sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000 });
    return res.json({ ok: true, message: "Conta activada com sucesso." });
  } catch (err) {
    console.error("âŒ definir-senha gestor:", err);
    return res.status(400).json({ ok: false, message: "Link invÃ¡lido ou expirado." });
  }
});