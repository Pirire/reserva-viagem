// src/routes/convidado.routes.js
//
// Sistema de Convidados — o remetente (hotel/utilizador) reserva viagens
// para os seus convidados, podendo pagar por alguns ou todos.
//
// Fluxo:
//   1. Remetente selecciona convidados + marca quem paga
//   2. Backend calcula total para os pagos pelo remetente
//   3. Stripe cobra o remetente
//   4. Cria Reserva por cada convidado:
//      - Pago pelo remetente → dispatch automático + notificação ao passageiro
//      - Não pago           → ticket link enviado ao convidado (paga ele próprio)

import { Router }   from "express";
import jwt          from "jsonwebtoken";
import crypto       from "crypto";
import mongoose     from "mongoose";
import Reserva      from "../models/Reserva.js";
import { calculateTripPrice } from "../modules/pricing/pricing.service.js";
import { criarEDespacharViagem } from "../services/criarEDespacharViagem.service.js";
import { notificarConvite } from "../services/notificarConvite.service.js";

let _stripe = null;
async function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    const Stripe = (await import("stripe")).default;
    _stripe = new Stripe(key, { apiVersion: "2023-10-16" });
  } catch (e) { console.error("❌ Stripe init:", e.message); }
  return _stripe;
}

const router = Router();
console.log("✅ convidado.routes.js carregado");

// Normaliza a categoria recebida do frontend para o formato que
// calculateTripPrice() espera. Sem isto, "luxo" (enviado pelo
// select do Convidado) nunca corresponde a "luxury" na tabela de
// preços, e "grupo6" (minúsculas) nunca corresponde a "GRUPO6" —
// o cálculo falhava sempre em silêncio, valorIndividual ficava a
// 0, e por isso o Stripe nem chegava a ser chamado, dando sempre
// o mesmo resultado independentemente do cartão usado.
function normalizarCategoria(catRaw) {
  const c = String(catRaw || "").trim().toLowerCase();
  if (c === "luxo") return "luxury";
  if (/^grupo\d+$/.test(c)) return c.toUpperCase(); // grupo6 → GRUPO6
  return c; // economica, confort, executive já estão correctos
}

// Reserva.js exige "email" (required: true). Quando o convidado só
// tem telefone (sem "@"), gravar "" falha a validação — "Path
// `email` is required." mesmo com o campo "definido", porque o
// Mongoose trata string vazia como ausente neste caso. Em vez de
// alterar o schema (email é usado para comunicação noutros sítios
// do sistema), geramos aqui um email sintético, só para satisfazer
// o requisito do modelo, sem afectar nada visível ao convidado.
function emailOuSintetico(contacto) {
  const c = String(contacto || "").trim();
  if (c.includes("@")) return c.toLowerCase();
  const limpo = c.replace(/[^\d]/g, "") || crypto.randomBytes(4).toString("hex");
  return `convidado-${limpo}@sememail.realmetropolis.pt`;
}

/* ================================================================
   AUTH — aceita hotel, admin, utilizador autenticado
================================================================ */
function requireAuth(req, res, next) {
  // Hotel parceiro (já decodificado por middleware anterior, se existir)
  if (req.hotelPayload?.id || req.parceiro?.id) {
    req._authId   = req.hotelPayload?.id || req.parceiro?.id;
    req._authTipo = "hotel";
    return next();
  }
  // Admin (já decodificado por middleware anterior, se existir)
  if (req.admin?.id || req.adminPayload?.id) {
    req._authId   = req.admin?.id || req.adminPayload?.id;
    req._authTipo = "admin";
    return next();
  }

  // Gestor de frota / parceiro hoteleiro — cookie real usado no resto
  // do sistema (ex: veiculos.routes.js). Sem isto, qualquer pedido
  // feito a partir do hotel-dashboard.html falhava sempre aqui,
  // mesmo com sessão válida — daí "Não autenticado." aparecer em
  // todos os fluxos de pagamento do Convidado.
  try {
    const tokenGestor = req.cookies?.rm_colaborador_token || req.cookies?.rm_parceiro_token || "";
    if (tokenGestor) {
      const secret = process.env.JWT_SECRET || "";
      const payload = jwt.verify(tokenGestor, secret);
      req._authId   = payload?.id;
      req._authTipo = "hotel";
      return next();
    }
  } catch (_) { /* tenta os restantes */ }

  // Admin — cookie real (admin_token) ou Bearer, mesmo padrão usado
  // já noutras rotas (ex: veiculos.routes.js).
  try {
    const bearer = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim()
      : "";
    const tokenAdmin = bearer || req.cookies?.admin_token || "";
    if (tokenAdmin) {
      const secret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || "";
      const payload = jwt.verify(tokenAdmin, secret);
      req._authId   = payload?._id || payload?.id || payload?.sub;
      req._authTipo = "admin";
      return next();
    }
  } catch (_) { /* tenta os restantes */ }

  // Utilizador final via cookie/JWT
  const token = req.cookies?.rm_token || req.cookies?.token || "";
  if (token) {
    try {
      const SECRET  = process.env.JWT_SECRET || process.env.RM_SECRET || "";
      const payload = jwt.verify(token, SECRET);
      req._authId   = payload?.id || payload?.sub;
      req._authTipo = "utilizador";
      return next();
    } catch (_) {}
  }
  return res.status(401).json({ ok: false, message: "Não autenticado." });
}

/* ================================================================
   HELPER — código de embarque único
================================================================ */
function gerarCodigoEmbarque() {
  return "RM-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

/* ================================================================
   HELPER — notificar passageiro (email simples via SMTP)
================================================================ */
async function notificarPassageiro({ nome, contacto, codigoEmbarque, partida, destino, datahora, pago, ticketUrl }) {
  // Aceita contacto = telemóvel OU email. O serviço central decide o
  // canal com base no que recebe.
  const parece_email = String(contacto || "").includes("@");
  const telefone = parece_email ? null : String(contacto || "").trim();
  const email    = parece_email ? String(contacto || "").trim().toLowerCase() : null;

  if (!telefone && !email) {
    console.warn("⚠️ notificarPassageiro: sem contacto nem email para", nome);
    return { entregue: false, motivo: "sem contacto" };
  }

  const hora = datahora ? new Date(datahora).toLocaleString("pt-PT", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
  }) : "—";

  // Texto do SMS e HTML do email — variantes: pago já feito ou
  // ticket-link para pagar.
  let smsBody, emailSubject, emailHtml;

  if (pago) {
    smsBody =
      `REALMETROPOLIS: Ola ${nome}, transporte reservado e pago.\n` +
      `${partida} -> ${destino}, ${hora}.\n` +
      `Codigo de embarque: ${codigoEmbarque}. Apresente ao motorista.`;
    emailSubject = "REALMETROPOLIS — Transporte reservado para si";
    emailHtml =
      `<p>Ola <b>${nome}</b>,</p>
       <p>Um transporte foi reservado e <b>pago</b> para si.</p>
       <table style="border-collapse:collapse;width:100%;margin:16px 0">
         <tr><td style="padding:8px;border:1px solid #ddd;color:#666">Partida</td><td style="padding:8px;border:1px solid #ddd">${partida}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;color:#666">Destino</td><td style="padding:8px;border:1px solid #ddd">${destino}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;color:#666">Data / Hora</td><td style="padding:8px;border:1px solid #ddd">${hora}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;color:#666">Codigo</td><td style="padding:8px;border:1px solid #ddd"><b>${codigoEmbarque}</b></td></tr>
       </table>
       <p>Apresente este codigo ao motorista. <b>Nao precisa de pagar nada.</b></p>`;
  } else {
    // Convidado que precisa de pagar — o ticketUrl tem de ir dentro
    // da mensagem, senao a pessoa nao tem como pagar.
    const linkTxt = ticketUrl || "(link indisponivel)";
    smsBody =
      `REALMETROPOLIS: Ola ${nome}, convite para pagar transporte.\n` +
      `${partida} -> ${destino}, ${hora}.\n` +
      `Pagar em: ${linkTxt}`;
    emailSubject = "REALMETROPOLIS — Convite para pagar transporte";
    emailHtml =
      `<p>Ola <b>${nome}</b>,</p>
       <p>Foi escolhido como pagador de uma viagem em grupo.</p>
       <p>Partida: <b>${partida}</b> &rarr; Destino: <b>${destino}</b> em <b>${hora}</b></p>
       <p><a href="${ticketUrl}" style="display:inline-block;padding:12px 20px;background:#1fc97d;color:#000;font-weight:700;border-radius:10px;text-decoration:none">Pagar agora</a></p>
       <p style="font-size:12px;color:#666">Ou copie este link: ${linkTxt}</p>`;
  }

  try {
    const res = await notificarConvite({
      metodo:   parece_email ? "email" : "sms",
      contacto: telefone,
      email,
      smsBody,
      emailSubject,
      emailHtml,
    });
    if (!res.entregue) {
      console.warn(`⚠️ [convidado] Notificação NAO entregue a ${nome}:`,
        res.erros.map(e => `${e.canal}: ${e.motivo}`).join(" | "));
    } else {
      console.log(`📩 [convidado] notificado ${nome} — sms:${res.smsEnviado} email:${res.emailEnviado}`);
    }
    return res;
  } catch (err) {
    console.warn("⚠️ Falha ao notificar passageiro:", err.message);
    return { entregue: false, motivo: err.message };
  }
}

/* ================================================================
   POST /api/convidado/calcular
   Devolve o preço TOTAL da viagem (é uma corrida só, N passageiros).
   O frontend usa isto para mostrar o resumo antes de confirmar.
================================================================ */
router.post("/calcular", requireAuth, async (req, res) => {
  try {
    const { convidados = [], categoria, partida, destino, distanciaKm } = req.body || {};

    let valorTotal = 0;
    if (distanciaKm && categoria) {
      const calc = calculateTripPrice({ categoria: normalizarCategoria(categoria), distanciaKm: Number(distanciaKm), contexto: { origemTexto: partida, destinoTexto: destino } });
      if (calc.ok) valorTotal = calc.total;
    }

    return res.json({
      ok:               true,
      valorTotal,
      totalPassageiros: convidados.length,
    });
  } catch (err) {
    console.error("❌ /convidado/calcular:", err);
    return res.status(500).json({ ok: false, message: "Erro ao calcular." });
  }
});

/* ================================================================
   POST /api/convidado/reservar
   Cria UMA viagem de grupo (não uma por convidado). O remetente
   escolhe UM pagador:
     • "remetente"  → cobra o remetente via Stripe agora, despacha
                     de imediato, envia código de embarque a todos
                     os passageiros
     • "convidado"  → cria a reserva pendente, envia ticket-link
                     APENAS ao convidado pagador; despacho arranca
                     depois do pagamento confirmado
   ANTIGO comportamento (pagoPeloRemetente por convidado, várias
   reservas, multiplicação de valor por N convidados) foi removido —
   era incoerente: cada convidado gerava uma viagem separada, o que
   pertence ao fluxo PARTILHAR, não ao CONVIDADO.
================================================================ */
router.post("/reservar", requireAuth, async (req, res) => {
  try {
    const {
      convidados = [],
      partida, destino, categoria, datahora,
      distanciaKm, origemGeo, destinoGeo,
      stripePaymentMethodId,
      // NOVO: quem paga a viagem toda
      pagadorTipo,           // "remetente" | "convidado"
      pagadorConvidadoIdx,   // índice na lista `convidados` quando pagadorTipo="convidado"
    } = req.body || {};

    if (!partida || !destino || !categoria || !datahora) {
      return res.status(400).json({ ok: false, message: "Campos obrigatórios: partida, destino, categoria, datahora." });
    }
    if (!convidados.length) {
      return res.status(400).json({ ok: false, message: "Indique pelo menos um convidado." });
    }
    for (const c of convidados) {
      if (!c.nome?.trim() || !c.contacto?.trim()) {
        return res.status(400).json({ ok: false, message: "Cada convidado precisa de nome e contacto." });
      }
    }

    // Validar pagador escolhido
    const tipo = ["remetente", "convidado"].includes(pagadorTipo) ? pagadorTipo : "remetente";
    let pagadorConvidado = null;
    if (tipo === "convidado") {
      const idx = Number.isInteger(pagadorConvidadoIdx) ? pagadorConvidadoIdx : -1;
      if (idx < 0 || idx >= convidados.length) {
        return res.status(400).json({ ok: false, message: "pagadorConvidadoIdx inválido." });
      }
      pagadorConvidado = convidados[idx];
    }

    // Preço TOTAL da viagem (única — não é multiplicado por
    // convidados; é uma corrida só, N passageiros).
    let valorTotal = 0;
    if (distanciaKm && categoria) {
      const calc = calculateTripPrice({ categoria: normalizarCategoria(categoria), distanciaKm: Number(distanciaKm), contexto: { origemTexto: partida, destinoTexto: destino } });
      if (calc.ok) valorTotal = calc.total;
    }
    if (valorTotal <= 0) {
      return res.status(400).json({ ok: false, message: "Não foi possível calcular o preço da viagem." });
    }

    const grupoId = "GRP-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
    const codigo  = "CVD-" + Date.now() + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();

    /* ── CASO 1: REMETENTE PAGA ─────────────────────────────── */
    if (tipo === "remetente") {
      const stripe = await getStripe();
      if (!stripe) {
        return res.status(500).json({ ok: false, message: "Stripe não configurado." });
      }
      if (!stripePaymentMethodId) {
        return res.status(400).json({ ok: false, message: "stripePaymentMethodId obrigatório." });
      }

      const intent = await stripe.paymentIntents.create({
        amount:               Math.round(valorTotal * 100),
        currency:             "eur",
        payment_method:       stripePaymentMethodId,
        confirm:              true,
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        description:          `Convidado (${convidados.length} passageiro${convidados.length > 1 ? "s" : ""}) — ${partida} → ${destino}`,
        metadata:             { remetenteId: req._authId, tipo: "convidado" },
      });
      if (intent.status !== "succeeded") {
        return res.status(402).json({ ok: false, message: "Pagamento não concluído.", stripeStatus: intent.status });
      }

      const codigoEmbarque = gerarCodigoEmbarque();
      const primeiro = convidados[0]; // titular da reserva = primeiro passageiro

      const reserva = await Reserva.create({
        codigo,
        canal:       "convidado",
        clienteId:   null,
        nome:        String(primeiro.nome).trim(),
        email:       emailOuSintetico(primeiro.contacto),
        contacto:    String(primeiro.contacto).trim(),
        categoria:   String(categoria).trim(),
        partida:     String(partida).trim(),
        destino:     String(destino).trim(),
        origemGeo:   origemGeo  || null,
        destinoGeo:  destinoGeo || null,
        datahora:    new Date(datahora),
        valor:       valorTotal,
        status:      "confirmada",
        pagamento:   { provider: "stripe", status: "pago", paidAt: new Date(), ref: intent.id },
        extras: {
          politicaPagamento: "REMETENTE_PAGA",
          modoConvidado:     true,
          grupoId,
          codigoEmbarque,
          remetenteId:       req._authId,
          remetenteTipo:     req._authTipo,
          passageiros:       convidados.map(c => ({ nome: String(c.nome).trim(), contacto: String(c.contacto).trim() })),
        },
      });

      // Notificar TODOS os passageiros com o mesmo código de embarque
      // (é uma viagem só; todos entram na mesma corrida)
      for (const c of convidados) {
        try {
          await notificarPassageiro({
            nome: c.nome, contacto: c.contacto, codigoEmbarque,
            partida, destino, datahora, pago: true,
          });
        } catch (e) {
          console.warn("⚠️ [convidado/remetente-paga] notificação falhou para", c.contacto, e?.message);
        }
      }

      // Despachar imediato
      const io = req.app.get("io");
      criarEDespacharViagem({
        tripId: codigo,
        canal: "colaborador",
        subcanal: "convidado",
        pickup:  String(partida).trim(),
        dropoff: String(destino).trim(),
        when:    new Date(datahora),
        origemGeo,
        destinoGeo,
        customer: { nome: primeiro.nome, email: emailOuSintetico(primeiro.contacto), contacto: primeiro.contacto },
        quote:    { categoria: String(categoria).trim(), total: valorTotal, currency: "EUR" },
        paymentStatus: "paid",
        meta: { origemConvidado: true, grupoId, codigoEmbarque, remetenteId: req._authId, remetenteTipo: req._authTipo, reservaId: String(reserva._id), passageiros: convidados.map(c => ({ nome: c.nome, contacto: c.contacto })) },
      }, io)
        .then(({ viagem }) => { reserva.extras = { ...(reserva.extras || {}), tripRefId: String(viagem._id) }; return reserva.save(); })
        .catch(err => console.error("⚠️ [convidado] dispatch falhou:", err?.message));

      return res.json({
        ok:              true,
        grupoId,
        totalPassageiros: convidados.length,
        pagador:         "remetente",
        totalCobrado:    valorTotal,
        stripeChargeId:  intent.id,
        codigoEmbarque,
        reservaId:       String(reserva._id),
      });
    }

    /* ── CASO 2: UM CONVIDADO PAGA ───────────────────────────── */
    // Reserva criada em "pendente"; ticket-link enviado APENAS ao
    // convidado escolhido como pagador. O despacho só arranca quando
    // esse pagamento for confirmado (via rota do ticket).
    const tokenTicket = crypto.randomBytes(16).toString("hex");
    const codigoTicket = "TKT-CVD-" + Date.now() + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();

    const reserva = await Reserva.create({
      codigo: codigoTicket,
      canal:       "convidado",
      clienteId:   null,
      nome:        String(pagadorConvidado.nome).trim(),
      email:       emailOuSintetico(pagadorConvidado.contacto),
      contacto:    String(pagadorConvidado.contacto).trim(),
      categoria:   String(categoria).trim(),
      partida:     String(partida).trim(),
      destino:     String(destino).trim(),
      origemGeo:   origemGeo  || null,
      destinoGeo:  destinoGeo || null,
      datahora:    new Date(datahora),
      valor:       valorTotal,
      status:      "pendente",
      pagamento:   { provider: "nenhum", status: "pendente" },
      extras: {
        politicaPagamento: "CONVIDADO_PAGA",
        modoConvidado:     true,
        grupoId,
        tokenTicket,
        ticketPago:        false,
        remetenteId:       req._authId,
        remetenteTipo:     req._authTipo,
        pagadorNome:       String(pagadorConvidado.nome).trim(),
        pagadorContacto:   String(pagadorConvidado.contacto).trim(),
        passageiros:       convidados.map(c => ({ nome: String(c.nome).trim(), contacto: String(c.contacto).trim() })),
      },
    });

    const ticketUrl = `${process.env.APP_URL || "https://realmetropolis.pt"}/ticket.html?t=${tokenTicket}`;

    // Notificar SÓ o pagador com o ticket para pagar
    try {
      await notificarPassageiro({
        nome: pagadorConvidado.nome, contacto: pagadorConvidado.contacto, codigoEmbarque: null,
        partida, destino, datahora, pago: false, ticketUrl,
      });
    } catch (e) {
      console.warn("⚠️ [convidado/convidado-paga] notificação do pagador falhou:", e?.message);
    }

    return res.json({
      ok:              true,
      grupoId,
      totalPassageiros: convidados.length,
      pagador:         "convidado",
      pagadorNome:     pagadorConvidado.nome,
      pagadorContacto: pagadorConvidado.contacto,
      valorTotal,
      ticketUrl,
      reservaId:       String(reserva._id),
      status:          "aguarda_pagamento_convidado",
    });
  } catch (err) {
    console.error("❌ /convidado/reservar:", err);
    return res.status(500).json({ ok: false, message: err?.message || "Erro interno." });
  }
});

/* ================================================================
   GET /api/convidado/reservas
   Lista as reservas criadas pelo remetente autenticado.
================================================================ */
router.get("/reservas", requireAuth, async (req, res) => {
  try {
    const reservas = await Reserva.find({
      "extras.remetenteId": req._authId,
      "extras.modoConvidado": true,
    })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

    return res.json({
      ok: true,
      total: reservas.length,
      reservas: reservas.map(r => ({
        id:              String(r._id),
        codigo:          r.codigo,
        nome:            r.nome,
        contacto:        r.contacto,
        partida:         r.partida,
        destino:         r.destino,
        datahora:        r.datahora,
        categoria:       r.categoria,
        valor:           r.valor,
        status:          r.status,
        codigoEmbarque:  r.extras?.codigoEmbarque || null,
        pagoPeloRemetente: r.extras?.politicaPagamento === "REMETENTE_PAGA",
        ticketUrl:       r.extras?.tokenTicket
          ? `${process.env.APP_URL || "https://realmetropolis.pt"}/ticket.html?t=${r.extras.tokenTicket}`
          : null,
      })),
    });
  } catch (err) {
    console.error("❌ /convidado/reservas:", err);
    return res.status(500).json({ ok: false, message: "Erro ao listar reservas." });
  }
});

/* ================================================================
   GET /api/convidado/grupos-ativos
   Agrupa as reservas de convidados por grupoId — usado pela lista
   unificada "PARTILHAS" (mostra Partilha normal, Evento e
   Convidado todos juntos, como grupos lado a lado).
================================================================ */
router.get("/grupos-ativos", requireAuth, async (req, res) => {
  try {
    // Excluído "em_viagem" também — não só "concluida"/"cancelada".
    // Sem isto, um grupo continuava a aparecer como "pendente" para
    // sempre, mesmo depois de o motorista já ter iniciado a recolha
    // a sério (é isso que muda o status da Reserva para "em_viagem",
    // ver /api/tracking/iniciar) — já não é uma reserva por iniciar,
    // é uma viagem em curso.
    const reservas = await Reserva.find({
      "extras.remetenteId": req._authId,
      "extras.modoConvidado": true,
      status: { $nin: ["concluida", "cancelada", "em_viagem"] },
    }).sort({ createdAt: -1 }).limit(200).lean();

    const grupos = {};
    for (const r of reservas) {
      const gid = r.extras?.grupoId;
      if (!gid) continue; // reservas antigas, sem grupoId — ignoradas na vista agrupada
      if (!grupos[gid]) {
        grupos[gid] = {
          grupoId: gid,
          partida: r.partida,
          destino: r.destino,
          origemGeo: r.origemGeo || null,
          destinoGeo: r.destinoGeo || null,
          categoria: r.categoria,
          datahora: r.datahora,
          participantes: [],
        };
      }
      grupos[gid].participantes.push({
        nome: r.nome,
        contacto: r.contacto,
        valor: r.valor,
        status: r.status,
        pagoPeloRemetente: r.extras?.politicaPagamento === "REMETENTE_PAGA",
      });
    }

    // Se ALGUM membro do grupo já estiver em viagem (consultado à
    // parte, sem o filtro acima, porque o membro que já arrancou
    // fica de fora da lista principal mas ainda conta para decidir
    // se o grupo inteiro deve desaparecer) — o grupo todo sai da
    // vista de "pendente". Reservas do mesmo grupo tipicamente
    // partilham o mesmo veículo/momento; se uma já começou, o grupo
    // já não é uma reserva por iniciar.
    const gids = Object.keys(grupos);
    if (gids.length) {
      const emViagem = await Reserva.find({
        "extras.remetenteId": req._authId,
        "extras.modoConvidado": true,
        "extras.grupoId": { $in: gids },
        status: "em_viagem",
      }).select("extras.grupoId").lean();
      const gidsJaIniciados = new Set(emViagem.map((r) => r.extras?.grupoId));
      gidsJaIniciados.forEach((gid) => delete grupos[gid]);
    }

    return res.json({ ok: true, grupos: Object.values(grupos) });
  } catch (err) {
    console.error("❌ /convidado/grupos-ativos:", err);
    return res.status(500).json({ ok: false, message: "Erro ao listar grupos." });
  }
});

export default router;