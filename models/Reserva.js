import mongoose from "mongoose";

const reservaSchema = new mongoose.Schema({
  nome: String,
  email: String,
  categoria: String,
  partida: String,
  destino: String,
  datahora: Date,
  valor: Number,
  codigo: String,
  paraMotorista: { type: Boolean, default: false },
  criadoEm: { type: Date, default: Date.now }
});

const Reserva = mongoose.model("Reserva", reservaSchema);
export default Reserva;
