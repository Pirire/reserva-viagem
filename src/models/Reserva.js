import mongoose from "mongoose";

const ReservaSchema = new mongoose.Schema(
  {
    codigo: { type: String, required: true, unique: true, index: true },
    canal: {
      type: String,
      enum: ["publico", "cliente", "parceiro", "admin", "convidado"],
      default: "publico",
      index: true,
    },
    motorista: { type: mongoose.Schema.Types.ObjectId, ref: "Motorista" },
    clienteId:    { type: mongoose.Schema.Types.ObjectId, ref: "Cliente",    default: null, index: true },
    colaboradorId:{ type: mongoose.Schema.Types.ObjectId, ref: "Colaborador",default: null, index: true },
    motoristaId:  { type: mongoose.Schema.Types.ObjectId, ref: "Motorista",  default: null, index: true },
    // Referência à Trip (models/Trip.js, collection "viagens")
    // criada pelo motor de despacho unificado (criarEDespacharViagem)
    // quando o pagamento é confirmado. A Reserva continua a ser o
    // registo "de negócio" (dados do cliente, pagamento) — mas o
    // despacho em si (procura de motorista, raio de 7km, fila de
    // ofertas) acontece na Trip, a mesma fonte que o painel de
    // despacho do admin já lê. Mesmo padrão já usado em
    // ShareInvite.tripRefId para a Reserva Flexível.
    tripRefId:    { type: mongoose.Schema.Types.ObjectId, ref: "Trip", default: null, index: true },
    nome:         { type: String, required: true, trim: true },
    email:        { type: String, required: true, lowercase: true, trim: true },
    contacto:     { type: String, default: "", trim: true },
    categoria:    { type: String, required: true, trim: true },
    partida:      { type: String, required: true, trim: true },
    destino:      { type: String, required: true, trim: true },
    datahora:     { type: Date, required: true, index: true },
    valor:        { type: Number, default: 0 },
    observacoes:  { type: String, default: "" },
    status: {
      type: String,
      enum: ["pendente", "confirmada", "atribuida", "em_viagem", "concluida", "cancelada", "pago"],
      default: "pendente",
      index: true,
    },
    pagamento: {
      provider: { type: String, enum: ["paypal", "stripe", "mbway", "manual", "nenhum"], default: "nenhum" },
      status:   { type: String, enum: ["pendente", "pago", "falhou", "reembolsado", "nenhum"], default: "nenhum" },
      paidAt:   { type: Date, default: null },
      ref:      { type: String, default: "" },
      chargeId: { type: String, default: "" },
    },
    // Coordenadas GPS (para tracking de segurança)
    origemGeo: {
      lat:     { type: Number, default: null },
      lng:     { type: Number, default: null },
      address: { type: String, default: "" },
    },
    destinoGeo: {
      lat:     { type: Number, default: null },
      lng:     { type: Number, default: null },
      address: { type: String, default: "" },
    },
    // Campos do sistema de tickets (hotel → hóspede paga) e do modo
    // Convidado (organizador convida vários, cada um com a sua
    // reserva, agrupados por grupoId).
    extras: {
      politicaPagamento: { type: String, default: null },
      tokenTicket:       { type: String, default: null, index: true },
      ticketPago:        { type: Boolean, default: false },
      ticketCriadoPor:   { type: String, default: null },
      // Modo Convidado — campos que faltavam (estavam a ser
      // gravados sem espaço reservado no schema, por isso eram
      // sempre descartados em silêncio pelo modo strict do Mongoose).
      modoConvidado:      { type: Boolean, default: false },
      grupoId:            { type: String, default: null, index: true },
      codigoEmbarque:     { type: String, default: null },
      remetenteId:        { type: String, default: null, index: true },
      remetenteTipo:      { type: String, default: null },
      nomePassageiro:     { type: String, default: "" },
      contactoPassageiro: { type: String, default: "" },
    },
    // Snapshot do motorista no momento da conclusão
    snapshotMotorista: {
      nome:      { type: String, default: "" },
      contacto:  { type: String, default: "" },
      email:     { type: String, default: "" },
      rating:    { type: Number, default: null },
      matricula: { type: String, default: "" },
      categoria: { type: String, default: "" },
    },
    snapshotVeiculo: {
      marca:     { type: String, default: "" },
      modelo:    { type: String, default: "" },
      matricula: { type: String, default: "" },
      cor:       { type: String, default: "" },
    },
  },
  { timestamps: true }
);

export default mongoose.model("Reserva", ReservaSchema);