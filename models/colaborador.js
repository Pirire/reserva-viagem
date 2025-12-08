import mongoose from "mongoose";

const ColaboradorSchema = new mongoose.Schema({
  nome: { type: String },
  empresa: { type: String },
  nif: { type: String },
  email: { type: String, required: true },
  contacto: { type: String },
  endereco: { type: String },
  iban: { type: String },
  password: { type: String } // só será definido após registro validado
});

export default mongoose.model("Colaborador", ColaboradorSchema);
