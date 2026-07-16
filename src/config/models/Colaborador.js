import mongoose from "mongoose";
import bcrypt from "bcrypt";

const ColaboradorSchema = new mongoose.Schema(
  {
    nome: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    senha: { type: String, required: true },

    empresa: { type: String },
    contacto: { type: String },
    tipo: { type: String },

    aprovado: { type: Boolean, default: false },

    // ===== RESET PASSWORD =====
    resetToken: { type: String },
    resetExpire: { type: Date },
  },
  { timestamps: true }
);

// ================= HASH SENHA =================
ColaboradorSchema.pre("save", async function (next) {
  if (!this.isModified("senha")) return next();
  const salt = await bcrypt.genSalt(10);
  this.senha = await bcrypt.hash(this.senha, salt);
  next();
});

// ================= COMPARE SENHA =================
ColaboradorSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.senha);
};

export default mongoose.model("Colaborador", ColaboradorSchema);
