// src/repositories/viagem.repository.js
// ══════════════════════════════════════════════════════════════
// REPOSITÓRIO CENTRAL — único ponto de acesso à coleção viagens.
//
// PROBLEMA RESOLVIDO:
//   11 ficheiros acediam directamente a:
//   mongoose.connection.db.collection("viagens")
//   — ignorando validação de schema, hooks e índices do Mongoose.
//
// SOLUÇÃO:
//   Todos os módulos importam daqui. O Trip model é sempre usado.
//   Dados inválidos são rejeitados antes de entrar na BD.
//
// COMO MIGRAR:
//   Antes: mongoose.connection.db.collection("viagens").findOne(...)
//   Depois: ViagemRepository.findById(id)
// ══════════════════════════════════════════════════════════════

import mongoose from "mongoose";
import Trip from "../models/Trip.js";

/* ── helpers privados ────────────────────────────────────────── */

function toObjectId(id) {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  if (!mongoose.Types.ObjectId.isValid(String(id))) return null;
  return new mongoose.Types.ObjectId(String(id));
}

function createError(message, statusCode = 500) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/* ════════════════════════════════════════════════════════════════
   LEITURA
════════════════════════════════════════════════════════════════ */

/**
 * Encontra uma viagem por _id.
 * Suporta string, ObjectId e ids legacy (campos "_eu ia", "_eu_ia").
 * Devolve documento Mongoose (com hooks) ou null.
 */
export async function findById(id) {
  const oid = toObjectId(id);
  if (!oid) return null;

  // procura principal pelo _id canónico
  let doc = await Trip.findById(oid).exec();
  if (doc) return doc;

  // fallback legacy — campos com nomes problemáticos criados antes da migração
  doc = await Trip.findOne({
    $or: [
      { "_eu ia": oid },
      { "_eu_ia": oid },
      { "_eu ia": String(id) },
      { "_eu_ia": String(id) },
    ],
  }).exec();

  return doc || null;
}

/**
 * Encontra por tripId (string de negócio, ex: "RM-0001").
 */
export async function findByTripId(tripId) {
  if (!tripId) return null;
  return Trip.findOne({ tripId: String(tripId) }).exec();
}

/**
 * Lista viagens com filtro opcional, ordenadas por data desc.
 * Limita a 100 por defeito para proteger a performance.
 */
export async function findMany(filter = {}, { limit = 100, sort = { when: -1 } } = {}) {
  return Trip.find(filter).sort(sort).limit(limit).lean().exec();
}

/**
 * Verifica existência sem carregar o documento completo.
 */
export async function exists(id) {
  const oid = toObjectId(id);
  if (!oid) return false;
  const count = await Trip.countDocuments({ _id: oid });
  return count > 0;
}

/* ════════════════════════════════════════════════════════════════
   ESCRITA — todos passam pelo Mongoose (schema + hooks)
════════════════════════════════════════════════════════════════ */

/**
 * Atualiza campos de uma viagem por _id.
 * Usa findByIdAndUpdate para garantir que os hooks pre/post save correm.
 * Devolve o documento actualizado.
 */
export async function updateById(id, fields) {
  const oid = toObjectId(id);
  if (!oid) throw createError("ID de viagem inválido.", 400);

  const updated = await Trip.findByIdAndUpdate(
    oid,
    { $set: { ...fields, updatedAt: new Date() } },
    { new: true, runValidators: true }
  ).exec();

  if (!updated) throw createError("Viagem não encontrada.", 404);
  return updated;
}

/**
 * Atualiza um documento já carregado (para operações que precisam
 * do documento antes de alterar — ex: adicionar ao array substituicoes).
 */
export async function updateDocument(doc, fields) {
  if (!doc || !doc.save) throw createError("Documento de viagem inválido.", 400);
  Object.assign(doc, fields);
  return doc.save();
}

/**
 * Cria uma nova viagem validada pelo schema.
 */
export async function create(data) {
  return Trip.create(data);
}

/* ════════════════════════════════════════════════════════════════
   OPERAÇÕES ESPECÍFICAS DE NEGÓCIO
   (evitam espalhar lógica de query pelos serviços)
════════════════════════════════════════════════════════════════ */

/**
 * Atribui motorista a uma viagem.
 * Valida que o motorista existe antes de guardar.
 */
export async function atribuirMotorista(viagemId, motorista) {
  if (!motorista?.id && !motorista?._id) throw createError("motorista.id obrigatório.", 400);
  const mid = motorista.id || motorista._id;

  return updateById(viagemId, {
    "driver.driverId": toObjectId(mid),
    "driver.nome":     motorista.nome || "",
    "driver.atribuidoEm": new Date(),
    status: "assigned",
    // legacy sync — o hook pre-save não cobre campos arbitrários
    motorista: { id: toObjectId(mid), nome: motorista.nome || "" },
    atribuidaEm: new Date(),
    modoAtribuicao: motorista.modoAtribuicao || "MANUAL",
  });
}

/**
 * Marca pagamento como pago.
 */
export async function marcarPago(viagemId) {
  return updateById(viagemId, {
    paymentStatus: "paid",
    statusPagamento: "PAGO",
  });
}

/**
 * Associa colaborador (hotel/alojamento/frota) a uma viagem.
 */
export async function associarColaborador(viagemId, { colaboradorId, partnerType, partnerName, payerType }) {
  const oid = toObjectId(colaboradorId);
  if (!oid) throw createError("colaboradorId inválido.", 400);

  return updateById(viagemId, {
    colaboradorId: oid,
    partnerType:   String(partnerType || "outro").trim(),
    partnerName:   String(partnerName || "").trim(),
    payerType:     String(payerType || "cliente").trim(),
  });
}

/**
 * Define modo de pricing (normal | repeat_driver).
 */
export async function definirPricingMode(viagemId, pricingMode) {
  const mode = String(pricingMode || "").trim().toLowerCase();
  if (!["normal", "repeat_driver"].includes(mode)) {
    throw createError("pricingMode inválido. Use: normal | repeat_driver", 400);
  }
  return updateById(viagemId, { pricingMode: mode });
}

/**
 * Reatribui motorista — grava histórico de substituições.
 */
export async function reatribuirMotorista(viagemId, novoMotorista, motivo = "") {
  const doc = await findById(viagemId);
  if (!doc) throw createError("Viagem não encontrada.", 404);

  const substituicoes = Array.isArray(doc.substituicoes) ? doc.substituicoes : [];
  substituicoes.push({
    tipo:     "motorista",
    anterior: doc.motorista || null,
    novo:     { id: novoMotorista._id, nome: novoMotorista.nome || "" },
    motivo:   String(motivo).trim(),
    data:     new Date(),
  });

  return updateDocument(doc, {
    "driver.driverId":    novoMotorista._id,
    "driver.nome":        novoMotorista.nome || "",
    "driver.atribuidoEm": new Date(),
    motorista:     { id: novoMotorista._id, nome: novoMotorista.nome || "" },
    status:        "assigned",
    reatribuidaEm: new Date(),
    substituicoes,
  });
}

/**
 * Reatribui veículo — grava histórico de substituições.
 */
export async function reatribuirVeiculo(viagemId, novoVeiculo, motivo = "") {
  const doc = await findById(viagemId);
  if (!doc) throw createError("Viagem não encontrada.", 404);

  const substituicoes = Array.isArray(doc.substituicoes) ? doc.substituicoes : [];
  substituicoes.push({
    tipo:     "veiculo",
    anterior: doc.veiculo || null,
    novo:     { id: novoVeiculo._id, matricula: novoVeiculo.matricula, marca: novoVeiculo.marca, modelo: novoVeiculo.modelo },
    motivo:   String(motivo).trim(),
    data:     new Date(),
  });

  return updateDocument(doc, {
    veiculo:       { id: novoVeiculo._id, matricula: novoVeiculo.matricula, marca: novoVeiculo.marca, modelo: novoVeiculo.modelo },
    reatribuidaEm: new Date(),
    substituicoes,
  });
}

/**
 * Associa cliente autenticado a uma viagem.
 */
export async function associarCliente(viagemId, clienteId) {
  if (!clienteId) throw createError("clienteId obrigatório.", 400);
  return updateById(viagemId, { clienteId: String(clienteId) });
}