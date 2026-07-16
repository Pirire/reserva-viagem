import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

// 🔐 segredo (coloca no .env)
const INVITE_JWT_SECRET = process.env.INVITE_JWT_SECRET || "change_me";

// tempos
const INVITE_TTL_MINUTES = 15;
const OTP_TTL_MINUTES = 10;

function nowMs() { return Date.now(); }
function minutesFromNow(m) { return nowMs() + (m * 60 * 1000); }

function genOtp6() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function randomId() {
  return "inv_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function signInviteToken({ shareId, contacto, inviteId }) {
  return jwt.sign(
    { typ: "share_invite", shareId, contacto, inviteId },
    INVITE_JWT_SECRET,
    { expiresIn: `${INVITE_TTL_MINUTES}m` }
  );
}

/**
 * createInvitesForShare
 * - baseUrl: "https://teusite.com" (ou http://localhost:10000 se for dev)
 * - sendInviteMessage: a tua função real de envio (SMS/WhatsApp/email)
 * - InviteModel: o teu model do Mongo (ou adapter)
 */
export async function createInvitesForShare({
  shareId,
  participantes,
  baseUrl,
  sendInviteMessage,
  InviteModel
}) {
  if (!shareId) throw new Error("shareId obrigatório");
  if (!Array.isArray(participantes)) throw new Error("participantes inválido");
  if (typeof sendInviteMessage !== "function") throw new Error("sendInviteMessage não é função");
  if (!InviteModel) throw new Error("InviteModel obrigatório");

  const results = [];

  for (const p of participantes) {
    const contacto = String(p?.contacto || "").trim();
    const nome = String(p?.nome || "Participante").trim();

    if (!contacto) continue;

    const inviteId = randomId();
    const otp = genOtp6();
    const otpHash = await bcrypt.hash(otp, 10);
    const inviteToken = signInviteToken({ shareId, contacto, inviteId });

    const link = `${String(baseUrl).replace(/\/$/, "")}/minha-area.html?invite=${encodeURIComponent(inviteToken)}`;

    // guarda no BD (OTP nunca em texto, só hash)
    await InviteModel.create({
      inviteId,
      shareId,
      contacto,
      nome,
      otpHash,
      otpExpiresAt: minutesFromNow(OTP_TTL_MINUTES),
      inviteExpiresAt: minutesFromNow(INVITE_TTL_MINUTES),
      usedAt: null,
      attempts: 0,
      createdAt: nowMs(),
    });

    // envia link + OTP (teu sistema)
    await sendInviteMessage({ contacto, nome, link, otp });

    results.push({ contacto, nome, sent: true });
  }

  return results;
}
