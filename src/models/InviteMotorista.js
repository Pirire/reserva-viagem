import mongoose from "mongoose";

const InviteMotoristaSchema = new mongoose.Schema(
  {
    frotaId: { type: mongoose.Schema.Types.ObjectId, ref: "Colaborador", required: true },
    createdById: { type: mongoose.Schema.Types.ObjectId, ref: "Colaborador", required: true },

    email: { type: String, required: true, lowercase: true, trim: true },

    tokenHash: { type: String, required: true }, // NUNCA guardar token em claro
    status: { type: String, default: "sent" }, // sent | used | expired | revoked

    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },

    // opcional: rastreio básico
    meta: {
      ip: { type: String, default: "" },
      userAgent: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

InviteMotoristaSchema.index({ frotaId: 1, status: 1, createdAt: -1 });
InviteMotoristaSchema.index({ email: 1, createdAt: -1 });
InviteMotoristaSchema.index({ tokenHash: 1 }, { unique: true });

export default mongoose.model("InviteMotorista", InviteMotoristaSchema);
