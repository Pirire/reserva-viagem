import mongoose from "mongoose";

const AuditLogSchema = new mongoose.Schema(
  {
    actorAdminId: { type: String, required: true },   // "MASTER" ou ID real
    actorAdminName: { type: String, required: true }, // nome do admin
    action: { type: String, required: true },         // ex: "VALIDATE_DRIVER_DOCS"
    targetType: { type: String, required: true },     // "motorista" | "veiculo"
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: "targetModel" },
    targetModel: { type: String, required: true },    // "Motorista" | "Veiculo"
    details: { type: Object, default: {} },           // respostas checklist + observações
  },
  { timestamps: true }
);

export default mongoose.models.AuditLog || mongoose.model("AuditLog", AuditLogSchema);