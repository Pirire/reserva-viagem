import mongoose from "mongoose";

const DispatchSessionSchema = new mongoose.Schema({
  tripId: { type: String, required: true, index: true },

  status: {
    type: String,
    enum: ["SEARCHING", "OFFERED", "ACCEPTED", "EXPIRED"],
    default: "SEARCHING",
  },
lockedAt: { type: Date, default: null },
lockOwner: { type: String, default: null },

  candidatos: [
    {
      motoristaId: String,
      nome: String,
      distanciaKm: Number,
    },
  ],

  currentIndex: { type: Number, default: 0 },

  // Quantas vezes já se percorreu a lista de candidatos desde o
  // início: 0 = 1ª volta (comissão normal), 1 = 2ª volta (já com o
  // incentivo de comissão). Ao chegar a 2, desiste e escala para
  // despacho manual — nunca mais do que duas voltas pelos mesmos
  // candidatos.
  voltas: { type: Number, default: 0 },

  acceptedDriverId: { type: String, default: null },

  // ── Incentivo "motorista mais próximo" ─────────────────────
  // Se ninguém aceitar em RAIO_DESPACHO_MS (2 min, ver
  // dispatch.offer.engine.js), a comissão da plataforma É REDUZIDA
  // SÓ NESTA viagem (25% → 15%, nunca o valor global em
  // AdminQuoteConfig). null = comissão normal (25%, o valor global);
  // um número aqui = a comissão efetiva já reduzida para esta
  // viagem específica, a usar em vez do valor global na faturação.
  comissaoAjustada: { type: Number, default: null },
  comissaoAjustadaEm: { type: Date, default: null },

  expiresAt: { type: Date, default: null },

  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("DispatchSession", DispatchSessionSchema);