// src/routes/ticket.routes.js
//
// Sistema de tickets para hóspedes.
// Fluxo: Hotel cria reserva → sistema gera ticket → hóspede recebe link → hóspede paga
//
// Pagamentos suportados:
//   - PayPal      (SDK oficial)
//   - Stripe      (cartão + Google Pay + Apple Pay)
//   - Easypay     (MB Way + MBRef — gateway português)
//
import { Router }    from "express";
import crypto        from "crypto";
import jwt           from "jsonwebtoken";
import nodemailer    from "nodemailer";
import Reserva       from "../models/Reserva.js";
import { calculateTripPrice } from "../modules/pricing/pricing.service.js";
import { criarEDespacharViagem } from "../services/criarEDespacharViagem.service.js";
import { notificarConvite } from "../services/notificarConvite.service.js";

// Providers (instalados separadamente — ver README)
// npm install stripe @paypal/checkout-server-sdk easypay-checkout
let stripe, easypay;
try { stripe   = (await import("stripe")).default(process.env.STRIPE_SECRET_KEY || ""); }   catch (_) {}
try { easypay  = (await import("easypay-checkout")).default; }                               catch (_) {}

const router = Router();
console.log("✅ ticket.routes.js carregado");

/* ================================================================
   HELPER — autenticação de hotel/colaborador/admin
   Aceita qualquer token que não seja de cliente simples.
================================================================ */
function getHotelPayload(req) {
  try {
    const secret = String(process.env.JWT_SECRET || "").trim();
    if (!secret) return null;
    const auth  = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim()
      : (req.cookies?.rm_parceiro_token || req.cookies?.parceiro_token
         || req.cookies?.token || req.cookies?.rm_token || "");
    if (!token) return null;
    // Aceitar qualquer typ válido (parceiro, colaborador, adminmaster, etc.)
    return jwt.verify(token, secret);
  } catch (_) { return null; }
}

function requireHotel(req, res, next) {
  const p = getHotelPayload(req);
  if (!p) return res.status(401).json({ ok: false, message: "Autenticação necessária." });
  // Bloquear apenas tokens de cliente simples
  const typ = String(p?.typ || p?.tipo || "").toLowerCase();
  const bloqueado = typ === "cliente" || typ === "client";
  if (bloqueado) return res.status(403).json({ ok: false, message: "Acesso reservado a hotéis e parceiros." });
  req.hotelPayload = p;
  next();
}

/* ================================================================
   HELPER — gera token único para o ticket
================================================================ */
function gerarTokenTicket() {
  return crypto.randomBytes(24).toString("hex");
}

/* ================================================================
   POST /api/ticket/criar
   Autenticado (hotel/colaborador) — cria reserva com modo hóspede paga.
   O hóspede recebe um link com o token para pagar.

   Body: {
     nomeHospede, emailHospede, telefoneHospede?,
     categoria, partida, destino, datahora,
     distanciaKm, valor?,
     origemGeo?, destinoGeo?,
     observacoes?, extras?
   }
================================================================ */
router.post("/ticket/criar", requireHotel, async (req, res) => {
  try {
    const {
      nomeHospede, emailHospede, telefoneHospede,
      categoria, partida, destino, datahora,
      distanciaKm, valor,
      origemGeo, destinoGeo, observacoes, extras
    } = req.body || {};

    // Quem paga — "hotel" (paga já, antecipadamente) ou "hospede"
    // (recebe um link para pagar a sua própria viagem). Antes disto
    // estava sempre fixo em "HOSPEDE_PAGA".
    const pagador = req.body?.pagador === "hotel" ? "hotel" : "hospede";

    // Canal de notificação — "sms" | "email" | "ambos". Antes desta
    // versão, o ticket NUNCA era notificado automaticamente — só
    // devolvia o link na resposta, para o hotel copiar manualmente.
    const notifMethod = ["sms", "email", "ambos"].includes(req.body?.notifMethod)
      ? req.body.notifMethod
      : "email"; // ticket sempre teve fluxo de email; mantido como default

    // Prazo de confirmação/pagamento — ex: "regresso à meia-noite,
    // válido até às 04:00". Opcional.
    const validUntil = req.body?.validUntil ? new Date(req.body.validUntil).getTime() : null;

    if (!nomeHospede || !emailHospede || !categoria || !partida || !destino || !datahora) {
      return res.status(400).json({
        ok: false,
        message: "Campos obrigatórios: nomeHospede, emailHospede, categoria, partida, destino, datahora."
      });
    }

    // Calcula preço se não foi enviado
    let valorFinal = Number(valor || 0);
    if (!valorFinal && distanciaKm) {
      const calc = calculateTripPrice({
        categoria,
        distanciaKm: Number(distanciaKm),
        contexto: { origemTexto: partida, destinoTexto: destino }
      });
      if (calc.ok) valorFinal = calc.total;
    }

    const tokenTicket = gerarTokenTicket();
    const codigo      = "TKT-" + Date.now();

    const reserva = await Reserva.create({
      codigo,
      canal:        "parceiro",
      clienteId:    null,
      nome:         String(nomeHospede).trim(),
      email:        String(emailHospede).toLowerCase().trim(),
      contacto:     String(telefoneHospede || "").trim(),
      categoria:    String(categoria).trim(),
      partida:      String(partida).trim(),
      destino:      String(destino).trim(),
      origemGeo:    origemGeo  || null,
      destinoGeo:   destinoGeo || null,
      datahora:     new Date(datahora),
      valor:        valorFinal,
      observacoes:  String(observacoes || ""),
      extras:       {
        ...(extras || {}),
        politicaPagamento: pagador === "hotel" ? "HOTEL_PAGA" : "HOSPEDE_PAGA",
        notifMethod,
        validUntil,
        tokenTicket,
        ticketPago:        false,
        ticketCriadoPor:   req.hotelPayload?.id || req.hotelPayload?.usuário || "hotel"
      },
      status:   "pendente",
      pagamento: { provider: "nenhum", status: "pendente" }
    });

    const ticketUrl = `${process.env.APP_URL || "https://realmetropolis.pt"}/ticket.html?t=${tokenTicket}`;

    // Se o HOTEL paga antecipadamente, não há pagamento a aguardar
    // do hóspede — marcar pago e despachar de imediato. Reaproveita
    // marcarTicketPago() (mesma função usada pelos pagamentos do
    // hóspede via Stripe/PayPal/MB Way), por isso o despacho fica
    // sempre consistente, qualquer que seja quem pagou.
    if (pagador === "hotel") {
      try {
        await marcarTicketPago(reserva, "manual", `HOTEL-${codigo}`, req.app.get("io"));
      } catch (errPagHotel) {
        console.error("⚠️ [ticket] pagamento pelo hotel falhou:", errPagHotel?.message);
      }
    }

    // Notificar o hóspede automaticamente — ANTES, o ticket nunca era
    // enviado de imediato; o hotel tinha sempre de copiar o link e
    // partilhá-lo manualmente (por fora do sistema).
    const prazoTexto = validUntil
      ? `\nConfirme/pague até às ${new Date(validUntil).toLocaleString("pt-PT", { hour: "2-digit", minute: "2-digit" })}, ou o pedido será cancelado.`
      : "";
    const smsBody =
      `REALMETROPOLIS: Olá ${nomeHospede}! O seu transfer (${partida} → ${destino}, ${new Date(datahora).toLocaleString("pt-PT")}) está pronto. ` +
      (pagador === "hotel" ? "Já está pago pelo hotel. " : "") +
      `Aceda: ${ticketUrl}` + prazoTexto;
    const emailHtml =
      `<p>Olá ${nomeHospede}!</p>` +
      `<p>O seu transfer está pronto:</p>` +
      `<p>📍 ${partida} → ${destino}<br>🕐 ${new Date(datahora).toLocaleString("pt-PT")}</p>` +
      (pagador === "hotel" ? `<p><b>Já está pago pelo hotel.</b></p>` : `<p>Valor: €${valorFinal.toFixed(2)}</p>`) +
      `<p><a href="${ticketUrl}">Aceder ao ticket</a></p>` +
      (validUntil ? `<p>Confirme até às <b>${new Date(validUntil).toLocaleString("pt-PT")}</b>, ou o pedido será cancelado.</p>` : "");

    notificarConvite({
      metodo: notifMethod,
      contacto: telefoneHospede,
      email: emailHospede,
      smsBody,
      emailSubject: "O seu transfer REALMETROPOLIS está pronto",
      emailHtml,
    }).catch(err => console.error("⚠️ [ticket] notificação falhou:", err?.message));

    return res.json({
      ok:         true,
      reservaId:  String(reserva._id),
      codigo,
      tokenTicket,
      ticketUrl,
      valor:      valorFinal,
      mensagem:   `Ticket criado. Envie o link ao hóspede: ${ticketUrl}`
    });
  } catch (err) {
    console.error("❌ /ticket/criar:", err);
    return res.status(500).json({ ok: false, message: "Erro ao criar ticket." });
  }
});

/* ================================================================
   GET /api/ticket/:token
   Público — devolve dados do ticket para a página do hóspede.
================================================================ */
router.get("/ticket/:token", async (req, res) => {
  try {
    const reserva = await Reserva.findOne({
      "extras.tokenTicket": req.params.token
    }).lean();

    if (!reserva) return res.status(404).json({ ok: false, message: "Ticket não encontrado." });

    const pago = reserva.pagamento?.status === "pago" || reserva.extras?.ticketPago === true;

    return res.json({
      ok: true,
      ticket: {
        reservaId:  String(reserva._id),
        codigo:     reserva.codigo,
        nome:       reserva.nome,
        partida:    reserva.partida,
        destino:    reserva.destino,
        datahora:   reserva.datahora,
        categoria:  reserva.categoria,
        valor:      reserva.valor,
        status:     reserva.status,
        pago,
        pagamentoStatus: reserva.pagamento?.status || "pendente"
      }
    });
  } catch (err) {
    console.error("❌ /ticket/:token GET:", err);
    return res.status(500).json({ ok: false, message: "Erro ao obter ticket." });
  }
});

/* ================================================================
   POST /api/ticket/:token/paypal/criar-ordem
   Público — cria ordem PayPal para o hóspede pagar.
================================================================ */
router.post("/ticket/:token/paypal/criar-ordem", async (req, res) => {
  try {
    const reserva = await Reserva.findOne({ "extras.tokenTicket": req.params.token });
    if (!reserva) return res.status(404).json({ ok: false, message: "Ticket não encontrado." });
    if (reserva.pagamento?.status === "pago") return res.status(400).json({ ok: false, message: "Ticket já pago." });

    const baseUrl   = process.env.PAYPAL_API_URL || "https://api-m.sandbox.paypal.com";
    const clientId  = process.env.PAYPAL_CLIENT_ID || "";
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET || "";

    if (!clientId || !clientSecret) {
      return res.status(500).json({ ok: false, message: "PayPal não configurado no servidor." });
    }

    // Obter token de acesso PayPal
    const authRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
        "Content-Type":  "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    });
    const authData   = await authRes.json();
    const accessToken = authData.access_token;

    // Criar ordem
    const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type":  "application/json"
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: reserva.codigo,
          description:  `REALMETROPOLIS — ${reserva.partida} → ${reserva.destino}`,
          amount: {
            currency_code: "EUR",
            value: Number(reserva.valor).toFixed(2)
          }
        }],
        application_context: {
          brand_name:   "REALMETROPOLIS",
          landing_page: "BILLING",
          user_action:  "PAY_NOW"
        }
      })
    });
    const orderData = await orderRes.json();

    return res.json({ ok: true, orderId: orderData.id });
  } catch (err) {
    console.error("❌ paypal/criar-ordem:", err);
    return res.status(500).json({ ok: false, message: "Erro ao criar ordem PayPal." });
  }
});

/* ================================================================
   POST /api/ticket/:token/paypal/capturar/:orderId
   Público — captura o pagamento após aprovação do hóspede.
================================================================ */
router.post("/ticket/:token/paypal/capturar/:orderId", async (req, res) => {
  try {
    const reserva = await Reserva.findOne({ "extras.tokenTicket": req.params.token });
    if (!reserva) return res.status(404).json({ ok: false, message: "Ticket não encontrado." });

    const baseUrl      = process.env.PAYPAL_API_URL || "https://api-m.sandbox.paypal.com";
    const clientId     = process.env.PAYPAL_CLIENT_ID || "";
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET || "";

    const authRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
        "Content-Type":  "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    });
    const { access_token } = await authRes.json();

    const captureRes = await fetch(`${baseUrl}/v2/checkout/orders/${req.params.orderId}/capture`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${access_token}`, "Content-Type": "application/json" }
    });
    const captureData = await captureRes.json();

    if (captureData.status === "COMPLETED") {
      await marcarTicketPago(reserva, "paypal", captureData.id, req.app.get("io"));
      return res.json({ ok: true, message: "Pagamento confirmado. Obrigado!" });
    }

    return res.status(400).json({ ok: false, message: "Pagamento não completado." });
  } catch (err) {
    console.error("❌ paypal/capturar:", err);
    return res.status(500).json({ ok: false, message: "Erro ao capturar pagamento." });
  }
});

/* ================================================================
   POST /api/ticket/:token/stripe/criar-intent
   Público — cria PaymentIntent Stripe (cartão, Google Pay, Apple Pay).
================================================================ */
router.post("/ticket/:token/stripe/criar-intent", async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ ok: false, message: "Stripe não configurado. Instale: npm install stripe" });

    const reserva = await Reserva.findOne({ "extras.tokenTicket": req.params.token });
    if (!reserva) return res.status(404).json({ ok: false, message: "Ticket não encontrado." });
    if (reserva.pagamento?.status === "pago") return res.status(400).json({ ok: false, message: "Ticket já pago." });

    const intent = await stripe.paymentIntents.create({
      amount:   Math.round(Number(reserva.valor) * 100), // cêntimos
      currency: "eur",
      metadata: { reservaId: String(reserva._id), codigo: reserva.codigo },
      description: `REALMETROPOLIS — ${reserva.partida} → ${reserva.destino}`,
      receipt_email: reserva.email
    });

    return res.json({ ok: true, clientSecret: intent.client_secret });
  } catch (err) {
    console.error("❌ stripe/criar-intent:", err);
    return res.status(500).json({ ok: false, message: "Erro ao criar pagamento Stripe." });
  }
});

/* ================================================================
   POST /api/ticket/:token/stripe/confirmar
   Público — confirma pagamento após Stripe retornar sucesso.
================================================================ */
router.post("/ticket/:token/stripe/confirmar", async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ ok: false, message: "Stripe não configurado." });

    const { paymentIntentId } = req.body || {};
    const reserva = await Reserva.findOne({ "extras.tokenTicket": req.params.token });
    if (!reserva) return res.status(404).json({ ok: false, message: "Ticket não encontrado." });

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status === "succeeded") {
      await marcarTicketPago(reserva, "stripe", paymentIntentId, req.app.get("io"));
      return res.json({ ok: true, message: "Pagamento confirmado. Obrigado!" });
    }

    return res.status(400).json({ ok: false, message: `Estado do pagamento: ${intent.status}` });
  } catch (err) {
    console.error("❌ stripe/confirmar:", err);
    return res.status(500).json({ ok: false, message: "Erro ao confirmar pagamento Stripe." });
  }
});

/* ================================================================
   POST /api/ticket/:token/mbway/iniciar
   Público — inicia pagamento MB Way via Easypay.
   Body: { telefone } — ex: "351912345678"
================================================================ */
router.post("/ticket/:token/mbway/iniciar", async (req, res) => {
  try {
    const easypayId  = process.env.EASYPAY_ID  || "";
    const easypayKey = process.env.EASYPAY_KEY || "";

    if (!easypayId || !easypayKey) {
      return res.status(500).json({ ok: false, message: "Easypay não configurado. Adicione EASYPAY_ID e EASYPAY_KEY ao .env" });
    }

    const reserva = await Reserva.findOne({ "extras.tokenTicket": req.params.token });
    if (!reserva) return res.status(404).json({ ok: false, message: "Ticket não encontrado." });
    if (reserva.pagamento?.status === "pago") return res.status(400).json({ ok: false, message: "Ticket já pago." });

    const { telefone } = req.body || {};
    if (!telefone) return res.status(400).json({ ok: false, message: "Indique o número de telemóvel." });

    // Normaliza número PT: 912345678 → 351912345678
    const telNorm = String(telefone).replace(/\D/g, "").replace(/^0+/, "").replace(/^351/, "351");
    const telFinal = telNorm.startsWith("351") ? telNorm : "351" + telNorm;

    // Easypay API v2
    const baseUrl = process.env.EASYPAY_SANDBOX === "true"
      ? "https://api.test.easypay.pt/2.0"
      : "https://api.easypay.pt/2.0";

    // 1) Criar payment
    const payRes = await fetch(`${baseUrl}/payment`, {
      method: "POST",
      headers: {
        "AccountId": easypayId,
        "ApiKey":    easypayKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: ["mbw"],
        key:  reserva.codigo,
        value: Number(reserva.valor),
        customer: {
          name:  reserva.nome,
          email: reserva.email,
          phone: telFinal
        },
        currency: "EUR"
      })
    });
    const payData = await payRes.json();

    if (!payData?.id) {
      return res.status(400).json({ ok: false, message: payData?.message || "Erro Easypay." });
    }

    // Guarda o ID do pagamento para confirmar depois
    reserva.pagamento.provider = "mbway";
    reserva.pagamento.status   = "pendente";
    reserva.pagamento.ref      = payData.id;
    await reserva.save();

    return res.json({
      ok:       true,
      message:  `Pedido MB Way enviado para ${telFinal}. Aceite na app MB Way no prazo de 4 minutos.`,
      paymentId: payData.id
    });
  } catch (err) {
    console.error("❌ mbway/iniciar:", err);
    return res.status(500).json({ ok: false, message: "Erro ao iniciar MB Way." });
  }
});

/* ================================================================
   POST /api/ticket/easypay/webhook
   Público — Easypay notifica quando o pagamento é confirmado.
   Configurar no painel Easypay: Notifications → URL deste endpoint.
================================================================ */
router.post("/ticket/easypay/webhook", async (req, res) => {
  try {
    const { id, type, status } = req.body || {};
    if (type === "payment" && status === "paid" && id) {
      const reserva = await Reserva.findOne({ "pagamento.ref": id });
      if (reserva && reserva.pagamento?.status !== "pago") {
        await marcarTicketPago(reserva, "mbway", id, req.app.get("io"));
      }
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ easypay/webhook:", err);
    return res.status(500).json({ ok: false });
  }
});

/* ================================================================
   HELPER INTERNO — marca ticket como pago e confirma reserva
================================================================ */
async function marcarTicketPago(reserva, provider, ref, io = null) {
  reserva.pagamento.provider = provider;
  reserva.pagamento.status   = "pago";
  reserva.pagamento.paidAt   = new Date();
  reserva.pagamento.ref      = String(ref || "");
  reserva.status             = "confirmada";
  if (reserva.extras) reserva.extras.ticketPago = true;
  await reserva.save();
  console.log(`✅ Ticket pago: ${reserva.codigo} via ${provider}`);

  // Entregar ao despacho profissional — ANTES, o ticket pago ficava
  // só como Reserva confirmada, nunca visível no painel de despacho
  // do admin (que lê exclusivamente de Trip/collection "viagens").
  // Mesmo padrão usado por Reservar, Partilhar, Convidado.
  try {
    const { viagem } = await criarEDespacharViagem({
      tripId: reserva.codigo,
      canal: "colaborador",
      subcanal: "ticket",
      pickup:  reserva.partida,
      dropoff: reserva.destino,
      when:    reserva.datahora,
      origemGeo:  reserva.origemGeo  || null,
      destinoGeo: reserva.destinoGeo || null,
      customer: { nome: reserva.nome, email: reserva.email, contacto: reserva.contacto },
      quote:    { categoria: reserva.categoria, total: reserva.valor, currency: "EUR" },
      paymentStatus: "paid",
      meta: { origemTicket: true, tokenTicket: reserva.extras?.tokenTicket || null, reservaId: String(reserva._id) },
    }, io);
    reserva.extras = { ...(reserva.extras || {}), tripRefId: String(viagem._id) };
    await reserva.save();
  } catch (err) {
    console.error("⚠️ [ticket] dispatch falhou:", err?.message);
  }
  // TODO: Enviar email de confirmação ao hóspede e ao hotel
}

/* ================================================================
   HELPER — SMTP
================================================================ */
function criarTransporte() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

/* ================================================================
   POST /api/ticket/:token/enviar-email
   Autenticado (hotel) — envia o link do ticket por email ao hóspede.
================================================================ */
router.post("/ticket/:token/enviar-email", async (req, res) => {
  try {
    const reserva = await Reserva.findOne({ "extras.tokenTicket": req.params.token });
    if (!reserva) return res.status(404).json({ ok: false, message: "Ticket não encontrado." });

    const emailDestino = String(req.body?.email || reserva.email || "").trim().toLowerCase();
    if (!emailDestino) return res.status(400).json({ ok: false, message: "Email do hóspede não disponível." });

    const transporte = criarTransporte();
    const from = String(process.env.SMTP_FROM || process.env.SMTP_USER || "").trim();

    if (!transporte || !from) {
      return res.status(500).json({ ok: false, message: "SMTP não configurado no servidor. Verifique SMTP_HOST, SMTP_USER e SMTP_PASS no .env" });
    }

    const ticketUrl   = `${process.env.APP_URL || "https://realmetropolis.pt"}/ticket.html?t=${req.params.token}`;
    const dataViagem  = reserva.datahora
      ? new Date(reserva.datahora).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";

    await transporte.sendMail({
      from,
      to: emailDestino,
      subject: "REALMETROPOLIS — O seu ticket de viagem",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#111">
          <div style="background:#060606;padding:24px;border-radius:12px 12px 0 0;text-align:center">
            <div style="color:#d9dde3;font-size:22px;font-weight:900;letter-spacing:2px">REALMETROPOLIS</div>
            <div style="color:#7f8994;font-size:12px;margin-top:4px;letter-spacing:1px">TICKET DE VIAGEM</div>
          </div>
          <div style="background:#f8f9fb;padding:28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
            <p style="margin:0 0 18px;font-size:15px">Olá <strong>${reserva.nome || "Hóspede"}</strong>,</p>
            <p style="margin:0 0 20px;font-size:14px;color:#444">O seu ticket de viagem foi criado. Clique no botão abaixo para ver os detalhes e efetuar o pagamento.</p>

            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px">
              <tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #eee">Partida</td><td style="padding:8px 0;font-weight:700;border-bottom:1px solid #eee;text-align:right">${reserva.partida || "—"}</td></tr>
              <tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #eee">Destino</td><td style="padding:8px 0;font-weight:700;border-bottom:1px solid #eee;text-align:right">${reserva.destino || "—"}</td></tr>
              <tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #eee">Data / Hora</td><td style="padding:8px 0;font-weight:700;border-bottom:1px solid #eee;text-align:right">${dataViagem}</td></tr>
              <tr><td style="padding:8px 0;color:#666">Valor</td><td style="padding:8px 0;font-weight:900;font-size:16px;color:#19d68b;text-align:right">${Number(reserva.valor || 0).toFixed(2)} €</td></tr>
            </table>

            <div style="text-align:center;margin:24px 0">
              <a href="${ticketUrl}" style="display:inline-block;background:#19d68b;color:#000;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:900;font-size:15px;letter-spacing:0.5px">
                PAGAR TICKET
              </a>
            </div>

            <p style="font-size:12px;color:#888;text-align:center;margin:0">
              Se o botão não funcionar, copie este link:<br>
              <a href="${ticketUrl}" style="color:#19d68b;word-break:break-all">${ticketUrl}</a>
            </p>
          </div>
          <div style="text-align:center;padding:16px;font-size:11px;color:#aaa">
            REALMETROPOLIS · Transporte Premium · Portugal
          </div>
        </div>
      `
    });

    console.log(`✅ Email ticket enviado para ${emailDestino} (${req.params.token})`);
    return res.json({ ok: true, message: `Email enviado com sucesso para ${emailDestino}` });

  } catch (err) {
    console.error("❌ /ticket/enviar-email:", err);
    return res.status(500).json({ ok: false, message: "Erro ao enviar email: " + (err.message || "") });
  }
});

export default router;