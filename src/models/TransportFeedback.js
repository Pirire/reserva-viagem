import mongoose from "mongoose";

const TransportFeedbackSchema = new mongoose.Schema(
  {
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    motoristaId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    colaboradorId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    partnerType: {
      type: String,
      enum: ["hotel", "alojamento", "empresa", "outro"],
      default: "outro",
      index: true,
    },

    partnerName: {
      type: String,
      default: "",
      trim: true,
    },

    guestName: {
      type: String,
      default: "",
      trim: true,
    },

    guestEmail: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
    },

    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["pendente", "respondido", "expirado"],
      default: "pendente",
      index: true,
    },

    ratings: {
      pontualidade: {
        type: String,
        enum: ["Excelente", "Boa", "Regular", "Fraca"],
        default: undefined,
      },
      conducao: {
        type: String,
        enum: ["Excelente", "Boa", "Regular", "Fraca"],
        default: undefined,
      },
      simpatia: {
        type: String,
        enum: ["Excelente", "Boa", "Regular", "Fraca"],
        default: undefined,
      },
      limpeza: {
        type: String,
        enum: ["Excelente", "Boa", "Regular", "Fraca"],
        default: undefined,
      },
      qualidadeGeral: {
        type: String,
        enum: ["Excelente", "Boa", "Regular", "Fraca"],
        default: undefined,
      },
      recomendaria: {
        type: String,
        enum: ["Sim", "Não"],
        default: undefined,
      },
    },

    comentario: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },

    submittedAt: {
      type: Date,
      default: null,
    },

    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: "transportfeedbacks",
  }
);

const TransportFeedback =
  mongoose.models.TransportFeedback ||
  mongoose.model("TransportFeedback", TransportFeedbackSchema);

export default TransportFeedback;