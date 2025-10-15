import mongoose from "mongoose";
import dotenv from "dotenv";
import TaxaCancelamento from "../models/TaxaCancelamento.js";

dotenv.config();

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB conectado ✅"))
  .catch(err => console.error("Erro ao conectar MongoDB:", err));

const taxas = [
  { categoria: "Confort", valor: 5.00 },
  { categoria: "Premium", valor: 10.00 },
  { categoria: "XL 7", valor: 7.50 },
  { categoria: "Passeio", valor: 0 }
];

const popularTaxas = async () => {
  await TaxaCancelamento.deleteMany({});
  await TaxaCancelamento.insertMany(taxas);
  console.log("Taxas populadas ✅");
  mongoose.disconnect();
};

popularTaxas();
