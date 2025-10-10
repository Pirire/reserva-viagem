import express from "express";
import path from "path";
import basicAuth from "express-basic-auth";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import Reserva from "./models/Reserva.js";
import Stripe from "stripe";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 10000;

// Corrigir __dirname em ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Conexão MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB conectado ✅"))
  .catch(err => console.error("❌ Erro ao conectar no MongoDB", err));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rotas API de reservas
app.get("/reservas", async (req, res) => {
  try {
    const reservas = await Reserva.find().sort({ createdAt: -1 });
    res.json({ reservas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar reservas" });
  }
});

// Atualizar status de envio
app.patch("/reservas/:id/motorista", async (req, res) => {
  try {
    const reserva = await Reserva.findById(req.params.id);
    if (!reserva) return res.status(404).json({ error: "Reserva não encontrada" });

    reserva.paraMotorista = !reserva.paraMotorista;
    await reserva.save();

    res.json({ message: "Status atualizado com sucesso" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar status" });
  }
});

// Proteção painel admin
app.use("/admin", basicAuth({
  users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
  challenge:
