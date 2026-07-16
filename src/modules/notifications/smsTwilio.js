// src/services/smsTwilio.js
import dotenv from "dotenv";
dotenv.config();

import twilio from "twilio";

/* ==============================
   ENV
============================== */
const SID = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
const TOKEN = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
// Messaging Service SID (MG...) — substitui o número fixo (FROM).
// Criado na consola Twilio com um Sender Pool de 2 remetentes:
//   +17745045963   → usado automaticamente para destinos EUA/Canadá
//   RMviagens (Alpha Sender, "Generic for all countries") → usado para
//   todos os outros destinos, incluindo Portugal.
// A Twilio escolhe o remetente certo por destino — já não é preciso
// fazer essa escolha manualmente no código.
const MESSAGING_SERVICE_SID = String(process.env.TWILIO_MESSAGING_SERVICE_SID || "").trim();
// Mantido apenas como fallback de emergência se o Messaging Service
// não estiver configurado (ex: ambiente local sem essa env definida).
const FROM = String(process.env.TWILIO_FROM || "").trim();

/* ==============================
   DEBUG SEGURO
============================== */
console.log("[TWILIO] SID prefix:", SID.slice(0, 4), "len:", SID.length);
console.log("[TWILIO] TOKEN len:", TOKEN.length);
console.log("[TWILIO] MESSAGING_SERVICE_SID:", MESSAGING_SERVICE_SID || "(não definido)");
console.log("[TWILIO] FROM (fallback):", FROM || "(não definido)");

/* ==============================
   VALIDADORES
============================== */
function isValidSid(v) {
  return typeof v === "string" && v.startsWith("AC") && v.length === 34;
}

function isValidToken(v) {
  return typeof v === "string" && v.length >= 20;
}

function isValidFrom(v) {
  return typeof v === "string" && v.length > 8;
}

function isValidMessagingServiceSid(v) {
  return typeof v === "string" && v.startsWith("MG") && v.length === 34;
}

// Pode enviar se tiver Messaging Service SID válido OU (em alternativa,
// modo antigo) um FROM válido.
export function canSendSms() {
  const hasAuth = isValidSid(SID) && isValidToken(TOKEN);
  const hasSender = isValidMessagingServiceSid(MESSAGING_SERVICE_SID) || isValidFrom(FROM);
  return hasAuth && hasSender;
}

/* ==============================
   CLIENT SINGLETON
============================== */
let client = null;

function getClient() {
  if (!canSendSms()) {
    console.error("❌ TWILIO CONFIG INVÁLIDA");
    throw new Error("Twilio mal configurado (SID/TOKEN/MESSAGING_SERVICE_SID ou FROM).");
  }

  if (!client) {
    client = twilio(SID, TOKEN);
  }

  return client;
}

/* ==============================
   NORMALIZAR NÚMERO PT
============================== */
function normalizePT(raw) {
  if (!raw) return "";

  let s = String(raw).trim().replace(/[^\d+]/g, "");

  // 00 → +
  if (s.startsWith("00")) s = "+" + s.slice(2);

  const digits = s.replace(/\D/g, "");

  if (s.startsWith("+")) return "+" + digits;

  // Portugal fallback
  if (digits.length === 9) return "+351" + digits;
  if (digits.startsWith("351")) return "+" + digits;

  return "+" + digits;
}

/* ==============================
   SEND SMS (MELHORADO)
============================== */
export async function sendSms(toRaw, body) {
  if (!canSendSms()) {
    throw new Error("SMS desativado: configuração Twilio inválida.");
  }

  const to = normalizePT(toRaw);

  if (!to.startsWith("+")) {
    throw new Error(`Número inválido: ${toRaw}`);
  }

  // Preferir Messaging Service (escolhe remetente certo por país).
  // Só usa o FROM fixo se o Messaging Service não estiver configurado.
  const useMessagingService = isValidMessagingServiceSid(MESSAGING_SERVICE_SID);
  const senderInfo = useMessagingService
    ? { messagingServiceSid: MESSAGING_SERVICE_SID }
    : { from: FROM };

  console.log("📩 [TWILIO SEND]", { to, ...senderInfo });

  const twilioClient = getClient();

  try {
    const msg = await twilioClient.messages.create({
      ...senderInfo,
      to,
      body: String(body || ""),
    });

    /* ==============================
       DEBUG REAL DO TWILIO
    ============================== */
    console.log("📨 [TWILIO RESPONSE]");
    console.log("SID:", msg.sid);
    console.log("STATUS:", msg.status);
    console.log("TO:", msg.to);
    console.log("FROM:", msg.from);
    console.log("ERROR CODE:", msg.errorCode);
    console.log("ERROR MESSAGE:", msg.errorMessage);

    return {
      ok: true,
      sid: msg.sid,
      status: msg.status,
      to,
      from: msg.from,
    };

  } catch (err) {
    console.error("❌ [TWILIO ERROR COMPLETO]");
    console.error("Message:", err?.message);
    console.error("Code:", err?.code);
    console.error("More:", err);

    throw new Error(
      `Erro Twilio: ${err?.message || "desconhecido"} (code ${err?.code || "?"})`
    );
  }
}