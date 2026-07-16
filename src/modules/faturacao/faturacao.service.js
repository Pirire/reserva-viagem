// src/modules/faturacao/faturacao.service.js
// CONFLITO RESOLVIDO: raw MongoDB → ViagemRepository

import TripInvoice from "../../models/TripInvoice.js";
import * as ViagemRepository from "../../repositories/viagem.repository.js";

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function gerarNumeroFatura() {
  const ano = new Date().getFullYear();
  const ultimo = await TripInvoice.findOne({ referenceCode: new RegExp(`^FT-${ano}/\\d+$`) })
    .sort({ createdAt: -1 }).lean();
  const seq = ultimo?.referenceCode ? Number(ultimo.referenceCode.split("/")[1] || 0) + 1 : 1;
  return `FT-${ano}/${String(seq).padStart(5, "0")}`;
}

export async function criarFaturaDaViagem(payload = {}) {
  const { tripId, colaboradorId = null, payerType = "cliente", partnerType = "outro", partnerName = "", comissaoEmpresaPercent = 0, descricao = "" } = payload;

  // ✅ usa o repositório — schema sempre validado
  const viagem = await ViagemRepository.findById(tripId);
  if (!viagem) throw Object.assign(new Error("Viagem não encontrada."), { statusCode: 404 });
  if (viagem.status !== "concluida" && viagem.status !== "completed") {
    throw Object.assign(new Error("A viagem ainda não está concluída."), { statusCode: 400 });
  }

  const valorTotal = toNumber(viagem.quote?.total ?? viagem.valor ?? viagem.quote?.baseTotal, 0);
  if (valorTotal <= 0) throw Object.assign(new Error("Valor da viagem inválido."), { statusCode: 400 });

  const percent = toNumber(comissaoEmpresaPercent, 0);
  const comissaoEmpresaValor = Number(((valorTotal * percent) / 100).toFixed(2));
  const valorMotorista       = Number((valorTotal - comissaoEmpresaValor).toFixed(2));
  const motoristaId          = viagem.driver?.driverId || viagem.motorista?.id || null;

  const existente = await TripInvoice.findOne({ tripId: viagem._id }).lean();
  if (existente) return { created: false, fatura: existente };

  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const referenceCode = await gerarNumeroFatura();
    try {
      const fatura = await TripInvoice.create({
        tripId: viagem._id, colaboradorId: colaboradorId || null,
        motoristaId: motoristaId || null, partnerType, partnerName: String(partnerName).trim(),
        payerType, valorTotal, comissaoEmpresaPercent: percent, comissaoEmpresaValor,
        valorMotorista, moeda: "EUR", status: "emitida",
        descricao: String(descricao || `Fatura viagem ${viagem._id}`).trim(),
        referenceCode, issuedAt: new Date(),
      });
      return { created: true, fatura: fatura.toObject() };
    } catch (err) {
      if (err?.code === 11000) {
        const ja = await TripInvoice.findOne({ tripId: viagem._id }).lean();
        if (ja) return { created: false, fatura: ja };
        if (tentativa < 3) continue;
      }
      throw err;
    }
  }
  throw Object.assign(new Error("Não foi possível gerar número de fatura único."), { statusCode: 500 });
}

export async function listarFaturas(filtros = {}) {
  const query = {};
  if (filtros.status)        query.status        = String(filtros.status);
  if (filtros.colaboradorId) query.colaboradorId = filtros.colaboradorId;
  if (filtros.motoristaId)   query.motoristaId   = filtros.motoristaId;
  return TripInvoice.find(query).sort({ createdAt: -1 }).lean();
}

export async function marcarFaturaComoPaga(invoiceId) {
  if (!invoiceId) throw Object.assign(new Error("invoiceId obrigatório."), { statusCode: 400 });
  const fatura = await TripInvoice.findByIdAndUpdate(invoiceId, { $set: { status: "paga", paidAt: new Date() } }, { new: true }).lean();
  if (!fatura) throw Object.assign(new Error("Fatura não encontrada."), { statusCode: 404 });
  return fatura;
}
