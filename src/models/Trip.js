// src/models/Trip.js
// ══════════════════════════════════════════════════════════════
// Modelo canónico de viagem — SaaS-level
//
// Substitui tanto Trip.js como Viagem.js (ambos usavam a mesma
// collection "viagens" com schemas diferentes — risco de
// corrupção silenciosa de dados).
//
// Campos canónicos:
//   pickup / dropoff / when  →  localização e data/hora
//   driver.driverId          →  motorista atribuído (único)
//   status                   →  estado do ciclo de vida
//   paymentStatus            →  estado de pagamento
//   pricingMode              →  modo de preço (normal | repeat_driver)
//
// Campos legacy mantidos com sincronização automática via pre-save
// para garantir compatibilidade com código existente que ainda
// leia "origem", "destino", "from", "to", "valor", "statusPagamento".
// ══════════════════════════════════════════════════════════════

import mongoose from "mongoose";

/* ── Sub-schemas tipados ─────────────────────────────────────── */

const GeoSchema = new mongoose.Schema(
  {
    lat:     { type: Number, default: null },
    lng:     { type: Number, default: null },
    address: { type: String, default: "" },
  },
  { _id: false }
);

const CustomerSchema = new mongoose.Schema(
  {
    nome:     { type: String, default: "", trim: true },
    email:    { type: String, default: "", trim: true, lowercase: true },
    contacto: { type: String, default: "", trim: true },
    userId:   { type: String, default: "" },
  },
  { _id: false }
);

const CollaboratorSchema = new mongoose.Schema(
  {
    collaboratorId: { type: String, default: "" },
    empresa:        { type: String, default: "", trim: true },
    politicaPagamento: {
      type: String,
      enum: ["HOTEL_PAGA", "CLIENTE_PAGA", "AMBOS", "PARTILHA"],
      default: "CLIENTE_PAGA",
    },
    descontoPercent: { type: Number, default: 0, min: 0, max: 100 },
  },
  { _id: false }
);

const QuoteSchema = new mongoose.Schema(
  {
    categoria: { type: String, default: "", trim: true },
    km:        { type: Number, default: 0, min: 0 },
    valorKm:   { type: Number, default: 0, min: 0 },
    baseTotal: { type: Number, default: 0, min: 0 },
    hasTolls:  { type: Boolean, default: false },
    portagens: { type: Number, default: 0, min: 0 },
    tolls:     { type: Array,   default: [] },
    total:     { type: Number, default: 0, min: 0 },
    currency:  { type: String, default: "EUR" },
  },
  { _id: false }
);

const PaymentPlanSchema = new mongoose.Schema(
  {
    payerType:   { type: String, enum: ["single", "split"], default: "single" },
    customerDue: { type: Number, default: 0, min: 0 },
    hotelDue:    { type: Number, default: 0, min: 0 },
    items:       { type: Array, default: [] },
  },
  { _id: false }
);

const DriverSchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "Motorista",
      default: null,
    },
    inicioPrevisto: { type: Date,   default: null },
    fimPrevisto:    { type: Date,   default: null },
    atribuidoEm:    { type: Date,   default: null },
    nome:           { type: String, default: "" },
    veiculo:        { type: String, default: "" },
    matricula:      { type: String, default: "" },
  },
  { _id: false }
);

/* ── Schema principal ────────────────────────────────────────── */

const TripSchema = new mongoose.Schema(
  {
    // ── Identidade ────────────────────────────────────────────
    tripId: { type: String, unique: true, sparse: true, index: true, trim: true },

    canal: {
      type: String,
      enum: ["publico", "utilizador", "colaborador", "partilha"],
      index: true,
      default: "publico",
    },
    subcanal: { type: String, default: "normal", trim: true },

    // ── Dados canónicos da viagem ─────────────────────────────
    pickup:  { type: String, default: "", trim: true },
    dropoff: { type: String, default: "", trim: true },
    when:    { type: Date,   default: null, index: true },

    origemGeo:  { type: GeoSchema, default: () => ({}) },
    destinoGeo: { type: GeoSchema, default: () => ({}) },

    // ── Modo de preço ─────────────────────────────────────────
    pricingMode: {
      type: String,
      enum: ["normal", "repeat_driver"],
      default: "normal",
      index: true,
    },

    // ── Participantes ─────────────────────────────────────────
    customer:     { type: CustomerSchema,     default: () => ({}) },
    collaborator: { type: CollaboratorSchema, default: () => ({}) },

    // ── Quote e pagamento ─────────────────────────────────────
    quote:       { type: QuoteSchema,       default: () => ({}) },
    paymentPlan: { type: PaymentPlanSchema, default: () => ({}) },

    // ── Motorista canónico ────────────────────────────────────
    driver: { type: DriverSchema, default: () => ({}) },

    // ── Estado do ciclo de vida ───────────────────────────────
    status: {
      type: String,
      enum: ["pendente","confirmada","assigned","in_progress","concluida","cancelada",""],
      default: "pendente",
      index: true,
    },

    paymentStatus: {
      type: String,
      enum: ["none", "pending", "paid", "failed", "refunded"],
      default: "none",
      index: true,
    },

    devolvida: { type: Boolean, default: false },
    meta:      { type: Object,  default: {} },

    // ══════════════════════════════════════════════════════════
    // CAMPOS LEGACY — sincronizados automaticamente via pre-save.
    // Não usar em código novo.
    // ══════════════════════════════════════════════════════════
    from:            { type: String, default: "" },
    to:              { type: String, default: "" },
    origem:          { type: String, default: "" },
    destino:         { type: String, default: "" },
    categoria:       { type: String, default: "" },
    valor:           { type: Number, default: 0   },
    statusPagamento: { type: String, default: ""  },
    lat:             { type: Number, default: null },
    lng:             { type: Number, default: null },
  },
  {
    timestamps: true,
    minimize:   false,
    collection: "viagens",
  }
);

/* ── Hook pre-save: sincroniza campos legacy ─────────────────── */
TripSchema.pre("save", function (next) {
  if (this.pickup)           { this.origem = this.pickup;  this.from = this.pickup;  }
  if (this.dropoff)          { this.destino = this.dropoff; this.to  = this.dropoff; }
  if (this.quote?.total)     { this.valor     = this.quote.total;     }
  if (this.quote?.categoria) { this.categoria = this.quote.categoria; }
  if (this.paymentStatus)    { this.statusPagamento = this.paymentStatus; }
  if (this.origemGeo?.lat)   { this.lat = this.origemGeo.lat; }
  if (this.origemGeo?.lng)   { this.lng = this.origemGeo.lng; }
  next();
});

/* ── Índices compostos ───────────────────────────────────────── */
TripSchema.index({ "driver.driverId": 1, "driver.inicioPrevisto": 1, "driver.fimPrevisto": 1, status: 1 });
TripSchema.index({ canal: 1, when: -1 });
TripSchema.index({ "customer.email": 1, when: -1 });
TripSchema.index({ "collaborator.collaboratorId": 1, when: -1 });
TripSchema.index({ paymentStatus: 1, when: -1 });
TripSchema.index({ pricingMode: 1, status: 1 });

export default mongoose.models.Trip || mongoose.model("Trip", TripSchema);