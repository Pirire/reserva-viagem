import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import Stripe from "stripe";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

// Variável de ambiente para MongoDB
const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error("❌ Erro: MONGODB_URI não foi definida no ambiente!");
  process.exit(1);
}

// Inicializa Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2022-11-15",
});

// Middlewares
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public"))); // Serve frontend e assets

let db;
MongoClient.connect(MONGO_URI, { useUnifiedTopology: true })
  .then((client) => {
    db = client.db();
    console.log("✅ Conectado ao MongoDB!");
  })
  .catch((err) => {
    console.error("❌ Erro ao conectar ao MongoDB:", err);
    process.exit(1);
  });

// Rota de checkout Stripe
app.post("/checkout", async (req, res) => {
  try {
    const { valor, nome, email, partida, destino, data, codigo } = req.body;

    if (!valor || !nome || !email) {
      return res.status(400).json({ error: "Dados incompletos" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: { name: `Reserva ${codigo}` },
            unit_amount: Math.round(valor * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${req.headers.origin}/?success=true`,
      cancel_url: `${req.headers.origin}/?canceled=true`,
      customer_email: email,
    });

    // Salva reserva no MongoDB
    const reservas = db.collection("reservas");
    await reservas.insertOne({
      codigo,
      nome,
      email,
      partida,
      destino,
      data,
      valor,
      status: "pendente",
      createdAt: new Date(),
    });

    res.json({ id: session.id, publicKey: process.env.STRIPE_PUBLIC_KEY });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar sessão de pagamento" });
  }
});

// Rota de cancelamento
app.delete("/cancelar/:codigo", async (req, res) => {
  try {
    const { codigo } = req.params;
    const reservas = db.collection("reservas");
    const result = await reservas.updateOne(
      { codigo },
      { $set: { status: "cancelado", canceledAt: new Date() } }
    );

    if (result.modifiedCount > 0) {
      res.json({ message: `Reserva ${codigo} cancelada.` });
    } else {
      res.status(404).json({ error: "Reserva não encontrada." });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao cancelar reserva" });
  }
});

// Serve frontend para qualquer rota desconhecida
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
