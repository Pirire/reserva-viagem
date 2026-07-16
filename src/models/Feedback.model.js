// src/modules/feedback/feedback.model.js
import mongoose from "mongoose";

const RATING_OPTS = ["Excelente", "Boa", "Regular", "Fraca"];
const SCORE_MAP   = { Excelente: 5, Boa: 4, Regular: 2, Fraca: 1 };

const feedbackSchema = new mongoose.Schema(
  {
    // ── Identificação ──────────────────────────────────────────
    token:       { type: String, unique: true, index: true, required: true },
    status:      { type: String, enum: ["pendente", "respondido", "expirado"], default: "pendente", index: true },
    expiresAt:   { type: Date, index: { expireAfterSeconds: 0 } },

    // ── Contexto da viagem ─────────────────────────────────────
    reservaId:    { type: mongoose.Schema.Types.ObjectId, ref: "Reserva", index: true },
    parceiroId:   { type: mongoose.Schema.Types.ObjectId, ref: "Parceiro", index: true },
    partnerName:  { type: String, default: "" },
    partnerType:  { type: String, default: "" },
    guestName:    { type: String, default: "" },
    guestEmail:   { type: String, default: "" },
    motoristaNome:{ type: String, default: "" },
    motoristaId:  { type: mongoose.Schema.Types.ObjectId, ref: "Motorista" },
    categoria:    { type: String, default: "" },
    partida:      { type: String, default: "" },
    destino:      { type: String, default: "" },
    datahora:     { type: Date },

    // ── Avaliação ──────────────────────────────────────────────
    ratings: {
      pontualidade:   { type: String, enum: RATING_OPTS },
      conducao:       { type: String, enum: RATING_OPTS },
      simpatia:       { type: String, enum: RATING_OPTS },
      limpeza:        { type: String, enum: RATING_OPTS },
      qualidadeGeral: { type: String, enum: RATING_OPTS },
      recomendaria:   { type: String, enum: ["Sim", "Não"] },
    },
    comentario:   { type: String, default: "" },
    respondidoEm: { type: Date, index: true },

    // ── Score calculado (0-5, gravado ao responder) ────────────
    scoreGeral: { type: Number, min: 0, max: 5 },
  },
  { timestamps: true }
);

// Calcular scoreGeral a partir dos ratings
feedbackSchema.statics.calcScore = function (ratings = {}) {
  const campos = ["pontualidade", "conducao", "simpatia", "limpeza", "qualidadeGeral"];
  const vals   = campos.map(c => SCORE_MAP[ratings[c]] || 0).filter(Boolean);
  if (!vals.length) return 0;
  return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
};

// Índice composto para queries de listagem paginada
feedbackSchema.index({ status: 1, respondidoEm: -1 });
feedbackSchema.index({ parceiroId: 1, respondidoEm: -1 });

const Feedback = mongoose.models.Feedback || mongoose.model("Feedback", feedbackSchema);
export default Feedback;