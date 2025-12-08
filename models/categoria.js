// models/Categoria.js
import mongoose from "mongoose";

const categoriaSchema = new mongoose.Schema({
  nome: { type: String, required: true, unique: true },
  precoKm: { type: Number, required: true }
});

const Categoria = mongoose.model("Categoria", categoriaSchema);
export default Categoria;
