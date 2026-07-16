// src/models/AdminQuoteConfig.js
import mongoose from "mongoose";

const AdminQuoteConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true, index: true },

    precoKm: {
      Confort: { type: Number, default: 1.2 },
      Executive: { type: Number, default: 1.6 },
      Luxury: { type: Number, default: 2.0 },
    },

    minimos: {
      aeroporto: { type: Number, default: 15 },
      normal: { type: Number, default: 10 },
    },

    espera: {
      minutosGratis: { type: Number, default: 10 },
      valorPorMinExtra: { type: Number, default: 0.8 },
    },

    portagem: {
      valorFixo: { type: Number, default: 2.1 },
    },

    transito: {
      fatorMax: { type: Number, default: 1.3 },
    },

    horaPonta: {
      fator: { type: Number, default: 1.1 },
      manhaInicio: { type: Number, default: 7 },
      manhaFim: { type: Number, default: 10 },
      tardeInicio: { type: Number, default: 17 },
      tardeFim: { type: Number, default: 20 },
    },

    procura: {
      incrementoPorExcesso: { type: Number, default: 0.15 },
      fatorMax: { type: Number, default: 1.5 },
    },
    // Comissão REAL da plataforma. Era 0.15 (15%) — desatualizado;
    // o valor correto é 0.25 (25%). É CONFIGURÁVEL (o admin pode
    // baixar em dias de promoção para os motoristas), mas nunca
    // abaixo de 15% — esse é o piso. O incentivo de "motorista mais
    // próximo, ninguém aceitou em 2 min" reduz isto em 10 pontos
    // percentuais SÓ NAQUELA viagem (nunca mexe neste valor global
    // — ver DispatchSession.comissaoAjustada), com o seu próprio
    // piso de 5% (o pior caso possível: base no mínimo de 15%,
    // menos 10 pontos do incentivo = exatamente 5%, nunca menos).
    plataformaPercent: {
      type: Number,
      default: 0.25,
      min: [0.15, "A comissão da plataforma não pode ser inferior a 15%."],
    },
    descontoColaboradorPercent: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const AdminQuoteConfig =
  mongoose.models.AdminQuoteConfig ||
  mongoose.model("AdminQuoteConfig", AdminQuoteConfigSchema);

export default AdminQuoteConfig;