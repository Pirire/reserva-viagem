import mongoose from "mongoose";

const ViagemSchema = new mongoose.Schema({
  origem: String,
  destino: String,
  categoria: String,
  valor: Number,
  motorista: {
    id: mongoose.Schema.Types.ObjectId,
    nome: String
  },
  status: { type: String, default: "pendente" },
  statusPagamento: { type: String, default: "pendente" },
  devolvida: { type: Boolean, default: false }
}, { timestamps: true });

export default mongoose.model("Viagem", ViagemSchema);
