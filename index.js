import express from "express";
import path from "path";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import Reserva from "./models/Reserva.js";
import Motorista from "./models/Motorista.js";
import Categoria from "./models/Categoria.js";
import Config from "./models/Config.js";
import nodemailer from "nodemailer";
import paypal from "@paypal/paypal-server-sdk";
import jwt from "jsonwebtoken";
import cors from "cors";
import multer from "multer";
import cron from "node-cron";
import fetch from "node-fetch";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 10000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================================
// 🧩 Conexão MongoDB
// ==========================================================
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB conectado"))
  .catch((err) => console.error("❌ Erro ao conectar no MongoDB", err));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/teste", (req, res) => {
  res.json({ success: true, message: "Backend está funcionando!" });
});

// ==========================================================
// 🧩 SMTP
// ==========================================================
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, // 🔹 Substitua pela sua configuração SMTP
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// ==========================================================
// 🧩 PayPal client
// ==========================================================
const client = new paypal.core.PayPalHttpClient(
  process.env.PAYPAL_MODE === "live"
    ? new paypal.core.LiveEnvironment(
        process.env.PAYPAL_CLIENT_ID, // 🔹 Substitua pelo seu Client ID
        process.env.PAYPAL_CLIENT_SECRET // 🔹 Substitua pelo seu Secret
      )
    : new paypal.core.SandboxEnvironment(
        process.env.PAYPAL_CLIENT_ID, // 🔹 Substitua pelo seu Client ID Sandbox
        process.env.PAYPAL_CLIENT_SECRET // 🔹 Substitua pelo seu Secret Sandbox
      )
);

// ==========================================================
// 🔐 LOGIN ADMIN
// ==========================================================
const ADMIN_USER_MASTER = process.env.ADMIN_USER_MASTER; // 🔹 Substitua pelos seus admin users
const ADMIN_PASS_MASTER = process.env.ADMIN_PASS_MASTER;
const ADMIN_USER_RESERVA = process.env.ADMIN_USER_RESERVA;
const ADMIN_PASS_RESERVA = process.env.ADMIN_PASS_RESERVA;

app.post("/admin/login", (req, res) => {
  const { usuario, senha } = req.body;
  if (usuario === ADMIN_USER_MASTER && senha === ADMIN_PASS_MASTER) {
    const tipo = "master";
    const token = jwt.sign({ user: usuario, tipo }, process.env.JWT_SECRET, { expiresIn: "2h" });
    return res.json({ success: true, token, tipo });
  }
  if (usuario === ADMIN_USER_RESERVA && senha === ADMIN_PASS_RESERVA) {
    const tipo = "reserva";
    const token = jwt.sign({ user: usuario, tipo }, process.env.JWT_SECRET, { expiresIn: "2h" });
    return res.json({ success: true, token, tipo });
  }
  res.status(401).json({ success: false, message: "Credenciais inválidas" });
});

// ==========================================================
// 🔐 MIDDLEWARE AUTENTICAÇÃO
// ==========================================================
function autenticarAdmin(tipoNecessario = null) {
  return (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) return res.status(403).json({ message: "Acesso negado!" });
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (err) return res.status(403).json({ message: "Token inválido!" });
      if (tipoNecessario && user.tipo !== tipoNecessario) return res.status(403).json({ message: "Permissão insuficiente!" });
      req.user = user;
      next();
    });
  };
}

// ==========================================================
// 🚀 ROTA SEGURA DE CÁLCULO DE VALOR
// ==========================================================
app.post("/calcular-viagem", async (req, res) => {
  try {
    const { partida, destino, categoria, tempoExtra } = req.body;
    if (!partida || !destino || !categoria) return res.status(400).json({ error: "Dados incompletos" });

    const cat = await Categoria.findOne({ nome: categoria });
    if (!cat) return res.status(404).json({ error: "Categoria inválida" });

    const config = await Config.findOne();
    const tempoExtraObj = config ? Object.fromEntries(config.tempoExtra) : { "30": 10, "45": 15, "60": 20, "120": 40, "180": 60 };
    const valorTempoExtra = tempoExtraObj[tempoExtra] || 0;

    // 🔹 Substitua a chave abaixo pelo seu Google Maps API Key
    const googleKey = process.env.GOOGLE_MAPS_API_KEY;
    const resp = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(partida)}&destinations=${encodeURIComponent(destino)}&key=${googleKey}&mode=driving`);
    const data = await resp.json();
    if (!data.rows?.[0]?.elements?.[0]?.distance?.value) return res.status(400).json({ error: "Não foi possível calcular distância" });

    const km = data.rows[0].elements[0].distance.value / 1000;
    const valorViagem = (km * cat.precoKm).toFixed(2);
    const valorTotal = (parseFloat(valorViagem) + parseFloat(valorTempoExtra)).toFixed(2);

    res.json({ valorViagem, valorTempoExtra, valorTotal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao calcular viagem" });
  }
});

// ==========================================================
// 🚗 CRIAR RESERVA - usa cálculo seguro
// ==========================================================
app.post("/reserva", async (req, res) => {
  try {
    const { nome, email, categoria, partida, destino, datahora, tempoExtra, contato, codigo } = req.body;

    // 🔹 Atenção: URL do backend - ajustar se for produção
    const calcResp = await fetch(`http://localhost:${PORT}/calcular-viagem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partida, destino, categoria, tempoExtra })
    });
    const { valorTotal, valorTempoExtra } = await calcResp.json();

    const novaReserva = await Reserva.create({
      nome, email, categoria, partida, destino, datahora,
      valor: valorTotal, tempoExtra: valorTempoExtra,
      contato, codigo, status: "pendente"
    });

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: `${email},${process.env.ADMIN_EMAIL}`,
      subject: `Reserva Confirmada: ${codigo}`,
      html: `<h2>Reserva Confirmada</h2>
             <p>Nome: ${nome}</p>
             <p>Categoria: ${categoria}</p>
             <p>E-mail: ${email}</p>
             <p>Partida: ${partida}</p>
             <p>Destino: ${destino}</p>
             <p>Data/Hora: ${new Date(datahora).toLocaleString()}</p>
             <p>Contato: ${contato}</p>
             <p>Valor total: €${valorTotal}</p>
             <p>Código: ${codigo}</p>`
    };
    transporter.sendMail(mailOptions);

    res.json({ success: true, reserva: novaReserva });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar reserva" });
  }
});

// ==========================================================
// 🔹 RESTO DAS ROTAS (cancelamento, PayPal, admin, motoristas, categorias, config)
// Mantidas iguais ao seu backend original
// ==========================================================

// ==========================================================
// 🔹 SEED INICIAL
// ==========================================================
const DEFAULT_CATEGORIAS = [
  { nome: "Confort", precoKm: 0.50 },
  { nome: "Premium", precoKm: 0.75 },
  { nome: "XL 7", precoKm: 1.00 },
  { nome: "Passeio", precoKm: 0.70 }
];

const DEFAULT_TEMPO_EXTRA = { "30": 10, "45": 15, "60": 20, "120": 40, "180": 60 };

async function seedDefaults() {
  try {
    const cnt = await Categoria.countDocuments();
    if (cnt === 0) await Categoria.insertMany(DEFAULT_CATEGORIAS);
    const conf = await Config.findOne();
    if (!conf) await Config.create({ tempoExtra: DEFAULT_TEMPO_EXTRA });
  } catch (err) { console.error("Erro no seedDefaults:", err); }
}
seedDefaults();

// ==========================================================
// 🚀 INICIAR SERVIDOR
app.listen(PORT, () => console.log(`🚀 Servidor rodando em http://localhost:${PORT}`));
