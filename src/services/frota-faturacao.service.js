// src/services/frota-faturacao.service.js
// ══════════════════════════════════════════════════════════════
// FATURAÇÃO DO OPERADOR DE FROTA
//
// Quando um motorista de uma frota conclui uma viagem,
// a fatura é emitida pelo GESTOR DE FROTA ao CLIENTE.
//
// Fluxo:
//   1. Viagem concluída (status: completed)
//   2. Sistema verifica se motorista.gestor.id existe
//   3. Se sim → fatura emitida pelo gestor ao cliente
//   4. Se não → fatura normal (motorista individual)
// ══════════════════════════════════════════════════════════════

import mongoose    from "mongoose";
import TripInvoice from "../models/TripInvoice.js";
import Colaborador from "../models/colaboradores.js";
import Motorista   from "../models/Motorista.js";
import nodemailer  from "nodemailer";

function createError(msg, code = 500) {
  const e = new Error(msg); e.statusCode = code; return e;
}

function viagensCol() {
  return mongoose.connection.db.collection("viagens");
}

function toNum(v, fb = 0) {
  const n = Number(v); return Number.isFinite(n) ? n : fb;
}

// ── Número de fatura sequencial ───────────────────────────────
async function gerarNumeroFatura(prefixoGestor = "") {
  const ano     = new Date().getFullYear();
  const prefixo = prefixoGestor
    ? `FT-${prefixoGestor}-${ano}/`
    : `FT-${ano}/`;

  const ultima = await TripInvoice.findOne({
    referenceCode: new RegExp(`^${prefixo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d+$`)
  }).sort({ createdAt: -1 }).lean();

  let seq = 1;
  if (ultima?.referenceCode) {
    const partes = ultima.referenceCode.split("/");
    const n = Number(partes[partes.length - 1]);
    if (Number.isFinite(n) && n > 0) seq = n + 1;
  }

  return `${prefixo}${String(seq).padStart(5, "0")}`;
}

// ── Notificar cliente por email ───────────────────────────────
async function notificarClienteFatura({ clienteEmail, clienteNome, fatura, gestor, viagem }) {
  if (!clienteEmail) return;
  try {
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    const from = process.env.SMTP_FROM || process.env.SMTP_USER || "";
    const hora = viagem?.datahora
      ? new Date(viagem.datahora).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";

    await t.sendMail({
      from, to: clienteEmail,
      subject: `Fatura ${fatura.referenceCode} — ${gestor.empresa || gestor.nome}`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px">
        <div style="background:#050507;border-radius:12px;padding:18px;margin-bottom:20px;text-align:center">
          <span style="color:#c4c9d4;font-weight:900;letter-spacing:.12em">REALMETROPOLIS</span>
        </div>
        <h2 style="color:#111;font-size:18px">Fatura de Transporte</h2>
        <p style="color:#444;font-size:13px">Caro/a <b>${clienteNome || "Cliente"}</b>,</p>
        <p style="color:#444;font-size:13px">Segue em anexo a fatura referente ao serviço de transporte prestado.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
          <tr style="background:#f5f5f5">
            <td style="padding:10px;border:1px solid #ddd;color:#666;width:40%"><b>Fatura Nº</b></td>
            <td style="padding:10px;border:1px solid #ddd"><b>${fatura.referenceCode}</b></td>
          </tr>
          <tr>
            <td style="padding:10px;border:1px solid #ddd;color:#666">Emitida por</td>
            <td style="padding:10px;border:1px solid #ddd">${gestor.empresa || gestor.nome}${gestor.nif ? " · NIF: " + gestor.nif : ""}</td>
          </tr>
          <tr style="background:#f5f5f5">
            <td style="padding:10px;border:1px solid #ddd;color:#666">Serviço</td>
            <td style="padding:10px;border:1px solid #ddd">${viagem?.partida || "—"} → ${viagem?.destino || "—"}</td>
          </tr>
          <tr>
            <td style="padding:10px;border:1px solid #ddd;color:#666">Data</td>
            <td style="padding:10px;border:1px solid #ddd">${hora}</td>
          </tr>
          <tr style="background:#f5f5f5">
            <td style="padding:10px;border:1px solid #ddd;color:#666">Categoria</td>
            <td style="padding:10px;border:1px solid #ddd">${viagem?.categoria || "—"}</td>
          </tr>
          <tr>
            <td style="padding:10px;border:1px solid #ddd;color:#666"><b>Total</b></td>
            <td style="padding:10px;border:1px solid #ddd;color:#1a7a3c"><b>€ ${Number(fatura.valorTotal).toFixed(2)}</b></td>
          </tr>
        </table>
        <p style="color:#888;font-size:11px;margin-top:24px">REALMETROPOLIS &copy; ${new Date().getFullYear()}</p>
      </body></html>`
    });
  } catch (err) {
    console.warn("⚠️ Falha ao enviar email de fatura:", err.message);
  }
}

// ════════════════════════════════════════════════════════════════
// FUNÇÃO PRINCIPAL — emitir fatura da frota
// ════════════════════════════════════════════════════════════════
export async function emitirFaturaFrota({ tripId, gestorId }) {
  if (!tripId) throw createError("tripId obrigatório.", 400);

  const viagem = await viagensCol().findOne({
    _id: new mongoose.Types.ObjectId(tripId)
  });
  if (!viagem) throw createError("Viagem não encontrada.", 404);

  if (viagem.status !== "completed" && viagem.status !== "concluida" && viagem.status !== "concluída") {
    throw createError("A viagem ainda não está concluída.", 400);
  }

  // Verificar se já existe fatura
  const existente = await TripInvoice.findOne({ tripId: viagem._id }).lean();
  if (existente) return { created: false, fatura: existente };

  // Obter dados do motorista e do gestor
  const motoristaId = viagem.motorista?.id || viagem.driver?.driverId;
  let   gestorDoc   = null;
  let   gestorFinal = null;

  // Prioridade: gestorId passado explicitamente → gestorId do motorista → sem gestor
  const gestorIdFinal = gestorId
    || (motoristaId ? (await Motorista.findById(motoristaId).lean())?.gestor?.id : null);

  if (gestorIdFinal && mongoose.Types.ObjectId.isValid(String(gestorIdFinal))) {
    gestorDoc = await Colaborador.findById(gestorIdFinal).lean();
  }

  if (gestorDoc) {
    gestorFinal = {
      id:      String(gestorDoc._id),
      nome:    gestorDoc.nome     || "",
      empresa: gestorDoc.empresa  || "",
      nif:     gestorDoc.nif      || "",
      email:   gestorDoc.email    || "",
      tipo:    "gestor_frota",
    };
  }

  // Dados do cliente
  const clienteNome  = viagem.nome     || viagem.customer?.name  || viagem.nomeHospede || "Cliente";
  const clienteEmail = viagem.email    || viagem.customer?.email || viagem.emailHospede || null;
  const clienteNif   = viagem.nifCliente || "";

  const valorTotal = toNum(viagem.valor ?? viagem.quote?.total ?? 0);
  if (valorTotal <= 0) throw createError("Viagem sem valor válido para faturação.", 400);

  // Prefixo da fatura: iniciais da empresa do gestor
  const prefixoGestor = gestorFinal?.empresa
    ? gestorFinal.empresa.replace(/[^A-Z]/gi, "").slice(0, 4).toUpperCase()
    : "";

  const referenceCode = await gerarNumeroFatura(prefixoGestor);

  const fatura = await TripInvoice.create({
    tripId:     viagem._id,
    motoristaId: motoristaId ? new mongoose.Types.ObjectId(String(motoristaId)) : null,

    // Emissor da fatura
    colaboradorId: gestorFinal?.id ? new mongoose.Types.ObjectId(gestorFinal.id) : null,
    emitente: gestorFinal
      ? { nome: gestorFinal.nome, empresa: gestorFinal.empresa, nif: gestorFinal.nif, email: gestorFinal.email, tipo: "gestor_frota" }
      : { nome: viagem.motorista?.nome || "", empresa: "", nif: "", email: "", tipo: "motorista" },

    // Receptor da fatura
    cliente: {
      nome:  clienteNome,
      email: clienteEmail || "",
      nif:   clienteNif,
    },

    // Financeiro
    valorTotal,
    comissaoEmpresaPercent: 0,
    comissaoEmpresaValor:   0,
    valorMotorista:         valorTotal,
    moeda:      "EUR",
    status:     "emitida",
    referenceCode,
    descricao:  `Transporte: ${viagem.partida || "—"} → ${viagem.destino || "—"}`,
    issuedAt:   new Date(),

    // Metadados da viagem
    viagemInfo: {
      partida:   viagem.partida   || viagem.origem  || "—",
      destino:   viagem.destino   || "—",
      categoria: viagem.categoria || "—",
      datahora:  viagem.datahora  || null,
    },
  });

  // Notificar cliente
  if (clienteEmail) {
    await notificarClienteFatura({
      clienteEmail, clienteNome,
      fatura:  fatura.toObject(),
      gestor:  gestorFinal || { nome: "REALMETROPOLIS", empresa: "REALMETROPOLIS", nif: "" },
      viagem,
    });
  }

  console.log(`✅ Fatura ${referenceCode} emitida por ${gestorFinal?.empresa || "REALMETROPOLIS"} → ${clienteNome}`);

  return { created: true, fatura: fatura.toObject() };
}

// ── Listar faturas do gestor ──────────────────────────────────
export async function listarFaturasGestor(gestorId) {
  if (!gestorId) throw createError("gestorId obrigatório.", 400);

  return TripInvoice.find({ colaboradorId: new mongoose.Types.ObjectId(String(gestorId)) })
    .sort({ createdAt: -1 })
    .lean();
}

// ════════════════════════════════════════════════════════════════
// TRIGGER AUTOMÁTICO — chamado no final de cada viagem
// Aceita directamente um documento Reserva
// Não lança erro — usa .catch() no caller
// ════════════════════════════════════════════════════════════════
export async function emitirFaturaAutomatica(reserva) {
  if (!reserva?._id) return;

  // Já existe fatura? Ignorar silenciosamente
  const existe = await TripInvoice.findOne({ tripId: reserva._id }).lean();
  if (existe) return;

  // Dados do motorista e gestor de frota
  let gestorFinal = null;
  if (reserva.motoristaId) {
    try {
      const motorista = await Motorista.findById(reserva.motoristaId).lean();
      if (motorista?.gestor?.id && mongoose.Types.ObjectId.isValid(String(motorista.gestor.id))) {
        const gestor = await Colaborador.findById(motorista.gestor.id).lean();
        if (gestor) {
          gestorFinal = {
            id:      String(gestor._id),
            nome:    gestor.nome    || "",
            empresa: gestor.empresa || "",
            nif:     gestor.nif     || "",
            email:   gestor.email   || "",
            tipo:    "gestor_frota",
          };
        }
      }
    } catch (_) {}
  }

  const clienteNome  = reserva.nome     || reserva.nomeHospede || "Cliente";
  const clienteEmail = reserva.email    || reserva.emailHospede || null;
  const clienteNif   = reserva.nifCliente || "";
  const valorTotal   = toNum(reserva.valor ?? reserva.total ?? 0);

  if (valorTotal <= 0) {
    console.warn("⚠️ Fatura automática: reserva sem valor —", String(reserva._id));
    return;
  }

  const prefixoGestor = gestorFinal?.empresa
    ? gestorFinal.empresa.replace(/[^A-Z]/gi, "").slice(0, 4).toUpperCase()
    : "RM";

  let referenceCode;
  for (let t = 1; t <= 3; t++) {
    referenceCode = await gerarNumeroFatura(prefixoGestor);
    try {
      await TripInvoice.create({
        tripId:     reserva._id,
        motoristaId: reserva.motoristaId || null,
        colaboradorId: gestorFinal?.id
          ? new mongoose.Types.ObjectId(gestorFinal.id) : null,

        emitente: gestorFinal
          ? { nome: gestorFinal.nome, empresa: gestorFinal.empresa, nif: gestorFinal.nif, email: gestorFinal.email, tipo: "gestor_frota" }
          : { nome: "REALMETROPOLIS", empresa: "REALMETROPOLIS", nif: "", email: "", tipo: "plataforma" },

        cliente: { nome: clienteNome, email: clienteEmail || "", nif: clienteNif },

        viagemInfo: {
          partida:   reserva.partida   || reserva.origem  || "—",
          destino:   reserva.destino   || "—",
          categoria: reserva.categoria || "—",
          datahora:  reserva.datahora  || null,
        },

        valorTotal,
        comissaoEmpresaPercent: 0,
        comissaoEmpresaValor:   0,
        valorMotorista:         valorTotal,
        moeda:      "EUR",
        status:     "emitida",
        referenceCode,
        descricao:  `Transporte: ${reserva.partida || "—"} → ${reserva.destino || "—"}`,
        issuedAt:   new Date(),
      });

      // Email automático ao cliente
      if (clienteEmail) {
        await notificarClienteFatura({
          clienteEmail, clienteNome,
          fatura:  { referenceCode, valorTotal },
          gestor:  gestorFinal || { nome: "REALMETROPOLIS", empresa: "REALMETROPOLIS", nif: "" },
          viagem:  reserva,
        });
      }

      console.log(`✅ Fatura automática ${referenceCode} → ${clienteNome} (${clienteEmail || "sem email"})`);
      return;

    } catch (err) {
      if (err?.code === 11000 && t < 3) continue;
      throw err;
    }
  }
}