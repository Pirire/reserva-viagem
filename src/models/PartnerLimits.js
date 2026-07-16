// src/models/PartnerLimits.js
import mongoose from "mongoose";

const PartnerLimitsSchema = new mongoose.Schema(
  {
    nif: { type: String, required: true, unique: true, index: true },
    nome: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    contacto: { type: String, default: "", trim: true },

    semLimites: { type: Boolean, default: false },

    maxVeiculos: { type: Number, default: 0 },   // se semLimites = true ignora
    maxMotoristas: { type: Number, default: 0 }, // se semLimites = true ignora
  },
  { timestamps: true }
);

const PartnerLimits =
  mongoose.models.PartnerLimits || mongoose.model("PartnerLimits", PartnerLimitsSchema);

export default PartnerLimits;
