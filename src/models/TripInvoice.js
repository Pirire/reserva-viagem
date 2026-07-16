// src/models/TripInvoice.js
// ══════════════════════════════════════════════════════════════
// Fatura de viagem — emitida pelo gestor de frota ao cliente
// ou pelo motorista individual quando não há frota
// ══════════════════════════════════════════════════════════════
import mongoose from "mongoose";

const EmitenteSchema = new mongoose.Schema({
  nome:    { type: String, default: "" },
  empresa: { type: String, default: "" },
  nif:     { type: String, default: "" },
  email:   { type: String, default: "" },
  tipo:    { type: String, default: "motorista" }, // "motorista" | "gestor_frota"
}, { _id: false });

const ClienteSchema = new mongoose.Schema({
  nome:  { type: String, default: "" },
  email: { type: String, default: "" },
  nif:   { type: String, default: "" },
}, { _id: false });

const ViagemInfoSchema = new mongoose.Schema({
  partida:   { type: String, default: "" },
  destino:   { type: String, default: "" },
  categoria: { type: String, default: "" },
  datahora:  { type: Date,   default: null },
}, { _id: false });

const TripInvoiceSchema = new mongoose.Schema(
  {
    tripId: {
      type:     mongoose.Schema.Types.ObjectId,
      required: true,
      index:    true,
    },

    // Quem emite a fatura
    colaboradorId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    motoristaId:   { type: mongoose.Schema.Types.ObjectId, default: null },
    emitente:      { type: EmitenteSchema,  default: () => ({}) },

    // Quem recebe a fatura
    cliente:       { type: ClienteSchema,   default: () => ({}) },

    // Metadados da viagem
    viagemInfo:    { type: ViagemInfoSchema, default: () => ({}) },

    // Financeiro
    valorTotal:             { type: Number, default: 0 },
    comissaoEmpresaPercent: { type: Number, default: 0 },
    comissaoEmpresaValor:   { type: Number, default: 0 },
    valorMotorista:         { type: Number, default: 0 },
    moeda:                  { type: String, default: "EUR" },

    partnerType: { type: String, default: "" },
    partnerName: { type: String, default: "" },
    payerType:   { type: String, default: "cliente" },
    descricao:   { type: String, default: "" },

    status: {
      type:    String,
      enum:    ["emitida", "enviada", "paga", "cancelada"],
      default: "emitida",
      index:   true,
    },

    referenceCode: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
    },

    pdfPath:  { type: String, default: null },
    issuedAt: { type: Date,   default: null },
    paidAt:   { type: Date,   default: null },
  },
  { timestamps: true }
);

TripInvoiceSchema.index({ colaboradorId: 1, createdAt: -1 });
TripInvoiceSchema.index({ "emitente.tipo": 1, status: 1 });

export default mongoose.models.TripInvoice
  || mongoose.model("TripInvoice", TripInvoiceSchema);
