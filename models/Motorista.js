import mongoose from "mongoose";

const motoristaSchema = new mongoose.Schema({
  nome: { type: String, required: true },
  email: { type: String },
  telefone: { type: String },
  disponivel: [{ type: Date }], // datas em que o motorista está livre
  criadoEm: { type: Date, default: Date.now }
});

export default mongoose.model("Motorista", motoristaSchema);
