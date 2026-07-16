import mongoose from "mongoose";

const NotificationLogSchema = new mongoose.Schema(
  {
    targetType: { type: String, required: true }, // "motorista" | "veiculo"
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },

    docKey: { type: String, required: true },     // ex: "cc", "tResidencia"
    validade: { type: Date, required: true },     // data de validade do documento
    daysBefore: { type: Number, required: true }, // 15 | 7 | 2

    sentTo: { type: String, default: "" },        // email destino (admin/titular)
    sentAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

// evita duplicar envio para o mesmo docKey/daysBefore/validade/destino
NotificationLogSchema.index(
  { targetType: 1, targetId: 1, docKey: 1, validade: 1, daysBefore: 1, sentTo: 1 },
  { unique: true }
);

export default mongoose.models.NotificationLog || mongoose.model("NotificationLog", NotificationLogSchema);