// src/models/PartnerApiKey.js
// ══════════════════════════════════════════════════════════════
// Modelo de API Keys para empresas parceiras externas.
//
// A chave nunca é guardada em claro — apenas o hash SHA-256.
// O Admin Master gera a chave, vê UMA única vez, e envia à empresa.
// ══════════════════════════════════════════════════════════════
import mongoose from "mongoose";

const PartnerApiKeySchema = new mongoose.Schema(
  {
    // Dados da empresa parceira
    empresa:  { type: String, required: true, trim: true },
    email:    { type: String, required: true, trim: true, lowercase: true },
    contacto: { type: String, default: "",    trim: true },
    notas:    { type: String, default: "",    trim: true }, // notas internas do admin

    // Chave — apenas o hash (SHA-256). Nunca o valor original.
    keyHash:  { type: String, required: true, unique: true, index: true },

    // Prefixo visível (ex: "rm_live_abc1...") para identificar a chave no painel
    // Sem valor sensível — só os primeiros 12 chars do raw key
    keyPreview: { type: String, default: "" },

    // Ambiente: live | sandbox
    ambiente: {
      type: String,
      enum: ["live", "sandbox"],
      default: "sandbox",
    },

    // Permissões granulares
    permissoes: {
      type: [String],
      default: ["submit:driver", "submit:vehicle"],
      enum: [
        "submit:driver",    // submeter motoristas
        "submit:vehicle",   // submeter veículos
        "read:status",      // consultar estado de uma submissão
        "webhook:receive",  // receber notificações via webhook
      ],
    },

    // Estado
    ativo: { type: Boolean, default: true, index: true },

    // Auditoria
    criadoPorId:   { type: String, default: "" },
    criadoPorNome: { type: String, default: "" },
    lastUsedAt:    { type: Date,   default: null },
    totalUsos:     { type: Number, default: 0 },

    // Webhook (opcional) — URL para notificar a empresa quando o estado muda
    webhookUrl:    { type: String, default: "" },
    webhookSecret: { type: String, default: "" }, // HMAC secret para assinar o payload
  },
  {
    timestamps: true,
    collection: "partnerapikeys",
  }
);

PartnerApiKeySchema.index({ empresa: 1, ativo: 1 });

export default mongoose.models.PartnerApiKey ||
  mongoose.model("PartnerApiKey", PartnerApiKeySchema);