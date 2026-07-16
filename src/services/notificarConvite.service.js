// src/services/notificarConvite.service.js
// ══════════════════════════════════════════════════════════════
// Ponto único de envio de notificações a convidados/pagadores.
// Usado por: Partilha, Evento, Ticket, Convidado.
//
// GARANTIAS OPERACIONAIS:
//   • Nunca retorna undefined. Sempre um objeto { entregue, ... }.
//   • Nunca dá "sucesso mudo". Se nada foi entregue, o resultado
//     diz porquê, canal a canal.
//   • Nunca trava o servidor: timeout curto tanto no SMTP como
//     no SMS.
//   • Números de telemóvel normalizados para E.164 antes do envio.
//     Um número em formato local (ex: "912345678") NÃO chega ao
//     Twilio nesse formato — é convertido para "+351912345678".
//   • Ao arrancar o servidor, imprime o estado das credenciais.
//     Sem isto, um `.env` incompleto só era detectado quando um
//     convite falhava.
// ══════════════════════════════════════════════════════════════

import nodemailer from "nodemailer";
import * as smsModule from "../modules/notifications/smsTwilio.js";

const SMS_TIMEOUT_MS  = 8_000;
const SMTP_TIMEOUT_MS = 8_000;

/* ══════════════════════════════════════════════════════════════
   Verificação de configuração ao arranque
   ══════════════════════════════════════════════════════════════ */

const STATUS_SMS = (() => {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  // O projeto usa TWILIO_FROM; aceitamos também os alternativos
  // TWILIO_FROM_NUMBER e TWILIO_PHONE_NUMBER caso alguém já os
  // tenha configurado noutros ambientes.
  const from  = process.env.TWILIO_FROM || process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token) return { ok: false, motivo: "TWILIO_ACCOUNT_SID/AUTH_TOKEN em falta" };
  if (!from)          return { ok: false, motivo: "TWILIO_FROM em falta" };
  return { ok: true };
})();

const STATUS_EMAIL = (() => {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return { ok: false, motivo: "SMTP_HOST/USER/PASS em falta" };
  return { ok: true };
})();

console.log(`[notificarConvite] SMS: ${STATUS_SMS.ok ? "✅ pronto" : "❌ " + STATUS_SMS.motivo}`);
console.log(`[notificarConvite] EMAIL: ${STATUS_EMAIL.ok ? "✅ pronto" : "❌ " + STATUS_EMAIL.motivo}`);

/* ══════════════════════════════════════════════════════════════
   Normalização de telemóvel para E.164
   ══════════════════════════════════════════════════════════════ */

function normalizarE164(contacto) {
  if (!contacto) return null;
  let n = String(contacto).replace(/[\s\-().]/g, "");
  if (!n) return null;
  if (n.startsWith("00")) n = "+" + n.slice(2);
  if (!n.startsWith("+")) {
    // Sem prefixo internacional — presumimos Portugal (o teu mercado
    // principal). Se o teu operador for internacional, muda a
    // constante COUNTRY_CODE_DEFAULT.
    n = "+351" + n;
  }
  // Formato E.164: começa por +, seguido de 8 a 15 dígitos
  return /^\+\d{8,15}$/.test(n) ? n : null;
}

function normalizarEmail(email) {
  if (!email) return null;
  const e = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

/* ══════════════════════════════════════════════════════════════
   Wrappers de envio com timeout
   ══════════════════════════════════════════════════════════════ */

function comTimeout(promise, ms, motivoTimeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(motivoTimeout)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

async function enviarSms(numeroE164, corpo) {
  const fn = smsModule.sendSms || smsModule.default;
  if (typeof fn !== "function") throw new Error("smsTwilio.js sem export sendSms");
  return comTimeout(fn(numeroE164, corpo), SMS_TIMEOUT_MS, "SMS timeout (>8s)");
}

let _transporte = null;
function transporteSmtp() {
  if (_transporte) return _transporte;
  if (!STATUS_EMAIL.ok) return null;
  _transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout:   SMTP_TIMEOUT_MS,
    socketTimeout:     SMTP_TIMEOUT_MS + 4_000,
  });
  return _transporte;
}

async function enviarEmail(email, assunto, html) {
  const t = transporteSmtp();
  if (!t) throw new Error("SMTP não configurado");
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  return comTimeout(
    t.sendMail({ from, to: email, subject: assunto, html }),
    SMTP_TIMEOUT_MS + 4_000,
    "SMTP timeout (>12s)"
  );
}

/* ══════════════════════════════════════════════════════════════
   API pública
   ══════════════════════════════════════════════════════════════ */

/**
 * @param {object} p
 * @param {"sms"|"email"|"ambos"} [p.metodo="sms"]  Canal preferido
 * @param {string} [p.contacto]     Telemóvel (formato livre; normalizado internamente)
 * @param {string} [p.email]        Email
 * @param {string} p.smsBody
 * @param {string} p.emailSubject
 * @param {string} p.emailHtml
 * @returns {Promise<{
 *   entregue: boolean,
 *   smsEnviado: boolean,
 *   emailEnviado: boolean,
 *   metodoPedido: string,
 *   canaisTentados: string[],
 *   erros: {canal:"sms"|"email", motivo:string}[]
 * }>}
 */
export async function notificarConvite({
  metodo = "sms",
  contacto,
  email,
  smsBody,
  emailSubject,
  emailHtml,
}) {
  const metodoPedido = ["sms", "email", "ambos"].includes(metodo) ? metodo : "sms";
  const querSms   = metodoPedido === "sms"   || metodoPedido === "ambos";
  const querEmail = metodoPedido === "email" || metodoPedido === "ambos";

  const numE164   = normalizarE164(contacto);
  const emailNorm = normalizarEmail(email);

  const r = {
    entregue: false,
    smsEnviado: false,
    emailEnviado: false,
    metodoPedido,
    canaisTentados: [],
    erros: [],
  };

  // ── Canal SMS ──
  if (querSms) {
    r.canaisTentados.push("sms");
    if (!numE164) {
      r.erros.push({ canal: "sms", motivo: contacto ? `número inválido (${contacto})` : "sem contacto" });
    } else if (!STATUS_SMS.ok) {
      r.erros.push({ canal: "sms", motivo: STATUS_SMS.motivo });
    } else if (!smsBody) {
      r.erros.push({ canal: "sms", motivo: "smsBody vazio" });
    } else {
      try {
        await enviarSms(numE164, smsBody);
        r.smsEnviado = true;
      } catch (err) {
        r.erros.push({ canal: "sms", motivo: err?.message || String(err) });
      }
    }
  }

  // ── Canal Email ──
  if (querEmail) {
    r.canaisTentados.push("email");
    if (!emailNorm) {
      r.erros.push({ canal: "email", motivo: email ? `email inválido (${email})` : "sem email" });
    } else if (!STATUS_EMAIL.ok) {
      r.erros.push({ canal: "email", motivo: STATUS_EMAIL.motivo });
    } else if (!emailSubject || !emailHtml) {
      r.erros.push({ canal: "email", motivo: "emailSubject/emailHtml vazio" });
    } else {
      try {
        await enviarEmail(emailNorm, emailSubject, emailHtml);
        r.emailEnviado = true;
      } catch (err) {
        r.erros.push({ canal: "email", motivo: err?.message || String(err) });
      }
    }
  }

  // ── Fallback defensivo ──
  // Se pediu SMS mas nada saiu e há email disponível, tenta email.
  // O inverso também. Nunca deixa um convidado sem tentativa.
  if (!r.smsEnviado && !r.emailEnviado) {
    if (!querSms && numE164 && STATUS_SMS.ok && smsBody) {
      r.canaisTentados.push("sms(fallback)");
      try { await enviarSms(numE164, smsBody); r.smsEnviado = true; }
      catch (err) { r.erros.push({ canal: "sms", motivo: "fallback: " + (err?.message || err) }); }
    } else if (!querEmail && emailNorm && STATUS_EMAIL.ok && emailSubject && emailHtml) {
      r.canaisTentados.push("email(fallback)");
      try { await enviarEmail(emailNorm, emailSubject, emailHtml); r.emailEnviado = true; }
      catch (err) { r.erros.push({ canal: "email", motivo: "fallback: " + (err?.message || err) }); }
    }
  }

  r.entregue = r.smsEnviado || r.emailEnviado;
  return r;
}

export { normalizarE164, normalizarEmail, STATUS_SMS, STATUS_EMAIL };