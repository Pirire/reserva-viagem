// index.js - Servidor de Reservas para Render
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import Stripe from "stripe";
import mongoose from "mongoose";
import path from "path";
import basicAuth from "express-basic-auth";

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
  paraMotorista: { type: Boolean, default: false },
  criadoEm: { type: Date, default: Date.now }
});
const Reserva = mongoose.model("Reserva", reservaSchema);

// Middlewares
app.use(cors());
app.use(bodyParser.json());

// Servir frontend da pasta public
const __dirname = path.resolve();
app.use(express.static(path.join(__dirname, "public")));

// ------------------- ROTAS -------------------

// Teste backend
app.get("/api", (req, res) => {
  res.json({ message: "Backend de reservas ativo 🚀" });
});

// Stripe checkout
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
      success_url: `${process.env.FRONTEND_URL}/?status=sucesso`,
      cancel_url: `${process.env.FRONTEND_URL}/?status=cancelado`,
      metadata: { nome, email, categoria, partida, destino, datahora, codigo }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Erro Stripe:", err);
    res.status(500).json({ error: "Erro ao criar checkout", detalhes: err.message });
  }
});

// Webhook Stripe
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

// ----------------- ROTAS ADMIN -----------------

// Proteção Basic Auth para admin
app.use("/reservas", basicAuth({
  users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
  challenge: true
}));

// Listar todas reservas
app.get("/reservas", async (req, res) => {
  try {
    const reservas = await Reserva.find();
    res.json({ reservas });
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar reservas" });
  }
});

// Marcar reserva como enviada para motorista
app.patch("/reservas/:id/motorista", async (req, res) => {
  try {
    const reserva = await Reserva.findByIdAndUpdate(
      req.params.id,
      { paraMotorista: true },
      { new: true }
    );
    res.json({ reserva });
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar reserva" });
  }
});

// ✅ Rota raiz serve admin-reservas.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-reservas.html"));
});

// ✅ Catch-all para outras rotas desconhecidas
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Inicializa servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
