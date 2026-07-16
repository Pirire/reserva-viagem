// src/models/convitesParceiros.js
import mongoose from "mongoose";

const ConviteParceiroSchema = new mongoose.Schema(
  {
    // Dados da empresa
    empresa:  { type: String, required: true, trim: true },
    nif:      { type: String, required: true, trim: true, index: true },
    contacto: { type: String, required: true, trim: true },
    email:    { type: String, required: true, trim: true, lowercase: true, index: true },

    tipo: {
      type: String,
      enum: ["frota", "hotel", "alojamento", "seguradora", "reboques"],
      required: true
    },

    // Controlo de estado
    status: {
      type: String,
      default: "pendente",
      enum: [
        "pendente",    // convite enviado, aguarda registo
        "registado",   // formulário preenchido, aguarda validação admin
        "ativo",       // conta ativa — hotel pode fazer login
        "recusado",    // admin recusou o registo
        "expirado"     // link expirou sem uso
      ],
      index: true
    },
    bloqueado:      { type: Boolean, default: false },
    motivoBloqueio: { type: String, default: "" },

    // Token seguro (hash SHA-256 — nunca o token puro)
    tokenHash: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },

    // Senha do hotel/alojamento (bcrypt hash)
    // Só preenchida após o hotel completar o registo com senha
    passwordHash: { type: String, default: null },

    // Dados adicionais preenchidos no formulário de registo
    registo: {
      endereco:       { type: String, default: "" },
      responsavelNome:{ type: String, default: "" },
      iban:           { type: String, default: "" },
      enviadoEm:      { type: Date, default: null }
    },

    // Documentos (apenas gestores de frota)
    documentos: {
      certidaoComercial: {
        url:      { type: String, default: null },
        validade: { type: String, default: null }
      },
      identificacaoResponsavel: {
        url:      { type: String, default: null },
        validade: { type: String, default: null }
      },
      seguroResponsabilidadeCivil: {
        url:      { type: String, default: null },
        validade: { type: String, default: null }
      },
      seguroAcidenteTrabalho: {
        url:      { type: String, default: null },
        validade: { type: String, default: null }
      },
      autorizacaoImtt: {
        url:      { type: String, default: null },
        validade: { type: String, default: null }
      }
    },

    // Auditoria
    enviadoEm: { type: Date, default: () => new Date() },
    usadoEm:   { type: Date, default: null }
  },
  { timestamps: true }
);

// Índice para evitar convites duplicados ativos para o mesmo NIF + tipo
ConviteParceiroSchema.index({ nif: 1, tipo: 1, status: 1 });

export default mongoose.models.ConviteParceiro ||
  mongoose.model("ConviteParceiro", ConviteParceiroSchema);