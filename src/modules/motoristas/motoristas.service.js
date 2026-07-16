import Motorista  from "../../models/Motorista.js";
import jwt        from "jsonwebtoken";
import crypto     from "crypto";
import nodemailer from "nodemailer";

function createSmtp() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({ host, port: Number(process.env.SMTP_PORT || 587), secure: false, auth: { user, pass }, tls: { rejectUnauthorized: false } });
}

function getBaseUrl() {
  return String(process.env.APP_URL || process.env.PUBLIC_BASE_URL || "http://localhost:10000").trim();
}

function extrairGestor(req) {
  try {
    const token = req.cookies?.rm_parceiro_token || req.cookies?.rm_colaborador_token || "";
    if (!token) return {};
    const secret  = process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET || "";
    const payload = jwt.verify(token, secret);
    return {
      id:      String(payload?.id      || ""),
      nome:    String(payload?.empresa || payload?.nome || ""),
      email:   String(payload?.email   || ""),
      empresa: String(payload?.empresa || ""),
    };
  } catch { return {}; }
}

export async function criarMotoristaService(data, files = {}, req = {}) {
  function toDoc(fileArray) {
    if (!Array.isArray(fileArray) || !fileArray[0]) return undefined;
    const f = fileArray[0];
    const rawPath = String(f.path || f.filename || "").replace(/\\/g, "/");
    const uploadsIdx = rawPath.indexOf("uploads/");
    const relativePath = uploadsIdx !== -1
      ? "/" + rawPath.slice(uploadsIdx)
      : "/uploads/" + f.filename;
    return {
      file:   { path: relativePath, filename: f.filename, mimetype: f.mimetype },
      status: "pendente",
    };
  }

  // Normalizar campos — trim + rejeitar strings vazias
  const str = (v) => String(v || "").trim();

  const nome      = str(data.nome);
  const email     = str(data.email).toLowerCase();
  const contacto  = str(data.contacto);
  const nif       = str(data.nif);
  const iban      = str(data.iban);
  const endereco  = str(data.endereco);

  // Validação explícita antes de chegar ao Mongoose
  if (!nome)     throw Object.assign(new Error("Nome obrigatório."),     { status: 400 });
  if (!email)    throw Object.assign(new Error("Email obrigatório."),    { status: 400 });
  if (!contacto) throw Object.assign(new Error("Contacto obrigatório."), { status: 400 });

  const gestor = extrairGestor(req);

  const documentos = {
    fotoRosto:          toDoc(files.fotoRosto),
    cc:                 toDoc(files.docIdFrente),
    ccVerso:            toDoc(files.docIdVerso),
    tResidencia:        toDoc(files.docObgIdFrente),
    tResidenciaVerso:   toDoc(files.docObgIdVerso),
    cartaConducao:      toDoc(files.cartaFrente),
    cartaConducaoVerso: toDoc(files.cartaVerso),
    tvde:               toDoc(files.imttTvde),
    ibanComprovativo:   toDoc(files.ibanComprovativo),
  };

  return Motorista.create({
    nome,
    email,
    contacto,
    nif,
    iban,
    endereco,
    documentoTipo: str(data.documentoTipo),
    gestor,
    documentos,
    status:    "pendente",
    aprovacao: "pendente",
  });
}

export async function listarPendentes() {
  return Motorista.find({ aprovacao: "pendente" }).sort({ createdAt: -1 });
}

export async function aprovar(id) {
  const setupToken     = crypto.randomBytes(32).toString("hex");
  const setupTokenHash = crypto.createHash("sha256").update(setupToken).digest("hex");
  const setupTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const motorista = await Motorista.findByIdAndUpdate(
    id,
    { aprovacao: "aprovado", status: "ativo", setupToken, setupTokenHash, setupTokenExpires, setupTokenUsadoEm: null },
    { new: true }
  );
  if (!motorista) return null;

  try {
    const baseUrl        = getBaseUrl();
    const activationLink = `${baseUrl}/motorista-definir-senha.html?token=${encodeURIComponent(setupToken)}`;
    const transporter    = createSmtp();
    const from           = String(process.env.SMTP_FROM || process.env.SMTP_USER || "").trim();

    if (transporter && from) {
      await transporter.sendMail({
        from, to: motorista.email,
        subject: "REALMETROPOLIS — Conta Aprovada — Ative a sua conta",
        html: `<!DOCTYPE html><html lang="pt"><body style="margin:0;padding:0;background:#050507;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:linear-gradient(180deg,#0e1012,#08090b);border:1px solid rgba(196,201,212,.18);border-radius:18px;overflow:hidden;max-width:560px;width:100%;">
      <tr><td style="padding:22px 28px 18px;border-bottom:1px solid rgba(196,201,212,.10);">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="width:42px;height:42px;border-radius:50%;border:1.5px solid rgba(196,201,212,.35);text-align:center;vertical-align:middle;background:#0a0c0f;color:#c4c9d4;font-weight:900;font-size:11px;">RM</td>
          <td style="padding-left:12px;color:#c4c9d4;font-size:14px;font-weight:900;letter-spacing:.12em;">REALMETROPOLIS</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px 28px 24px;">
        <p style="color:#edf0f5;font-size:20px;font-weight:900;margin:0 0 8px;">✅ Conta Aprovada</p>
        <p style="color:#8b95a2;font-size:13px;margin:0 0 22px;line-height:1.55;">
          Olá <b style="color:#c4c9d4;">${motorista.nome}</b>,<br><br>
          A sua conta de motorista foi <b style="color:#1fc97d;">aprovada</b>.<br>
          Clique no botão abaixo para definir a sua senha e aceder à plataforma.
        </p>
        <div style="text-align:center;margin:28px 0;">
          <a href="${activationLink}" style="display:inline-block;padding:14px 32px;border-radius:12px;background:#d9dde3;color:#07080a;font-weight:900;font-size:14px;text-decoration:none;letter-spacing:.06em;">DEFINIR SENHA E ENTRAR</a>
        </div>
        <p style="color:#5f6874;font-size:11px;text-align:center;margin:0;">Link válido 7 dias. Se o botão não funcionar, copie:<br>${activationLink}</p>
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid rgba(196,201,212,.08);text-align:center;color:#434a55;font-size:11px;">REALMETROPOLIS © ${new Date().getFullYear()}</td></tr>
    </table>
  </td></tr></table>
</body></html>`,
      });
      console.log("✅ Email activação motorista:", motorista.email);
    } else {
      console.warn("⚠️ SMTP não configurado. Link:", activationLink);
    }
  } catch (e) { console.error("⚠️ Email activação:", e.message); }

  return motorista;
}

export async function rejeitar(id) {
  return Motorista.findByIdAndUpdate(
    id,
    { aprovacao: "rejeitado", status: "inativo" },
    { new: true }
  );
}