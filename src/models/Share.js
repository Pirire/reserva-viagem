// src/models/Share.js
import mongoose from "mongoose";

const ShareParticipanteSchema = new mongoose.Schema({
  contacto: { type: String, index: true },
  nome: { type: String, default: "" },

  // valor final que este participante tem de pagar (calculado no backend)
  valor: { type: Number, default: 0 },

  // pagamento
  payStatus: { type: String, enum: ["none", "pending", "paid", "failed", "expired"], default: "none" },
  payProvider: { type: String, default: "paypal" },
  payOrderId: { type: String, default: null },
  payApproveUrl: { type: String, default: null },
  paidAt: { type: Number, default: null },
}, { _id: false });

const ShareSchema = new mongoose.Schema({
  shareId: { type: String, index: true, unique: true },

  destino: {
    label: { type: String, default: "" },
    lat: { type: Number },
    lng: { type: Number },
  },

  // backend: preço base
  valorKm: { type: Number, default: 0 }, // €/km
  tempoMin: { type: Number, default: 0 }, // opcional, se quiseres cobrar tempo
  valorMin: { type: Number, default: 0 }, // €/min

  totalEstimado: { type: Number, default: 0 },

  // estado
  status: { type: String, enum: ["draft", "inviting", "active", "completed", "cancelled"], default: "draft" },

  participantes: { type: [ShareParticipanteSchema], default: [] },

  createdAt: { type: Number, default: () => Date.now() },
  updatedAt: { type: Number, default: () => Date.now() },
}, { minimize: false });

ShareSchema.index({ shareId: 1 });
ShareSchema.index({ "participantes.contacto": 1 });

export default mongoose.model("Share", ShareSchema);
