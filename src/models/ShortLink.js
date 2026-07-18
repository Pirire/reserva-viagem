import mongoose from "mongoose";

/**
 * ShortLink — associa um código curto (ex: "A7K9F") a um destino
 * (o URL longo com o token do convite). Usado para encurtar os
 * links enviados por SMS/email.
 *
 * Fluxo:
 *   1. Ao criar o convite, gera-se um código e guarda-se o destino.
 *   2. O SMS leva  PUBLIC_BASE_URL/v/A7K9F  (curto).
 *   3. GET /v/:codigo procura aqui e redireciona para  destino.
 */
const ShortLinkSchema = new mongoose.Schema(
  {
    // Código curto de 5 caracteres (sem ambíguos O/0/I/1/l).
    codigo: { type: String, required: true, unique: true, index: true },

    // URL de destino (o link longo real, com token/shareId).
    destino: { type: String, required: true },

    // Contexto opcional, útil para diagnóstico.
    shareId: { type: String, default: "" },
    inviteId: { type: String, default: "" },

    // Quantas vezes foi aberto (métrica simples).
    hits: { type: Number, default: 0 },

    // Expira junto com o convite. TTL do Mongo apaga automaticamente
    // os documentos passados desta data (limpeza sem cron).
    expiraEm: { type: Date, default: null },
  },
  { timestamps: true }
);

// TTL index: o Mongo apaga o documento quando expiraEm é ultrapassado.
// (só atua em documentos com expiraEm definido)
ShortLinkSchema.index({ expiraEm: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("ShortLink", ShortLinkSchema);
