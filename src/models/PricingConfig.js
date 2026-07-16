// src/models/PricingConfig.js
import mongoose from "mongoose";

const PricingConfigSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "default",
      unique: true,
      index: true,
    },

    precoKm: {
      economica: { type: Number, default: 0.85 },
      confort: { type: Number, default: 1.05 },
      executive: { type: Number, default: 1.35 },
      luxury: { type: Number, default: 1.75 },
    },

    grupo: {
      g6: { type: Number, default: 1.20 },
      g8: { type: Number, default: 1.35 },
      g17: { type: Number, default: 1.60 },
    },

    minimo: {
      geral: { type: Number, default: 10 },
      aeroporto: { type: Number, default: 15 },
    },

    espera: {
      minutosGratis: { type: Number, default: 10 },
      precoPorMin: { type: Number, default: 0.8 },
    },

    plataformaPercent: {
      type: Number,
      default: 0.15,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: "pricing_config",
  }
);

const PricingConfig =
  mongoose.models.PricingConfig ||
  mongoose.model("PricingConfig", PricingConfigSchema);

export default PricingConfig;