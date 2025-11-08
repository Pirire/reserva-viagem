import express from "express";
import path from "path";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import Reserva from "./models/Reserva.js";
import Motorista from "./models/Motorista.js";
import nodemailer from "nodemailer";
import paypal from "@paypal/paypal-server-sdk";
import jwt from "jsonwebtoken";
import cors from "cors";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 10000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🧩 Conexão MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB conectado"))
  .catch((err) => console.error("❌ Erro ao conectar no MongoDB", err));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// 🧩 SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// 🧩 PayPal client
const client = new paypal.core.PayPalHttpClient(
  process.env.PAYPAL_MODE === "live"
    ? new paypal.core.LiveEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_CLIENT_SECRET
      )
    : new paypal.core.SandboxEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_CLIENT_SECRET
      )
);

// ==========================================================
// 🔐 LOGIN ADMIN
// ==========================================================
app.post("/admin/login", (req, res) => {
  const { usuario, senha } = req.body;

  if (
    usuario === process.env.ADMIN_USER &&
    senha === process.env.ADMIN_PASS
  ) {
    const token = jwt.sign({ user: usuario }, process.env.JWT_SECRET, {
      expiresIn: "2h",
    });
    return res.json({ success: true, token });
  }

  res.status(401).json({ success: false, message: "Credenciais inválidas" });
});

// ==========================================================
// 🔐 MIDDLEWARE AUTENTICAÇÃO
// ==========================================================
function autenticar(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(403).json({ message: "Acesso negado!" });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Token inválido!" });
    req.user = user;
    next();
  });
}

// ==========================================================
// 🚗 CRIAR RESERVA
// ==========================================================
app.post("/reserva", async (req, res) => {
  try {
    const {
      nome,
      email,
      categoria,
      partida,
      destino,
      datahora,
      valor,
      contato,
      codigo,
    } = req.body;

    const novaReserva = await Reserva.create({
      nome,
      email,
      categoria,
      partida,
      destino,
      datahora,
      valor,
      contato,
      codigo,
    });

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: `${email},${process.env.ADMIN_EMAIL}`,
      subject: `Reserva Confirmada: ${codigo}`,
      html: `
        <h2>Reserva Confirmada</h2>
        <p>Nome: ${nome}</p>
        <p>Categoria: ${categoria}</p>
        <p>E-mail: ${email}</p>
        <p>Partida: ${partida}</p>
        <p>Destino: ${destino}</p>
        <p>Data/Hora: ${new Date(datahora).toLocaleString()}</p>
        <p>Contato: ${contato}</p>
        <p>Valor: €${valor}</p>
        <p>Código: ${codigo}</p>
      `,
    };
    transporter.sendMail(mailOptions);

    res.json({ success: true, reserva: novaReserva });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar reserva" });
  }
});

// ==========================================================
// 🚫 CANCELAR RESERVA
// ==========================================================
app.post("/cancelar-reserva", async (req, res) => {
  try {
    const { email, codigo } = req.body;
    const reserva = await Reserva.findOne({ email, codigo });
    if (!reserva)
      return res.status(404).json({ error: "Reserva não encontrada" });

    await Reserva.findByIdAndDelete(reserva._id);

    transporter.sendMail({
      from: process.env.SMTP_USER,
      to: `${email},${process.env.ADMIN_EMAIL}`,
      subject: `Reserva Cancelada: ${codigo}`,
      html: `<p>Sua reserva ${codigo} foi cancelada.</p>`,
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao cancelar reserva" });
  }
});

// ==========================================================
// 💳 PAYPAL - CRIAR ORDEM
// ==========================================================
app.post("/create-paypal-order", async (req, res) => {
  try {
    const { categoria, valor } = req.body;

    const orderRequest = new paypal.orders.OrdersCreateRequest();
    orderRequest.prefer("return=representation");
    orderRequest.requestBody({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { currency_code: "EUR", value: Number(valor).toFixed(2) },
          description: `Reserva de viagem - ${categoria}`,
        },
      ],
      application_context: {
        brand_name: "Reserva de Viagem",
        landing_page: "NO_PREFERENCE",
        user_action: "PAY_NOW",
        return_url: `${process.env.FRONTEND_URL}/?success=true`,
        cancel_url: `${process.env.FRONTEND_URL}/?canceled=true`,
      },
    });

    const order = await client.execute(orderRequest);
    res.json({ orderID: order.result.id });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ error: "Erro ao criar ordem PayPal", details: err.message });
  }
});

// ==========================================================
// 💳 PAYPAL - CAPTURAR ORDEM
// ==========================================================
app.post("/capture-paypal-order/:orderID", async (req, res) => {
  try {
    const { orderID } = req.params;
    const captureRequest = new paypal.orders.OrdersCaptureRequest(orderID);
    captureRequest.requestBody({});
    const capture = await client.execute(captureRequest);

    console.log("✅ Pagamento capturado:", capture.result);

    res.json({ success: true, details: capture.result });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ error: "Erro ao capturar pagamento", details: err.message });
  }
});

// ==========================================================
// 🧾 LISTAR RESERVAS (PAINEL PROTEGIDO)
// ==========================================================
app.get("/reservas", autenticar, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 100));
    const page = Math.max(1, Number(req.query.page) || 1);
    const { status } = req.query;

    const filtro = status ? { status } : {};

    const reservas = await Reserva.find(filtro)
      .populate("motorista")
      .sort({ datahora: 1, criadoEm: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const total = await Reserva.countDocuments(filtro);

    const reservasFormatadas = reservas.map((r) => ({
      ...r,
      datahora: r.datahora ? r.datahora.toISOString() : null,
      criadoEm: r.criadoEm ? r.criadoEm.toISOString() : null,
    }));

    res.json({ total, page, limit, reservas: reservasFormatadas });
  } catch (err) {
    console.error("Erro ao buscar reservas:", err);
    res.status(500).json({ error: "Erro ao buscar reservas" });
  }
});

// ==========================================================
// 👨‍✈️ ATRIBUIR MOTORISTA
// ==========================================================
app.post("/reserva/:id/atribuir", async (req, res) => {
  try {
    const { motoristaId } = req.body;
    const reserva = await Reserva.findByIdAndUpdate(
      req.params.id,
      { motorista: motoristaId, status: "em andamento" },
      { new: true }
    );
    res.json(reserva);
  } catch (err) {
    console.error("Erro ao atribuir motorista:", err);
    res.status(500).json({ error: "Erro ao atribuir motorista" });
  }
});

// ==========================================================
// ✅ MARCAR COMO ENTREGUE
// ==========================================================
app.post("/reserva/:id/entregue", async (req, res) => {
  try {
    const reserva = await Reserva.findByIdAndUpdate(
      req.params.id,
      { status: "entregue" },
      { new: true }
    );
    res.json(reserva);
  } catch (err) {
    console.error("Erro ao marcar entregue:", err);
    res.status(500).json({ error: "Erro ao marcar entregue" });
  }
});

// ==========================================================
// 🚀 INICIAR SERVIDOR
// ==========================================================
app.listen(PORT, () =>
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`)
);
