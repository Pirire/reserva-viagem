// src/models/Admin.js
import mongoose from "mongoose";

const AdminSchema = new mongoose.Schema(
  {
    nome:         { type: String, required: true, trim: true },
    email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    roles: {
      type: [String],
      default: [],
      enum: [
        "SUPER_ADMIN",
        "ADMIN_RESERVAS",
        "VALIDADOR_VEICULOS",
        "VALIDADOR_DOCUMENTOS",
      ],
    },
    ativo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.models.Admin || mongoose.model("Admin", AdminSchema);