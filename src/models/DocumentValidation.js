// src/models/DocumentValidation.js
import mongoose from "mongoose";

const AnswerSchema = new mongoose.Schema(
  {
    questionKey:  String,
    questionText: String,
    answer:       { type: String, enum: ["SIM", "NAO", "N/A"], default: "N/A" },
    note:         { type: String, default: "" },
  },
  { _id: false }
);

const ItemSchema = new mongoose.Schema(
  {
    itemKey:   String,
    itemLabel: String,
    images:    [String],
    answers:   [AnswerSchema],
    status:    { type: String, enum: ["PENDENTE", "APROVADO", "REJEITADO"], default: "PENDENTE" },
  },
  { _id: false }
);

const DocumentValidationSchema = new mongoose.Schema(
  {
    driverId:  { type: mongoose.Schema.Types.ObjectId, ref: "Motorista", required: true },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: "Veiculo" },

    scope: {
      type: String,
      enum: ["MOTORISTA", "VEICULO", "AMBOS"],
      default: "AMBOS",
    },

    items: [ItemSchema],

    overallStatus: {
      type: String,
      enum: ["PENDENTE", "APROVADO", "REJEITADO"],
      default: "PENDENTE",
    },
    overallNote: { type: String, default: "" },

    validatedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    validatedByName:    { type: String, default: "" },
    validatedAt:        { type: Date,   default: null },
  },
  { timestamps: true }
);

export default mongoose.models.DocumentValidation ||
  mongoose.model("DocumentValidation", DocumentValidationSchema);