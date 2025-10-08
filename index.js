// index.js - Backend de Reservas com Stripe, MongoDB e Painel Admin Protegido
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
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ================== Conexão MongoDB ==================
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB conectado"))
  .catch(err => console.error("❌ Erro ao conectar MongoDB:", err));

// ================== Modelo de Reserva ==================
const reservaSchema = new mongoose.Schema({
  nome: String,
  email: String,
  contato: String,
  categoria: String,
  partida: String,
  destino: String,
  datahora: Date,
  valor: Number,
  codigo: String,
  status: { type: String, default: "paga" },
  paraMotorista: { type: String, default: "" },
  criadoEm: { type: Date, default: Date.now }
});
const Reserva = mongoose.model("Reserva", reservaSchema);

// ================== Middlewares ==================
app.use(cors());
app.use(bodyParser.json());

// ================== Frontend ==================
const __dirname = path.resolve();
app.use(express.static(path.join(__dirname, "public")));

// ================== Rotas ==================

// Teste do backend
app.get("/api", (req, res) => {
  res.json({ message: "🚀 Backend de reservas ativo" });
});

// ------------------ PAGAMENTO + GRAVAÇÃO DE RESERVA ------------------
app.post("/checkout", async (req, res) => {
  try {
    const { nome, email, contato, categoria, partida, destino, datahora, valor } = req.body;
    const codigo = "RM-" + Math.random().toString(36).substring(2, 6).toUpperCase();

    // Cria sessão de pagamento Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: { name: `Reserva de viagem - ${categoria}` },
            unit_amount: Math.round(valor * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/?status=sucesso&codigo=${codigo}`,
      cancel_url: `${process.env.FRONTEND_URL}/?status=cancelado`,
      metadata: { nome, email, contato, categoria, partida, destino, datahora, codigo }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Erro Stripe:", err);
    res.status(500).json({ error: "Erro ao criar checkout", detalhes: err.message });
  }
});

// ------------------ WEBHOOK STRIPE ------------------
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
      const reserva = new Reserva({
        nome: session.metadata.nome,
        email: session.metadata.email,
        contato: session.metadata.contato,
        categoria: session.metadata.categoria,
        partida: session.metadata.partida,
        destino: session.metadata.destino,
        datahora: session.metadata.datahora,
        valor: session.amount_total / 100,
        codigo: session.metadata.codigo,
        status: "paga"
      });
      await reserva.save();
      console.log("✅ Reserva salva após pagamento:", reserva.codigo);
    } catch (err) {
      console.error("Erro ao salvar reserva:", err.message);
    }
  }

  res.json({ received: true });
});

// ------------------ CANCELAR RESERVA ------------------
app.post("/cancelar", async (req, res) => {
  try {
    const { contato, codigo } = req.body;
    const reserva = await Reserva.findOne({ contato, codigo });

    if (!reserva) {
      return res.json({ success: false, message: "Reserva não encontrada ou dados incorretos." });
    }

    reserva.status = "cancelada";
    await reserva.save();
    res.json({ success: true });
  } catch (err) {
    console.error("Erro cancelamento:", err);
    res.status(500).json({ success: false });
  }
});

// ------------------ ADMIN (PROTEGIDO) ------------------
app.use("/admin", basicAuth({
  users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
  challenge: true
}));

// Lista reservas por ordem de data (mais próxima primeiro)
app.get("/admin/reservas", async (req, res) => {
  try {
    const reservas = await Reserva.find().sort({ datahora: 1 });
    res.json(reservas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar reservas" });
  }
});

// Atribuir motorista à reserva
app.patch("/admin/reservas/:id/motorista", async (req, res) => {
  try {
    const reserva = await Reserva.findByIdAndUpdate(
      req.params.id,
      { paraMotorista: req.body.motorista },
      { new: true }
    );
    res.json(reserva);
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar reserva" });
  }
});

// ------------------ ROTAS FRONTEND ------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ================== Inicializa servidor ==================
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
