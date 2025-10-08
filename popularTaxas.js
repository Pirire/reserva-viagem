import mongoose from "mongoose";
import dotenv from "dotenv";
import TaxaCancelamento from "../models/TaxaCancelamento.js";

dotenv.config();

const taxasIniciais = [
  { categoria: "Confort", valor: 5.00 },
  { categoria: "Premium", valor: 10.00 },
  { categoria: "XL 7", valor: 7.50 },
  { categoria: "Passeio", valor: 3.00 }
];

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log("MongoDB conectado ✅");

    for (const taxa of taxasIniciais) {
      // Upsert: se categoria existe, atualiza; se não, cria
      await TaxaCancelamento.findOneAndUpdate(
        { categoria: taxa.categoria },
        { valor: taxa.valor },
        { upsert: true, new: true }
      );
      console.log(`Taxa de ${taxa.categoria} definida: ${taxa.valor}€`);
    }

    console.log("Taxas iniciais populadas com sucesso!");
    mongoose.connection.close();
  })
  .catch(err => {
    console.error("Erro ao conectar MongoDB:", err);
  });
