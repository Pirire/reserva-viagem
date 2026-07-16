import mongoose from "mongoose";

const VeiculoSchema = new mongoose.Schema({
  marca: String,
  modelo: String,
  matricula: String
}, { timestamps: true });

export default mongoose.model("Veiculo", VeiculoSchema);
