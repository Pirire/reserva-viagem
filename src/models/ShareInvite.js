// src/models/ShareInvite.js
import mongoose from "mongoose";

function normContact(c) {
  return String(c || "").trim().replace(/\s+/g, "");
}

const ShareInviteSchema = new mongoose.Schema(
  {
    inviteId: { type: String, required: true, index: true },
    shareId:  { type: String, required: true, index: true },

    // contacto "como veio"
    contacto: { type: String, required: true },

    // contacto normalizado (sem espaços) — usado para match e unicidade
    contactoNorm: { type: String, required: true, index: true },

    nome:  { type: String, default: "Participante" },
    email: { type: String, default: null },

    // OTP
    otpHash:         { type: String, default: "" },
    otpExpiresAt:    { type: Number, default: null },
    inviteExpiresAt: { type: Number, default: null },
    usedAt:          { type: Number, default: null },
    attempts:        { type: Number, default: 0 },
    otpBlockedUntil: { type: Number, default: null },

    // localização (partilha normal)
    lat:       { type: Number, default: null },
    lng:       { type: Number, default: null },
    accuracy:  { type: Number, default: null },
    locatedAt: { type: Number, default: null },

    // cálculo
    amountDue:   { type: Number, default: null },
    distanciaKm: { type: Number, default: null },
    currency:    { type: String, default: null },
    calcAt:      { type: Number, default: null },

    // estado da participação: pendente | aceitou | pagou | pago | falhou | cancelado
    status: { type: String, default: "pendente", index: true },
    // Flag simples: já foi efectivamente pago? (independente do status,
    // que pode mudar por outros motivos). Usada pelo cron dos avisos
    // e pela rota estou-pronto para bloquear casos inconsistentes.
    pago:   { type: Boolean, default: false, index: true },

    // pagamento — comuns a Stripe e PayPal
    payProvider: { type: String, default: null },
    payRef:      { type: String, default: null },
    paidAt:      { type: Number, default: null },
    paidAmount:  { type: Number, default: null },
    tripRefId:   { type: mongoose.Schema.Types.ObjectId, ref: "Trip", default: null },
    canceledAt:  { type: Number, default: null },
    falhasPagamento: { type: Number, default: 0 },

    // PayPal — referência da ordem antes da captura
    paymentOrderId:    { type: String, default: null },
    paymentApproveUrl: { type: String, default: null },
    paymentCurrency:   { type: String, default: null },
    paymentCreatedAt:  { type: Number, default: null },

    createdAt: { type: Number, default: () => Date.now() },

    /* ══════════════════════════════════════════════════════════
       CAMPOS ESPECÍFICOS DA RESERVA FLEXÍVEL (modo Evento)
       Estes campos estavam a ser gravados pelas rotas do Evento
       mas NÃO estavam declarados no schema. Em modo strict (padrão
       do Mongoose), campos não declarados são silenciosamente
       descartados — nada de erro, nada de warning. Explica porque
       o destinoSugerido "desaparecia" ao ler de volta.
    ══════════════════════════════════════════════════════════ */
    modoEvento: { type: Boolean, default: false, index: true },

    // Partida do evento (definida pelo organizador, comum a todos)
    partidaEvento: {
      address: { type: String, default: "" },
      lat:     { type: Number, default: null },
      lng:     { type: Number, default: null },
    },

    // Destino do participante (cada um define o seu ao validar)
    destinoParticipante: {
      address: { type: String, default: "" },
      lat:     { type: Number, default: null },
      lng:     { type: Number, default: null },
    },

    // "Nosso endereço" — sugestão feita pelo concierge que o
    // participante pode aceitar (poupa passos) ou ignorar.
    destinoSugerido: {
      address: { type: String, default: "" },
      lat:     { type: Number, default: null },
      lng:     { type: Number, default: null },
    },

    // Data/hora agendada da recolha
    scheduledAt: { type: Number, default: null },

    // Categoria do veículo (economica, confort, executive, luxury, grupo6/8/17)
    categoria: { type: String, default: "economica" },

    // Canal usado para o convite original — usado pelo cron dos
    // avisos 60/15 min para enviar pelo MESMO canal do convite.
    notifMethodOriginal: { type: String, default: "sms" }, // sms | email | ambos

    // Timestamps dos avisos automáticos — garante idempotência
    // (cada aviso enviado uma só vez). Sem estes, o cron corria a
    // cada minuto e disparava lembretes em ciclo até à expiração.
    aviso60EnviadoAt: { type: Date, default: null },
    aviso15EnviadoAt: { type: Date, default: null },

    // Momento em que o convidado clicou "ESTOU PRONTO" e o
    // motorista foi despachado. Se null e pago:true, ainda está
    // no "modo bilhete flexível" (pagou mas ainda não chamou o carro).
    despachadoEm: { type: Date, default: null },
  },
  { versionKey: false }
);

// Índice único: 1 doc por shareId + contactoNorm
ShareInviteSchema.index({ shareId: 1, contactoNorm: 1 }, { unique: true });

// Índice adicional: cron dos avisos filtra por (modoEvento + status + inviteExpiresAt)
ShareInviteSchema.index({ modoEvento: 1, status: 1, inviteExpiresAt: 1 });

ShareInviteSchema.pre("validate", function (next) {
  // mantém contactoNorm sempre coerente
  this.contacto = normContact(this.contacto);
  this.contactoNorm = normContact(this.contactoNorm || this.contacto);
  next();
});

export default mongoose.model("ShareInvite", ShareInviteSchema);