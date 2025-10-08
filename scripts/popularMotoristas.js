import mongoose from "mongoose";
import dotenv from "dotenv";
import Motorista from "../models/Motorista.js";

dotenv.config();

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB conectado ✅"))
  .catch(err => console.error("Erro ao conectar MongoDB:", err));

async function popular() {
  const motoristas = [
    { nome: "João Silva", email: "joao@mail.com", telefone: "912345678" },
    { nome: "Maria Santos", email: "maria@mail.com", telefone: "923456789" },
    { nome: "Carlos Lima", email: "carlos@mail.com", telefone: "934567890" }
  ];

  for (let m of motoristas) {
    const existe = await Motorista.findOne({ nome: m.nome });
    if (!existe) await Motorista.create(m);
  }

  console.log("Motoristas populados ✅");
  process.exit();
}

popular();
