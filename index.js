// index.js - Servidor de Reservas para Render
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import Stripe from "stripe";
import mongoose from "mongoose";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Conectar MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB conectado ✅"))
  .catch(err => console.error("Erro ao conectar MongoDB:", err));

// Modelo de Reserva
const reservaSchema = new mongoose.Schema({
  nome: String,
  email: String,
  categoria: String,
  partida: String,
  destino: String,
  datahora: Date,
  valor: Number,
  codigo: String,
  criadoEm: { type: Date, default: Date.now }
});
const Reserva = mongoose.model("Reserva", reservaSchema);

// Middlewares
app.use(cors());
app.use(bodyParser.json());

// Servir frontend
app.use(express.static("public"));

// Rota teste
app.get("/api", (req, res) => {
  res.json({ message: "Backend de reservas ativo 🚀" });
});

// Rota de pagamento Stripe
app.post("/checkout", async (req, res) => {
  try {
    const { nome, email, categoria, partida, destino, valor, datahora } = req.body;
    const codigo = "RM-" + Math.random().toString(36).substring(2,6).toUpperCase();

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: { name: `Reserva de viagem - ${nome}` },
            unit_amount: Math.round(valor * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/sucesso.html`,
      cancel_url: `${process.env.FRONTEND_URL}/`,
      metadata: { nome, email, categoria, partida, destino, datahora, codigo }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Erro Stripe:", err);
    res.status(500).json({ error: "Erro ao criar checkout", detalhes: err.message });
  }
});

// Webhook Stripe para salvar reserva após pagamento
app.post("/webhook", bodyParser.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    try {
      const novaReserva = new Reserva({
        nome: session.metadata.nome,
        email: session.metadata.email,
        categoria: session.metadata.categoria,
        partida: session.metadata.partida,
        destino: session.metadata.destino,
        datahora: session.metadata.datahora,
        valor: session.amount_total / 100,
        codigo: session.metadata.codigo
      });
      await novaReserva.save();
      console.log("Reserva salva após pagamento ✅");
    } catch (err) {
      console.error("Erro ao salvar reserva:", err.message);
    }
  }

  res.json({ received: true });
});

// Inicializa servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
