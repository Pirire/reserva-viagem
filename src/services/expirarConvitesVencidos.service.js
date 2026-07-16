// src/services/expirarConvitesVencidos.service.js
// ══════════════════════════════════════════════════════════════
// Resolve o cenário: "o hotel agenda a recolha para as 00:00, mas
// dá até às 04:00 para o convidado confirmar". Corrido periodicamente
// (cron, ver server.js) para:
//
//   1. Avisar por SMS/email quando falta 1 hora para o prazo
//      (ShareTrip.validUntil) — uma única vez por convite.
//   2. Quando o prazo expira sem confirmação/pagamento, marcar o
//      convite como "vencido" e reembolsar automaticamente quem já
//      tinha pago (normalmente o hotel, no modo pagador:"hotel").
//
// Sem prazo definido (validUntil null), a viagem nunca expira por
// aqui — comportamento actual preservado para quem não usa esta
// funcionalidade.
// ══════════════════════════════════════════════════════════════
import ShareTrip from "../models/ShareTrip.js";
import ShareInvite from "../models/ShareInvite.js";
import { notificarConvite } from "./notificarConvite.service.js";
import { refundStripePaymentIntent } from "./stripeRefund.service.js";
import { paypalRefundCapture } from "../routes/payments.routes.js";

const UMA_HORA_MS = 60 * 60 * 1000;

function formatarHora(timestampMs) {
  try {
    return new Date(timestampMs).toLocaleString("pt-PT", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

/**
 * Corrida única do verificador — chamado pelo cron a cada poucos
 * minutos (ver server.js). Idempotente e segura para correr em
 * paralelo com pedidos normais.
 */
export async function verificarConvitesVencidos(io = null) {
  const agora = Date.now();

  // ── 1) Avisos "falta 1 hora" ────────────────────────────────
  const aprestesAVencer = await ShareTrip.find({
    validUntil: { $gt: agora, $lte: agora + UMA_HORA_MS },
    avisoVencimentoEnviado: { $ne: true },
  });

  for (const trip of aprestesAVencer) {
    try {
      const invitesPendentes = await ShareInvite.find({
        shareId: trip.shareId,
        status: { $nin: ["pagou", "vencido", "cancelado", "falhou"] },
        avisoVencimentoEnviado: { $ne: true },
      });

      for (const inv of invitesPendentes) {
        const horaLimite = formatarHora(trip.validUntil);
        await notificarConvite({
          metodo: trip.notifMethod || "sms",
          contacto: inv.contacto,
          email: inv.email,
          smsBody: `REALMETROPOLIS: a sua viagem ainda não foi confirmada. Tem até às ${horaLimite} (faltam cerca de 60 minutos) para confirmar a recolha, ou o pedido será cancelado.`,
          emailSubject: "A sua viagem expira em breve",
          emailHtml: `<p>A sua viagem ainda não foi confirmada.</p><p>Tem até às <b>${horaLimite}</b> (faltam cerca de 60 minutos) para confirmar a recolha, ou o pedido será automaticamente cancelado.</p>`,
        });
        inv.avisoVencimentoEnviado = true;
        await inv.save();
      }

      trip.avisoVencimentoEnviado = true;
      await trip.save();

      if (io) io.to(`share_${trip.shareId}`).emit("aviso_vencimento", { shareId: trip.shareId, validUntil: trip.validUntil });

      console.log(`⏰ [expiração] Aviso de 1h enviado — shareId=${trip.shareId}, ${invitesPendentes.length} convidado(s).`);
    } catch (err) {
      console.error(`❌ [expiração] falha ao avisar shareId=${trip.shareId}:`, err?.message);
    }
  }

  // ── 2) Vencimento — expira e reembolsa ──────────────────────
  const vencidos = await ShareTrip.find({
    validUntil: { $lte: agora, $gt: 0 },
    status: { $nin: ["cancelada", "vencida", "despachada"] },
  });

  for (const trip of vencidos) {
    try {
      const invites = await ShareInvite.find({
        shareId: trip.shareId,
        status: { $nin: ["pagou", "vencido", "cancelado", "falhou"] },
      });

      for (const inv of invites) {
        // Reembolsar se este convidado/hotel já tinha pago algo
        // antes de vencer (ex: pagador:"hotel" paga todos
        // antecipadamente, antes de cada convidado confirmar).
        if (inv.payRef && Number(inv.paidAmount) > 0) {
          try {
            if (inv.payProvider === "stripe") {
              await refundStripePaymentIntent(inv.payRef);
            } else if (inv.payProvider === "paypal") {
              await paypalRefundCapture(inv.payRef);
            }
          } catch (errRef) {
            console.error(`❌ [expiração] reembolso falhou para ${inv.contacto}:`, errRef?.message);
          }
        }
        inv.status = "vencido";
        await inv.save();

        await notificarConvite({
          metodo: trip.notifMethod || "sms",
          contacto: inv.contacto,
          email: inv.email,
          smsBody: `REALMETROPOLIS: o prazo para confirmar a sua viagem terminou. O pedido foi cancelado${Number(inv.paidAmount) > 0 ? " e o valor reembolsado" : ""}.`,
          emailSubject: "Viagem cancelada — prazo expirado",
          emailHtml: `<p>O prazo para confirmar a sua viagem terminou.</p><p>O pedido foi cancelado${Number(inv.paidAmount) > 0 ? " e o valor reembolsado" : ""}.</p>`,
        }).catch(() => {});
      }

      trip.status = "vencida";
      await trip.save();

      if (io) {
        io.to(`share_${trip.shareId}`).emit("partilha_vencida", {
          shareId: trip.shareId,
          participantesVencidos: invites.length,
        });
      }

      console.log(`⌛ [expiração] Evento/viagem vencida — shareId=${trip.shareId}, ${invites.length} convidado(s) cancelado(s)/reembolsado(s).`);
    } catch (err) {
      console.error(`❌ [expiração] falha ao expirar shareId=${trip.shareId}:`, err?.message);
    }
  }

  return { avisos: aprestesAVencer.length, vencidos: vencidos.length };
}
