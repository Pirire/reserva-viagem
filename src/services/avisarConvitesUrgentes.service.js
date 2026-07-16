// src/services/avisarConvitesUrgentes.service.js
// ══════════════════════════════════════════════════════════════
// Envia avisos automáticos aos convidados de Reserva Flexível
// quando a validade do bilhete está próxima:
//   • 60 min antes: "Nos próximos 60 minutos deve confirmar..."
//   • 15 min antes: "Último aviso — tem apenas 15 minutos..."
//
// Como funciona:
//   • Corre a cada minuto (via node-cron no server.js)
//   • Para cada invite ainda em "pendente" com `inviteExpiresAt`
//     definido, calcula quanto tempo falta até expirar
//   • Se 55–65 min antes → dispara o aviso de 60 min (uma vez)
//   • Se 10–20 min antes → dispara o aviso de 15 min (uma vez)
//   • Marca no invite `aviso60EnviadoAt` / `aviso15EnviadoAt`
//     para não repetir
//
// GARANTIAS:
//   • Um aviso NUNCA é enviado duas vezes (idempotência via campos
//     `aviso60EnviadoAt` e `aviso15EnviadoAt`)
//   • Se o invite já foi validado/pago/cancelado → não avisa
//   • Se o SMS/email falhar, o campo NÃO é marcado (tenta de novo
//     no próximo tick, dentro da janela)
//   • Nunca trava o servidor: usa timeouts do notificarConvite
// ══════════════════════════════════════════════════════════════

import ShareInvite from "../models/ShareInvite.js";
import { notificarConvite } from "./notificarConvite.service.js";

// Janelas de disparo em milissegundos
const AVISO_60_MIN = { min: 55 * 60_000, max: 65 * 60_000 };
const AVISO_15_MIN = { min: 10 * 60_000, max: 20 * 60_000 };

export async function verificarAvisosUrgentes() {
  const agora = Date.now();

  // Só consideramos invites do modo Evento, ainda pendentes, com validade definida
  const candidatos = await ShareInvite.find({
    modoEvento: true,
    status: "pendente",
    usedAt:  null,
    pago:    { $ne: true },
    inviteExpiresAt: { $ne: null },
  }).lean();

  let enviados60 = 0, enviados15 = 0, falhas = 0;

  for (const inv of candidatos) {
    const restanteMs = new Date(inv.inviteExpiresAt).getTime() - agora;
    if (restanteMs <= 0) continue; // já expirou — trata do lado do expirarConvitesVencidos

    const partida = inv.partidaEvento?.address || "—";
    const validade = new Date(inv.inviteExpiresAt).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

    // ── AVISO 60 MIN ──
    if (!inv.aviso60EnviadoAt
        && restanteMs >= AVISO_60_MIN.min
        && restanteMs <= AVISO_60_MIN.max) {
      const smsBody =
        `REALMETROPOLIS — Ola ${inv.nome}!\n` +
        `Nos proximos 60 minutos deve confirmar a sua viagem.\n` +
        `Partida: ${partida}\n` +
        `Validade: ${validade}`;
      const emailHtml =
        `<p>Olá <b>${inv.nome}</b>,</p>` +
        `<p><b>Nos próximos 60 minutos</b> deve confirmar a sua viagem.</p>` +
        `<p>Partida: <b>${partida}</b><br>Válido até: <b>${validade}</b></p>` +
        `<p>Aceda ao link enviado anteriormente para confirmar.</p>`;

      const res = await _entregar(inv, {
        smsBody,
        emailSubject: "Confirme a sua viagem — próximos 60 minutos",
        emailHtml,
      });
      if (res.entregue) {
        await ShareInvite.updateOne({ inviteId: inv.inviteId }, { $set: { aviso60EnviadoAt: new Date() } });
        enviados60++;
        console.log(`⏰ [aviso 60min] enviado a ${inv.nome} — sms:${res.smsEnviado} email:${res.emailEnviado}`);
      } else {
        falhas++;
        console.warn(`⚠️ [aviso 60min] falhou para ${inv.nome}:`,
          (res.erros || []).map(e => `${e.canal}: ${e.motivo}`).join(" | "));
      }
    }

    // ── AVISO 15 MIN ──
    if (!inv.aviso15EnviadoAt
        && restanteMs >= AVISO_15_MIN.min
        && restanteMs <= AVISO_15_MIN.max) {
      const smsBody =
        `REALMETROPOLIS — Ultimo aviso, ${inv.nome}!\n` +
        `Tem apenas 15 minutos para confirmar a sua viagem ou a mesma sera cancelada.\n` +
        `Partida: ${partida}`;
      const emailHtml =
        `<p>Olá <b>${inv.nome}</b>,</p>` +
        `<p><b>⚠️ ÚLTIMO AVISO</b> — tem apenas <b>15 minutos</b> para confirmar a sua viagem ou a mesma será cancelada.</p>` +
        `<p>Partida: <b>${partida}</b></p>` +
        `<p>Aceda ao link enviado anteriormente para confirmar já.</p>`;

      const res = await _entregar(inv, {
        smsBody,
        emailSubject: "⚠️ ÚLTIMO AVISO — 15 minutos para confirmar",
        emailHtml,
      });
      if (res.entregue) {
        await ShareInvite.updateOne({ inviteId: inv.inviteId }, { $set: { aviso15EnviadoAt: new Date() } });
        enviados15++;
        console.log(`⏰ [aviso 15min] enviado a ${inv.nome} — sms:${res.smsEnviado} email:${res.emailEnviado}`);
      } else {
        falhas++;
        console.warn(`⚠️ [aviso 15min] falhou para ${inv.nome}:`,
          (res.erros || []).map(e => `${e.canal}: ${e.motivo}`).join(" | "));
      }
    }
  }

  if (enviados60 || enviados15 || falhas) {
    console.log(`⏰ [avisosUrgentes] tick — 60min:${enviados60} 15min:${enviados15} falhas:${falhas}`);
  }

  return { enviados60, enviados15, falhas, verificados: candidatos.length };
}

// Determina o método (mesmo canal do convite original) e chama o serviço central
async function _entregar(inv, { smsBody, emailSubject, emailHtml }) {
  // Recuperar o canal original. Se o invite não guarda essa info,
  // assumimos SMS (é o comportamento por defeito no criar).
  const metodo = inv.notifMethodOriginal || (inv.email && !inv.contacto?.startsWith?.("+") ? "email" : "sms");
  const contactoLimpo = inv.contacto?.startsWith?.("email:") ? "" : inv.contacto;
  return notificarConvite({
    metodo,
    contacto: contactoLimpo,
    email:    inv.email || null,
    smsBody,
    emailSubject,
    emailHtml,
  });
}
