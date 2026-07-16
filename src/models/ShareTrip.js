import mongoose from "mongoose";

const ShareTripSchema = new mongoose.Schema(
  {
    shareId: { type: String, required: true, unique: true, index: true },

    // destino final escolhido no frontend (Google Places)
    destino: {
      address: { type: String, default: "" },
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },

    // local de recolha — usado para mostrar ao convidado depois de
    // validar o código SMS (ver POST /partilha/invite/verify)
    recolha: {
      address: { type: String, default: "" },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },

    // nome de quem organizou/solicitou a partilha — mostrado ao
    // convidado e usado no SMS de convite
    nomeOrganizador: { type: String, default: "" },

    // email de quem organizou — necessário para criar a Reserva final
    // quando todos os convidados tiverem pago.
    emailOrganizador: { type: String, default: "" },

    // referência à Reserva criada quando a partilha fica totalmente
    // paga e é despachada a um motorista.
    // Referência à Trip (modelo canónico, collection "viagens")
    // criada quando a partilha fica totalmente paga e é entregue ao
    // despacho. Antes apontava para "Reserva" — modelo diferente,
    // nunca visível no painel de despacho do admin. Unificado para
    // usar a mesma fonte de verdade que o resto do sistema.
    tripRefId: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", default: null },
    tripIdNegocio: { type: String, default: null },

    // Modo Evento — partida fixa (guardada em "destino", por reaproveitamento
    // do modelo), cada participante define o seu próprio destino, ao
    // contrário da partilha normal (destino fixo, recolhas diferentes).
    modoEvento:   { type: Boolean, default: false },
    mesmoVeiculo: { type: Boolean, default: false },

    // data/hora prevista da viagem (timestamp, ms) — mostrada ao
    // convidado depois de validar o código SMS. Sem este campo no
    // schema, o valor era sempre descartado ao gravar (strict mode).
    scheduledAt: { type: Number, default: null },

    // ── Prazo de confirmação (vencimento) ──────────────────────
    // Ex: casamento termina à meia-noite, o hotel agenda o regresso
    // para as 00:00 mas dá até às 04:00 para o convidado confirmar
    // a recolha. Se não confirmar a tempo, o convite expira
    // automaticamente e é reembolsado (ver expirarConvitesVencidos.service.js).
    validUntil: { type: Number, default: null },
    // Evita reenviar o SMS de aviso "falta 1 hora" mais do que uma vez.
    avisoVencimentoEnviado: { type: Boolean, default: false },

    // Canal de notificação preferido para os convites desta
    // viagem/evento — "sms" | "email" | "ambos". O hotel escolhe ao
    // criar o ticket/evento; antes disto o sistema só enviava SMS,
    // sem alternativa para quem prefere email.
    notifMethod: { type: String, enum: ["sms", "email", "ambos"], default: "sms" },

    // Quem paga — "hotel" (o colaborador/hotel paga tudo
    // antecipadamente) ou "hospede" (cada convidado recebe o pedido
    // de pagamento). Antes só existia o fluxo "hóspede paga".
    pagador: { type: String, enum: ["hotel", "hospede"], default: "hospede" },

    // ordem atual aplicada (contactos)
    orderContacts: { type: [String], default: [] },

    // ordem original do utilizador (como inseriu)
    userOrderContacts: { type: [String], default: [] },

    // categoria para cálculo (pode evoluir depois)
    categoria: { type: String, default: "economica" },

    // metas / estado
    status: { type: String, default: "active" },
    createdAt: { type: Number, default: () => Date.now() },
    updatedAt: { type: Number, default: () => Date.now() },
  },
  { versionKey: false }
);

ShareTripSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model("ShareTrip", ShareTripSchema);