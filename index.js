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
  challenge: true
}));

// Servir frontend
app.use(express.static(path.join(__dirname, "public")));

// Inicializar Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Rota checkout com valor corrigido
app.post("/checkout", async (req, res) => {
  try {
    const { nome, email, categoria, partida, destino, datahora, valor } = req.body;

    // Corrigir valor: converter para centavos corretamente
    const valorCentavos = Math.round(parseFloat(valor) * 100); // <-- CORREÇÃO

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `Reserva: ${categoria} | ${partida} → ${destino}`,
              description: `Data/Hora: ${datahora} | Nome: ${nome} | Email: ${email}`,
            },
            unit_amount: valorCentavos,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}/sucesso`,
      cancel_url: `${process.env.FRONTEND_URL}/cancelado`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Erro no checkout:", err);
    res.status(500).json({ error: "Erro ao criar sessão de pagamento" });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
