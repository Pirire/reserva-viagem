// src/services/pagamentosGestores.service.js
// Processamento automático de pagamentos semanais a gestores de frota.
// Chamado pelo cron toda segunda-feira às 10:00 (Europe/Lisbon).

import mongoose    from "mongoose";
import logger      from "../config/logger.js";
import nodemailer from "nodemailer";

function criarTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function enviarEmail({ para, assunto, html }) {
  const transporter = criarTransporter();
  await transporter.sendMail({
    from:    process.env.SMTP_FROM || process.env.SMTP_USER,
    to:      para,
    subject: assunto,
    html,
  });
}

// Modelos exactos do projecto
import GestorFrota     from "../models/colaboradores.js";  // gestores de frota
import Motorista       from "../models/Motorista.js";       // motoristas/colaboradores
import Trip            from "../models/Trip.js";            // viagens

/* ── PagamentoSemanal — criado inline pois não existe ainda ──── */
const pagamentoSchema = new mongoose.Schema({
  gestorId:      { type: mongoose.Schema.Types.ObjectId, ref: "Colaborador", required: true },
  semana:        { type: String, required: true },       // ex: "2025-W18"
  periodoInicio: Date,
  periodoFim:    Date,
  totalViagens:  { type: Number, default: 0 },
  totalFaturado: { type: Number, default: 0 },
  comissao:      { type: Number, default: 0 },
  horasOnline:   { type: Number, default: 0 },
  referencia:    String,
  estado:        {
    type: String,
    enum: ["processando", "pago", "erro", "pendente_manual"],
    default: "processando"
  },
  gateway:       String,
  transacaoId:   String,
  erroMensagem:  String,
  processadoEm:  Date,
  criadoEm:      { type: Date, default: Date.now },
});
pagamentoSchema.index({ gestorId: 1, semana: 1 }, { unique: true });

const PagamentoSemanal = mongoose.models.PagamentoSemanal
  || mongoose.model("PagamentoSemanal", pagamentoSchema);

/* ── Calcular semana anterior (segunda → domingo) ────────────── */
function semanaAnterior() {
  const agora     = new Date();
  const diaSemana = agora.getDay() || 7;
  const estaSegunda = new Date(agora);
  estaSegunda.setDate(agora.getDate() - (diaSemana - 1));
  estaSegunda.setHours(0, 0, 0, 0);

  const inicio = new Date(estaSegunda);
  inicio.setDate(estaSegunda.getDate() - 7);

  const fim = new Date(estaSegunda);
  fim.setMilliseconds(-1);

  const t = new Date(Date.UTC(inicio.getFullYear(), inicio.getMonth(), inicio.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart  = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const numSemana  = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
  const codigoSemana = `${t.getUTCFullYear()}-W${String(numSemana).padStart(2, "0")}`;

  return { inicio, fim, codigoSemana };
}

/* ── Calcular comissão do gestor ─────────────────────────────── */
async function calcularComissaoGestor(gestorId, inicio, fim) {
  let totalViagens = 0, totalFaturado = 0, horasOnline = 0;
  try {
    const viagens = await Trip.find({
      $or: [
        { gestorId },
        { colaboradorId: gestorId },
        { gestorFrotaId: gestorId }
      ],
      status:    { $in: ["concluida", "completed", "done", "finalizada"] },
      createdAt: { $gte: inicio, $lte: fim }
    }).lean();

    totalViagens  = viagens.length;
    totalFaturado = viagens.reduce((s, v) => s + (v.preco || v.valor || v.price || v.total || 0), 0);
    horasOnline   = viagens.reduce((s, v) => s + (v.duracaoMinutos || v.duration || 0), 0);
  } catch (e) {
    logger.warn({ err: e }, "⚠️ Erro ao calcular trips do gestor");
  }

  const taxaComissao = Number(process.env.COMISSAO_GESTOR_PERCENTAGEM || 10) / 100;
  const comissao     = parseFloat((totalFaturado * taxaComissao).toFixed(2));
  return { totalViagens, totalFaturado, comissao, horasOnline };
}

/* ── Gateway de pagamento ────────────────────────────────────── */
async function executarPagamento(gestor, valor, referencia) {
  if (process.env.STRIPE_SECRET_KEY && gestor.stripeAccountId) {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const transfer = await stripe.transfers.create({
      amount:         Math.round(valor * 100),
      currency:       "eur",
      destination:    gestor.stripeAccountId,
      transfer_group: referencia,
      description:    `Comissão semanal ${referencia}`,
    });
    return { gateway: "stripe", transacaoId: transfer.id, estado: "pago" };
  }
  logger.warn({ gestorId: gestor._id, valor }, "⚠️ Sem gateway — pendente_manual");
  return { gateway: "manual", transacaoId: null, estado: "pendente_manual" };
}

/* ── Função principal ────────────────────────────────────────── */
export async function processarPagamentosSemanais() {
  const { inicio, fim, codigoSemana } = semanaAnterior();
  logger.info({ codigoSemana, inicio, fim }, "💳 Iniciando pagamentos semanais a gestores");

  let processados = 0, erros = 0;

  // Buscar gestores activos
  const gestores = await GestorFrota.find({
    $or: [{ tipo: "gestor" }, { role: "gestor_frota" }, { activo: true }]
  }).lean().catch(() => []);

  logger.info(`💼 ${gestores.length} gestor(es) a processar`);

  for (const gestor of gestores) {
    try {
      // Evitar duplicados
      const jaExiste = await PagamentoSemanal.findOne({ gestorId: gestor._id, semana: codigoSemana });
      if (jaExiste) {
        logger.info({ gestorId: gestor._id }, "⏭️ Já processado — a saltar");
        continue;
      }

      const { totalViagens, totalFaturado, comissao, horasOnline } =
        await calcularComissaoGestor(gestor._id, inicio, fim);

      if (comissao <= 0) {
        logger.info({ gestorId: gestor._id }, "⏭️ Comissão zero — sem pagamento");
        continue;
      }

      const referencia = `RM-${codigoSemana}-${String(gestor._id).slice(-6).toUpperCase()}`;

      const pagamento = await PagamentoSemanal.create({
        gestorId: gestor._id, semana: codigoSemana,
        periodoInicio: inicio, periodoFim: fim,
        totalViagens, totalFaturado, comissao, horasOnline,
        referencia, estado: "processando", criadoEm: new Date(),
      });

      let resultado;
      try {
        resultado = await executarPagamento(gestor, comissao, referencia);
      } catch (errPag) {
        logger.error({ err: errPag, gestorId: gestor._id }, "❌ Erro no gateway");
        await PagamentoSemanal.updateOne({ _id: pagamento._id }, { estado: "erro", erroMensagem: errPag?.message });
        erros++; continue;
      }

      await PagamentoSemanal.updateOne({ _id: pagamento._id }, {
        estado: resultado.estado, gateway: resultado.gateway,
        transacaoId: resultado.transacaoId, processadoEm: new Date(),
      });

      // Email de confirmação
      try {
        const fmt = v => new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v);
        await enviarEmail({
          para:    gestor.email,
          assunto: `💳 Pagamento semanal ${codigoSemana} — REALMETROPOLIS`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;background:#0a0b0d;color:#d9dde3;padding:32px;border-radius:16px">
              <div style="font-size:22px;font-weight:900;color:#fff;margin-bottom:6px">Pagamento Processado</div>
              <div style="font-size:13px;color:#8b95a2;margin-bottom:24px">Semana ${codigoSemana}</div>
              <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
                <tr style="border-bottom:1px solid rgba(255,255,255,.1)">
                  <td style="padding:10px 0;color:#8b95a2;font-size:13px">Referência</td>
                  <td style="padding:10px 0;text-align:right;color:#fff;font-weight:700">${referencia}</td>
                </tr>
                <tr style="border-bottom:1px solid rgba(255,255,255,.1)">
                  <td style="padding:10px 0;color:#8b95a2;font-size:13px">Período</td>
                  <td style="padding:10px 0;text-align:right;color:#fff;font-weight:700">${inicio.toLocaleDateString("pt-PT")} – ${fim.toLocaleDateString("pt-PT")}</td>
                </tr>
                <tr style="border-bottom:1px solid rgba(255,255,255,.1)">
                  <td style="padding:10px 0;color:#8b95a2;font-size:13px">Total faturado frota</td>
                  <td style="padding:10px 0;text-align:right;color:#fff;font-weight:700">${fmt(totalFaturado)}</td>
                </tr>
                <tr style="border-bottom:1px solid rgba(255,255,255,.1)">
                  <td style="padding:10px 0;color:#8b95a2;font-size:13px">Viagens</td>
                  <td style="padding:10px 0;text-align:right;color:#fff;font-weight:700">${totalViagens}</td>
                </tr>
                <tr>
                  <td style="padding:14px 0;color:#fff;font-size:15px;font-weight:900">Comissão transferida</td>
                  <td style="padding:14px 0;text-align:right;color:#19d68b;font-size:18px;font-weight:900">${fmt(comissao)}</td>
                </tr>
              </table>
              <div style="font-size:12px;color:#5f6874;text-align:center">REALMETROPOLIS · Pagamentos automáticos toda segunda-feira às 10h</div>
            </div>`
        });
      } catch (errEmail) {
        logger.warn({ err: errEmail }, "⚠️ Erro ao enviar email de confirmação");
      }

      processados++;
      logger.info({ gestorId: gestor._id, comissao, estado: resultado.estado }, `✅ Pago — ${gestor.email}`);

    } catch (errGeral) {
      logger.error({ err: errGeral, gestorId: gestor._id }, "❌ Erro inesperado");
      erros++;
    }
  }

  return { processados, erros, semana: codigoSemana };
}