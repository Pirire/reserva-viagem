// src/routes/payments.routes.js
import { Router } from "express";
import crypto from "crypto";

import ShareInvite from "../models/ShareInvite.js";
import ShareTrip from "../models/ShareTrip.js";
import { finalizeSharedTrip } from "../services/shareFinalize.service.js";

const router = Router();
console.log("✅ payments.routes.js carregado");

/* =========================================================
   PAYPAL HELPERS (Node 18+ tem fetch global)
========================================================= */
// Le a primeira env definida de entre varios nomes possiveis.
// MOTIVO: o projeto acumulou dois nomes para a mesma coisa —
// paypalClient.js usa PAYPAL_CLIENT_SECRET/PAYPAL_ENV e este
// ficheiro usava PAYPAL_SECRET/PAYPAL_MODE. Consoante o que
// estivesse definido no Render, um dos caminhos falhava; pior,
// se PAYPAL_MODE nao existisse, este ficheiro assumia "sandbox"
// e cobrava com dinheiro de brincar em producao.
function envAny(...nomes) {
  for (const n of nomes) {
    const v = String(process.env[n] || "").trim();
    if (v) return v;
  }
  return "";
}

function paypalBaseUrl() {
  const mode = envAny("PAYPAL_MODE", "PAYPAL_ENV").toLowerCase();
  const live = mode === "live" || mode === "production";
  return live ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

function mustEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// Aviso no arranque — um PayPal em sandbox sem ninguem dar por isso
// e um erro caro e silencioso.
if (!envAny("PAYPAL_MODE", "PAYPAL_ENV")) {
  console.warn('⚠️ [payments] PAYPAL_MODE/PAYPAL_ENV nao definido — a usar SANDBOX (pagamentos NAO sao reais).');
}
if (!envAny("PAYPAL_WEBHOOK_ID")) {
  console.warn('⚠️ [payments] PAYPAL_WEBHOOK_ID nao definido — o webhook vai RECUSAR todos os eventos.');
}

let cachedToken = { value: "", exp: 0 };

async function getPaypalAccessToken() {
  const now = Date.now();
  if (cachedToken.value && cachedToken.exp > now + 30_000) return cachedToken.value;

  const clientId = mustEnv("PAYPAL_CLIENT_ID");
  const secret = envAny("PAYPAL_SECRET", "PAYPAL_CLIENT_SECRET");
  if (!secret) throw new Error("Missing env: PAYPAL_SECRET (ou PAYPAL_CLIENT_SECRET)");

  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const r = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error_description || data?.message || `PayPal token HTTP ${r.status}`);

  const expiresIn = Number(data.expires_in || 300);
  cachedToken.value = data.access_token;
  cachedToken.exp = Date.now() + expiresIn * 1000;

  return cachedToken.value;
}

async function paypalRequest(path, { method = "GET", body = null } = {}) {
  const token = await getPaypalAccessToken();
  const r = await fetch(`${paypalBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : null,
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.message || data?.name || `PayPal HTTP ${r.status}`);
  return data;
}

function findLink(links, rel) {
  const arr = Array.isArray(links) ? links : [];
  const x = arr.find((l) => String(l.rel || "").toLowerCase() === String(rel).toLowerCase());
  return x?.href || "";
}

/* =========================================================
   REEMBOLSO PAYPAL
   POST /v2/payments/captures/{capture_id}/refund
   Sem "amount" no body = reembolso total da captura.
   Exportado para ser usado por partilha.routes.js (recálculo de
   partilha / cancelamento), sem duplicar a lógica de autenticação
   PayPal já existente aqui.
========================================================= */
export async function paypalRefundCapture(captureId, amountEUR = null) {
  if (!captureId) throw new Error("captureId obrigatório para reembolso PayPal.");
  const body = {};
  if (amountEUR != null) {
    body.amount = { value: Number(amountEUR).toFixed(2), currency_code: "EUR" };
  }
  const result = await paypalRequest(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
    method: "POST",
    body,
  });
  return result; // { id, status: "COMPLETED", ... }
}

/* =========================================================
   DIAGNÓSTICO
========================================================= */
router.get("/payments/ping", (req, res) => res.json({ ok: true, pong: true, where: "payments.routes.js" }));

router.get("/payments/health", (req, res) => {
  return res.json({
    ok: true,
    paypalMode: String(process.env.PAYPAL_MODE || "sandbox"),
    hasPaypalClientId: Boolean(process.env.PAYPAL_CLIENT_ID),
    hasPaypalSecret: Boolean(envAny("PAYPAL_SECRET", "PAYPAL_CLIENT_SECRET")),
    hasPaypalWebhookId: Boolean(process.env.PAYPAL_WEBHOOK_ID),
  });
});

/* =========================================================
   CREATE ORDER
   POST /api/payments/create-order
   body: {
     refType: "share_invite" | "reserva",
     refId: string,            // ex: inviteId OR reservaId
     shareId?: string,         // opcional
     amount: number,
     currency?: "EUR",
     description?: string,
     returnUrl?: string,
     cancelUrl?: string
   }

   resp: { ok, orderId, approveUrl }
========================================================= */
router.post("/payments/create-order", async (req, res) => {
  try {
    const refType = String(req.body?.refType || "").trim();
    const refId = String(req.body?.refId || "").trim();
    const shareId = String(req.body?.shareId || "").trim();

    const currency = String(req.body?.currency || "EUR").toUpperCase();
    const amount = Number(req.body?.amount);

    if (!refType || !refId) {
      return res.status(400).json({ ok: false, message: "refType e refId são obrigatórios." });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, message: "amount inválido." });
    }

    const description = String(req.body?.description || "REALMETROPOLIS — Pagamento").slice(0, 127);

    // Nota: custom_id é útil para mapear no webhook/capture
    const customId = `${refType}:${refId}`;

    const order = await paypalRequest("/v2/checkout/orders", {
      method: "POST",
      body: {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: "PU-1",
            custom_id: customId,
            description,
            amount: {
              currency_code: currency,
              value: amount.toFixed(2),
            },
          },
        ],
        application_context: {
          brand_name: "REALMETROPOLIS",
          landing_page: "LOGIN",
          user_action: "PAY_NOW",
          // URLs opcionais (se usares redirect checkout)
          return_url: String(req.body?.returnUrl || ""),
          cancel_url: String(req.body?.cancelUrl || ""),
        },
      },
    });

    const orderId = String(order?.id || "");
    const approveUrl = findLink(order?.links, "approve");

    // Opcional: guardar orderId no doc (quando for share_invite)
    if (refType === "share_invite") {
      await ShareInvite.updateOne(
        { inviteId: refId },
        {
          $set: {
            paymentOrderId: orderId,
            paymentApproveUrl: approveUrl || null,
            paymentCurrency: currency,
            paymentAmount: Number(amount.toFixed(2)),
            paymentCreatedAt: Date.now(),
          },
        }
      );
    }

    return res.json({ ok: true, orderId, approveUrl, currency, amount: Number(amount.toFixed(2)), shareId: shareId || undefined });
  } catch (err) {
    console.error("❌ /payments/create-order:", err);
    return res.status(500).json({ ok: false, message: err?.message || "Erro interno." });
  }
});

/* =========================================================
   CAPTURE ORDER
   POST /api/payments/capture-order
   body: { orderId, refType?, refId? }

   resp: { ok, status, captureId }
========================================================= */
router.post("/payments/capture-order", async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || "").trim();
    if (!orderId) return res.status(400).json({ ok: false, message: "orderId obrigatório." });

    const capture = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      body: {},
    });

    const status = String(capture?.status || "");
    const pu = Array.isArray(capture?.purchase_units) ? capture.purchase_units[0] : null;
    const cap = pu?.payments?.captures?.[0] || null;

    const captureId = String(cap?.id || "");
    const customId = String(pu?.custom_id || pu?.reference_id || "");

    // Se pago, marcar no DB
    if (status === "COMPLETED") {
      await markPaidFromCustomId(customId, {
        orderId,
        captureId,
        rawStatus: status,
      }, req.app.get("io"));
    }

    return res.json({ ok: true, status, captureId, orderId });
  } catch (err) {
    console.error("❌ /payments/capture-order:", err);
    return res.status(500).json({ ok: false, message: err?.message || "Erro interno." });
  }
});

/* =========================================================
   WEBHOOK HANDLER (deve ser montado com express.raw no app.js)
   POST /api/payments/webhook
========================================================= */
/* =========================================================
   VERIFICACAO DA ASSINATURA DO WEBHOOK  (OBRIGATORIA)
   ---------------------------------------------------------
   Sem isto, o /payments/webhook aceitava QUALQUER pedido: bastava
   enviar um JSON com um inviteId para marcar o convite como pago,
   o que dispara finalizeSharedTrip() e despacha um motorista a
   serio. Viagem real, sem pagamento nenhum.

   A PayPal expoe /v1/notifications/verify-webhook-signature para
   confirmar que o evento veio mesmo deles. Precisa do
   PAYPAL_WEBHOOK_ID (consola PayPal → Webhooks).

   FALHA FECHADA: se o webhook id nao estiver definido, ou a
   verificacao nao devolver SUCCESS, o evento e RECUSADO. Preferimos
   perder uma confirmacao (o /capture-order tambem marca como pago)
   do que aceitar uma falsa.
========================================================= */
async function webhookAssinaturaValida(req, event) {
  const webhookId = envAny("PAYPAL_WEBHOOK_ID");
  if (!webhookId) return { ok: false, motivo: "PAYPAL_WEBHOOK_ID nao definido" };

  const h = (nome) => String(req.headers[nome] || "");
  const corpo = {
    auth_algo:         h("paypal-auth-algo"),
    cert_url:          h("paypal-cert-url"),
    transmission_id:   h("paypal-transmission-id"),
    transmission_sig:  h("paypal-transmission-sig"),
    transmission_time: h("paypal-transmission-time"),
    webhook_id:        webhookId,
    webhook_event:     event,
  };

  if (!corpo.transmission_id || !corpo.transmission_sig || !corpo.cert_url) {
    return { ok: false, motivo: "cabecalhos de assinatura em falta" };
  }

  try {
    const r = await paypalRequest("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      body: corpo,
    });
    const estado = String(r?.verification_status || "").toUpperCase();
    return { ok: estado === "SUCCESS", motivo: estado || "sem verification_status" };
  } catch (err) {
    return { ok: false, motivo: err?.message || "erro ao verificar" };
  }
}

async function markPaidFromCustomId(customIdRaw, info = {}, io = null) {
  const customId = String(customIdRaw || "").trim();
  // formato esperado: "share_invite:INV-xxxx" ou "reserva:RES-xxx"
  const [refType, refId] = customId.split(":");

  if (refType === "share_invite" && refId) {
    const inv = await ShareInvite.findOne({ inviteId: refId });
    if (!inv) return;

    // Idempotência: se já está pago, não mexe
    if (String(inv.status || "").toLowerCase() === "pagou") return;

    // Campos comuns a Stripe e PayPal (ver ShareInvite.js) — antes
    // disto, o PayPal escrevia em paymentCaptureId/paymentStatus,
    // campos diferentes dos que o Stripe usa (payRef/payProvider),
    // o que impedia o reembolso automático de saber onde procurar.
    inv.status = "pagou";
    inv.paidAt = Date.now();
    inv.payProvider = "paypal";
    inv.payRef = info.captureId || inv.payRef || null;
    inv.paidAmount = Number(inv.amountDue || inv.paymentAmount || 0);
    inv.paymentOrderId = info.orderId || inv.paymentOrderId || null;
    await inv.save();

    // Se todos pagos, finaliza a viagem real (cria Reserva + despacha)
    const shareId = String(inv.shareId || "");
    if (shareId) {
      await finalizeSharedTrip(shareId, io);
    }

    return;
  }

  // Reserva (tu tens reservas.routes.js, mas não me deste o model aqui)
  // Deixo pronto para ligares quando quiseres:
  // if (refType === "reserva" && refId) { ... marcar reserva paga ... }
}

router.post("/payments/webhook", async (req, res) => {
  try {
    // IMPORTANTE: este handler precisa do raw body no app.js
    const body = req.body; // se montado com raw, aqui é Buffer
    let event;

    // Se vier Buffer (raw), faz parse
    if (Buffer.isBuffer(body)) {
      event = JSON.parse(body.toString("utf8"));
    } else {
      // fallback (dev) — quando não está raw
      event = body;
    }

    // ── PORTA FECHADA: so passa o que a PayPal assinou ──
    const assinatura = await webhookAssinaturaValida(req, event);
    if (!assinatura.ok) {
      console.warn("🚫 [payments/webhook] evento RECUSADO —", assinatura.motivo);
      return res.status(403).json({ ok: false, message: "Assinatura invalida." });
    }

    const eventType = String(event?.event_type || "");
    const resource = event?.resource || {};
    const orderId = String(resource?.id || resource?.supplementary_data?.related_ids?.order_id || "");

    // Pegamos custom_id do purchase_unit (quando disponível)
    const pu = Array.isArray(resource?.purchase_units) ? resource.purchase_units[0] : null;
    const customId = String(pu?.custom_id || "");

    // Eventos comuns: CHECKOUT.ORDER.APPROVED / PAYMENT.CAPTURE.COMPLETED
    if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
      const captureId = String(resource?.id || "");
      await markPaidFromCustomId(customId, { orderId, captureId, rawStatus: "COMPLETED" }, req.app.get("io"));
    }

    // responde 200 sempre (PayPal precisa)
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("❌ /payments/webhook:", err);
    return res.status(200).json({ ok: true }); // PayPal não deve ficar a “replayar” infinitamente por erro de parse
  }
});

export default router;