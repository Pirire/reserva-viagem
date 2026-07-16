// src/models/SecurityAlert.js
import mongoose from "mongoose";

const SecurityAlertSchema = new mongoose.Schema(
  {
    tripId:     { type: mongoose.Schema.Types.ObjectId, ref: "Trip",     index: true },
    reservaId:  { type: mongoose.Schema.Types.ObjectId, ref: "Reserva",  index: true },

    tipo: {
      type: String,
      enum: [
        "DESVIO_ROTA",          // motorista desvia da rota por >5 min
        "DISTANCIA_DESTINO",    // desconexão a <500m do destino
        "MOTORISTA_PARADO",     // motorista parado >10min durante viagem
        "CLIENTE_DESCONECTADO", // cliente perdeu localização durante viagem
        "MOTORISTA_DESCONECTADO",
      ],
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["ativo", "resolvido", "falso_alarme"],
      default: "ativo",
      index: true,
    },

    // Snapshot do momento do alerta
    motoristaId:   { type: mongoose.Schema.Types.ObjectId, ref: "Motorista", default: null },
    motoristaNome: { type: String, default: "" },
    motoristaContacto: { type: String, default: "" },
    motoristaLat:  { type: Number, default: null },
    motoristaLng:  { type: Number, default: null },

    clienteNome:     { type: String, default: "" },
    clienteContacto: { type: String, default: "" },
    clienteLat:  { type: Number, default: null },
    clienteLng:  { type: Number, default: null },

    destinoLat:  { type: Number, default: null },
    destinoLng:  { type: Number, default: null },
    distanciaDestino: { type: Number, default: null }, // metros

    // Desvio de rota
    minutosDesvio: { type: Number, default: 0 },

    // ── Região geográfica ──────────────────────────────────────
    regiao:  { type: String, default: "", index: true }, // ex: "lisboa", "porto", "joao_pessoa"
    pais:    { type: String, default: "pt", index: true }, // "pt" | "br"
    cidade:  { type: String, default: "" },

    // ── Operador que assumiu o alerta ──────────────────────────
    assumidoPor:  { type: String, default: null },
    assumidoEm:   { type: Date,   default: null },

    observacoes:   { type: String, default: "" },
    resolvidoPor:  { type: String, default: "" },
    resolvidoEm:   { type: Date,   default: null },
  },
  { timestamps: true }
);

SecurityAlertSchema.index({ status: 1, createdAt: -1 });
SecurityAlertSchema.index({ regiao: 1, status: 1, createdAt: -1 });
SecurityAlertSchema.index({ pais: 1, status: 1 });

export default mongoose.models.SecurityAlert ||
  mongoose.model("SecurityAlert", SecurityAlertSchema);