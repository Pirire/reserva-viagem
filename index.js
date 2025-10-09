// index.js - Servidor de Reservas para Render
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import Stripe from "stripe";
import mongoose from "mongoose";
import path from "path";
import basicAuth from "express-basic-auth";

// Importando modelos
import Reserva from "./models/Reserva.js";
import Motorista from "./models/Motorista.js";
import TaxaCancelamento from "./models/TaxaCancelamento.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Conectar MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB conectado ✅"))
  .catch(err => console.error("Erro ao conectar MongoDB:", err));

// ------------------- MIDDLEWARES -------------------
app.use(cors());
app.use(bodyParser.json());

// Servir frontend público
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

    res.json({ url: session.url, success: true });
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
app.use("/admin", basicAuth({
  users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
  challenge: true
}));

// Servir frontend admin
app.use("/admin", express.static(path.join(__dirname, "admin")));

// Listar todas reservas (rota API para admin)
app.get("/reservas", async (req, res) => {
  try {
    const reservas = await Reserva.find().sort({ datahora: 1 });
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

// ----------------- ROTAS MOTORISTAS -----------------

// Consultar motoristas disponíveis para determinada data/hora
app.get("/motoristasDisponiveis", async (req, res) => {
  try {
    const { datahora } = req.query;
    if (!datahora) return res.status(400).json({ error: "Parâmetro datahora obrigatório" });

    // Buscar motoristas que estão disponíveis
    const motoristas = await Motorista.find({ disponivel: true });
    res.json({ motoristas });
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar motoristas disponíveis" });
  }
});

// ----------------- ROTAS TAXA CANCELAMENTO -----------------

app.get("/taxasCancelamento", async (req, res) => {
  try {
    const taxas = await TaxaCancelamento.find();
    res.json({ taxas });
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar taxas de cancelamento" });
  }
});

// ----------------- ROTAS RAIZ -----------------

// Rota raiz serve index.html público
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Catch-all para outras rotas públicas
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Inicializa servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
