// src/models/KmConfig.js
import mongoose from "mongoose";

const KmConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true }, // ex: "economy", "executive"
    label: { type: String, default: "" }, // texto mostrado no painel
    valorPorKm: { type: Number, default: 0 },
    ativo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const KmConfig = mongoose.models.KmConfig || mongoose.model("KmConfig", KmConfigSchema);
export default KmConfig;
