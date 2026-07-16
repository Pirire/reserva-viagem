// src/services/stripeRefund.service.js
// ══════════════════════════════════════════════════════════════
// Helper reutilizável de reembolso Stripe — antes esta lógica
// estava duplicada inline em partilha.routes.js (getStripe() +
// stripe.refunds.create); extraído para um serviço único para que
// viagens.cancel.service.js (e qualquer outro sítio futuro) possa
// reutilizá-la sem duplicar a inicialização do cliente Stripe.
// ══════════════════════════════════════════════════════════════
let _stripe = null;

async function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const Stripe = (await import("stripe")).default;
  _stripe = new Stripe(key, { apiVersion: "2023-10-16" });
  return _stripe;
}

/**
 * Reembolsa um PaymentIntent Stripe. Sem `amountEUR`, reembolsa o
 * valor total cobrado nesse PaymentIntent.
 */
export async function refundStripePaymentIntent(paymentIntentId, amountEUR = null) {
  const stripe = await getStripe();
  if (!stripe) throw new Error("Stripe não configurado (STRIPE_SECRET_KEY em falta).");

  const params = { payment_intent: paymentIntentId };
  if (amountEUR != null) params.amount = Math.round(Number(amountEUR) * 100);

  const refund = await stripe.refunds.create(params);
  return { ok: true, refundId: refund.id, status: refund.status };
}
