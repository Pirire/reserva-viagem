import mongoose from "mongoose";

const ReservaSchema = new mongoose.Schema(
  {
    codigo: { type: String, required: true, unique: true, index: true },

    // híbrido: reserva pode vir do site público ou área privada/app
    canal: {
      type: String,
      enum: ["publico", "cliente", "parceiro", "admin"],
      default: "publico",
      index: true,
    },
motorista: { type: mongoose.Schema.Types.ObjectId, ref: "Motorista" },

    clienteId: { type: mongoose.Schema.Types.ObjectId, ref: "Cliente", default: null, index: true },
    colaboradorId: { type: mongoose.Schema.Types.ObjectId, ref: "Colaborador", default: null, index: true },
    motoristaId: { type: mongoose.Schema.Types.ObjectId, ref: "Motorista", default: null, index: true },

    nome: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    contacto: { type: String, default: "", trim: true },

    categoria: { type: String, required: true, trim: true },
    partida: { type: String, required: true, trim: true },
    destino: { type: String, required: true, trim: true },
    datahora: { type: Date, required: true, index: true },

    valor: { type: Number, default: 0 },
    observacoes: { type: String, default: "" },

    status: {
      type: String,
      enum: ["pendente", "confirmada", "atribuida", "em_viagem", "concluida", "cancelada"],
      default: "pendente",
      index: true,
    },

    pagamento: {
      provider: { type: String, enum: ["paypal", "stripe", "manual", "nenhum"], default: "nenhum" },
      status: { type: String, enum: ["pendente", "pago", "falhou", "reembolsado", "nenhum"], default: "nenhum" },
      paidAt: { type: Date, default: null },
      ref: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

export default mongoose.models.Reserva || mongoose.model("Reserva", ReservaSchema);