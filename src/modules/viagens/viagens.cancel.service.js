// src/modules/viagens/viagens.cancel.service.js
// ══════════════════════════════════════════════════════════════
// Cancela uma viagem em qualquer estado anterior a "in_progress"
// (pendente, em despacho, atribuída). Se a viagem já tinha
// pagamento confirmado (ex: viagem partilhada/convidado, paga
// antecipadamente por todos os participantes antes do despacho),
// processa o reembolso automaticamente.
// ══════════════════════════════════════════════════════════════
import * as ViagemRepository from "../../repositories/viagem.repository.js";
import ShareTrip from "../../models/ShareTrip.js";
import ShareInvite from "../../models/ShareInvite.js";
import { refundStripePaymentIntent } from "../../services/stripeRefund.service.js";
import { paypalRefundCapture } from "../../routes/payments.routes.js";

function createError(message, statusCode = 500) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

const ESTADOS_CANCELAVEIS = ["pendente", "confirmada", "assigned", ""];

/**
 * Cancela uma viagem (Trip). Se a viagem teve origem numa partilha
 * paga antecipadamente, reembolsa automaticamente cada participante
 * que pagou (Stripe ou PayPal, conforme o método usado por cada um).
 *
 * @param {string} viagemId
 * @param {{ canceladoPor: "admin"|"organizador", motivo?: string }} opts
 */
export async function cancelarViagem(viagemId, { canceladoPor = "admin", motivo = "" } = {}) {
  const viagem = await ViagemRepository.findById(viagemId);
  if (!viagem) throw createError("Viagem não encontrada.", 404);

  if (!ESTADOS_CANCELAVEIS.includes(viagem.status)) {
    throw createError(
      `Esta viagem já está em "${viagem.status}" e não pode ser cancelada por aqui.`,
      400
    );
  }

  const resultadosReembolso = [];

  // Se esta viagem veio de uma partilha (ver shareFinalize.service.js,
  // meta.origemPartilha), reembolsar cada participante que já pagou.
  if (viagem.meta?.origemPartilha && viagem.meta?.shareId) {
    const shareId = viagem.meta.shareId;
    const invites = await ShareInvite.find({ shareId, status: "pagou" });

    for (const inv of invites) {
      if (!inv.payRef) {
        resultadosReembolso.push({ contacto: inv.contacto, accao: "reembolso_manual_necessario", motivo: "sem referência de pagamento" });
        continue;
      }
      try {
        if (inv.payProvider === "stripe") {
          await refundStripePaymentIntent(inv.payRef);
        } else if (inv.payProvider === "paypal") {
          await paypalRefundCapture(inv.payRef);
        } else {
          resultadosReembolso.push({ contacto: inv.contacto, accao: "reembolso_manual_necessario", motivo: "provider desconhecido" });
          continue;
        }
        inv.status = "cancelado";
        await inv.save();
        resultadosReembolso.push({ contacto: inv.contacto, accao: "reembolsado_total" });
      } catch (err) {
        resultadosReembolso.push({ contacto: inv.contacto, accao: "reembolso_falhou", erro: err.message });
      }
    }

    await ShareTrip.updateOne({ shareId }, { $set: { status: "cancelada" } });
  }

  const viagemCancelada = await ViagemRepository.updateById(viagemId, {
    status: "cancelada",
    "meta.canceladoPor": canceladoPor,
    "meta.motivoCancelamento": String(motivo || "").trim(),
    "meta.canceladoEm": new Date(),
    "meta.reembolsos": resultadosReembolso,
  });

  return { viagem: viagemCancelada, reembolsos: resultadosReembolso };
}
