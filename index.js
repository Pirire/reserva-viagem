import express from "express";
import path from "path";
import basicAuth from "express-basic-auth";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import Reserva from "./models/Reserva.js";
import paypal from "@paypal/paypal-server-sdk";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB conectado ✅"))
  .catch(err => console.error("❌ Erro ao conectar no MongoDB", err));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 📌 Rotas reservas
app.get("/reservas", async (req, res) => {
  try {
    const reservas = await Reserva.find().sort({ createdAt: -1 });
    res.json({ reservas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar reservas" });
  }
});

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

app.use("/admin", basicAuth({
  users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
  challenge: true
}));

// 🟡 PayPal
const client = new paypal.core.PayPalHttpClient(
  process.env.PAYPAL_MODE === "live"
    ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
    : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
);

// ✅ Checkout PayPal
app.post("/checkout", async (req, res) => {
  try {
    const { nome, email, categoria, partida, destino, datahora, valor } = req.body;

    const valorEuros = (Number(valor) / 100).toFixed(2);
    if (isNaN(valorEuros) || valorEuros <= 0) {
      return res.status(400).json({ error: "Valor inválido." });
    }

    const orderRequest = new paypal.orders.OrdersCreateRequest();
    orderRequest.requestBody({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "EUR",
            value: valorEuros
          },
          description: `Reserva de viagem - ${categoria}`
        }
      ],
      application_context: {
        brand_name: "Reserva de Viagem",
        landing_page: "LOGIN",
        user_action: "PAY_NOW",
        return_url: `${process.env.FRONTEND_URL}/sucesso`,
        cancel_url: `${process.env.FRONTEND_URL}/cancelado`
      }
    });

    const order = await client.execute(orderRequest);
    const approveLink = order.result.links.find(link => link.rel === "approve");

    if (approveLink) {
      res.json({ url: approveLink.href });
    } else {
      res.status(500).json({ error: "Não foi possível criar a ordem PayPal." });
    }
  } catch (err) {
    console.error("Erro PayPal:", err);
    res.status(500).json({ error: "Erro ao criar ordem PayPal" });
  }
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT} 🚀`));
