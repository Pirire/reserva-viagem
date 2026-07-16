// models/TaxaCancelamento.js
import mongoose from "mongoose";

const taxaSchema = new mongoose.Schema({
  categoria: { type: String, required: true },
  valor: { type: Number, required: true }
});

const TaxaCancelamento = mongoose.model("TaxaCancelamento", taxaSchema);

export default TaxaCancelamento;
