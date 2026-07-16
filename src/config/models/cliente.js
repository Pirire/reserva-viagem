import mongoose from "mongoose";
import bcrypt from "bcrypt";

const ClienteSchema = new mongoose.Schema(
  {
    nome: { type: String, required: true, trim: true },
    sobrenome: { type: String, required: true, trim: true },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    contacto: { type: String, required: true, trim: true },

    password: { type: String, required: true, select: false },

    avatar: { type: String, default: "" },

    idioma: { type: String, enum: ["pt", "en", "es"], default: "pt" },

    politicaAceite: { type: Boolean, default: true },

    faturacao: {
      nif: { type: String },
      mesAno: { type: String },
    },

    viagens: [{ type: mongoose.Schema.Types.ObjectId, ref: "Viagem" }],

    viagemAtiva: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Viagem",
      default: null,
    },

    despesasMensais: [{ mes: Number, ano: Number, total: Number }],

    // ===== RESET PASSWORD =====
    resetToken: { type: String },
    resetExpire: { type: Date },
  },
  { timestamps: true }
);

// ================= HASH PASSWORD =================
ClienteSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ================= COMPARE PASSWORD =================
ClienteSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model("Cliente", ClienteSchema);
