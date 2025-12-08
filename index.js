// index.js (cole sobre o seu index.js atual — NÃO REMOVER outras rotas que você já possua)
import express from "express";
import path from "path";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import Reserva from "./models/Reserva.js";
import Motorista from "./models/Motorista.js";
import Categoria from "./models/Categoria.js";
import Config from "./models/Config.js";
import Colaborador from "./models/Colaborador.js";
import nodemailer from "nodemailer";
import paypal from "@paypal/checkout-server-sdk";
import jwt from "jsonwebtoken";
import cors from "cors";
import multer from "multer";
import fetch from "node-fetch";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 10000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================================
// MongoDB
// ==========================================================
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB conectado"))
  .catch((err) => console.error("❌ Erro ao conectar no MongoDB", err));

// ==========================================================
// MIDDLEWARE
// ==========================================================
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend antigo e novo (ajuste caminhos conforme sua estrutura local)
app.use('/frontend', express.static(path.join(__dirname, '../reserva-frontend/public')));
app.use(express.static(path.join(__dirname, 'public'))); // seus ativos do backend

app.get("/teste", (req, res) => res.json({ success: true, message: "Backend está funcionando!" }));

// ==========================================================
// SMTP
// ==========================================================
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// ==========================================================
// PayPal client (mantive sua implementação)
const environment =
  process.env.PAYPAL_MODE === "live"
    ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
    : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);
const client = new paypal.core.PayPalHttpClient(environment);

// ==========================================================
// ADMIN LOGIN
// ==========================================================
const ADMIN_USER_MASTER = process.env.ADMIN_USER_MASTER;
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
// Função de cálculo - reaproveitada
// ==========================================================
async function calcularViagemInterno({ partida, destino, categoria = null, tempoExtra = null }) {
  if (!partida || !destino) throw { status: 400, message: "Dados incompletos (partida/destino)" };

  let cat = null;
  if (categoria) {
    cat = await Categoria.findOne({ nome: categoria });
    if (!cat) throw { status: 404, message: "Categoria inválida" };
  }

  const config = await Config.findOne();
  const tempoExtraObj = config ? Object.fromEntries(config.tempoExtra) : { "30": 10, "45": 15, "60": 20, "120": 40, "180": 60 };
  const valorTempoExtra = tempoExtra ? (tempoExtraObj[tempoExtra] || 0) : 0;

  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!googleKey) throw { status: 500, message: "GOOGLE_MAPS_API_KEY não configurada" };

  const resp = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(partida)}&destinations=${encodeURIComponent(destino)}&key=${googleKey}&mode=driving`);
  const data = await resp.json();

  if (!data.rows?.[0]?.elements?.[0]?.distance?.value) throw { status: 400, message: "Não foi possível calcular distância", extra: data };
  const km = data.rows[0].elements[0].distance.value / 1000;

  if (cat) {
    const valorViagem = (km * cat.precoKm).toFixed(2);
    const valorTotal = (parseFloat(valorViagem) + parseFloat(valorTempoExtra)).toFixed(2);
    return { km, valorViagem, valorTempoExtra, valorTotal };
  } else {
    return { km };
  }
}

// ==========================================================
// ROTAS EXISTENTES (mantidas)
// ==========================================================
app.post("/calcular-viagem", async (req, res) => {
  try {
    const { partida, destino, categoria, tempoExtra } = req.body;
    if (!partida || !destino || !categoria) return res.status(400).json({ error: "Dados incompletos" });
    const resultado = await calcularViagemInterno({ partida, destino, categoria, tempoExtra });
    res.json({ valorViagem: resultado.valorViagem, valorTempoExtra: resultado.valorTempoExtra, valorTotal: resultado.valorTotal });
  } catch (err) {
    console.error("Erro em /calcular-viagem:", err);
    if (err.status) return res.status(err.status).json({ error: err.message, extra: err.extra || null });
    res.status(500).json({ error: "Erro ao calcular viagem" });
  }
});

app.post("/obter-valores", async (req, res) => {
  try {
    const { origem, destino } = req.body;
    if (!origem || !destino) return res.status(400).json({ error: "Origem e destino são obrigatórios" });

    const categorias = await Categoria.find();
    if (!categorias || categorias.length === 0) return res.status(500).json({ error: "Nenhuma categoria configurada" });

    const resultadoKm = await calcularViagemInterno({ partida: origem, destino });
    const km = resultadoKm.km;

    const resultado = {};
    categorias.forEach((cat) => { resultado[cat.nome] = (km * cat.precoKm).toFixed(2); });

    const config = await Config.findOne();
    const tempoExtraObj = config ? Object.fromEntries(config.tempoExtra) : { "30": 10, "45": 15, "60": 20, "120": 40, "180": 60 };
    resultado._tempoExtra = tempoExtraObj;

    return res.json(resultado);
  } catch (err) {
    console.error("Erro em /obter-valores:", err);
    if (err.status) return res.status(err.status).json({ error: err.message, extra: err.extra || null });
    return res.status(500).json({ error: "Erro interno ao calcular valores" });
  }
});

app.post("/reserva", async (req, res) => {
  try {
    const { nome, email, categoria, partida, destino, datahora, tempoExtra, contato, codigo } = req.body;
    const resultadoCalc = await calcularViagemInterno({ partida, destino, categoria, tempoExtra });
    const { valorTotal, valorTempoExtra } = resultadoCalc;

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

    transporter.sendMail(mailOptions, (err, info) => {
      if (err) console.error("Erro ao enviar email de confirmação:", err);
      else console.log("Email enviado:", info && info.response);
    });

    res.json({ success: true, reserva: novaReserva });
  } catch (err) {
    console.error("Erro em /reserva:", err);
    if (err.status) return res.status(err.status).json({ error: err.message, extra: err.extra || null });
    res.status(500).json({ error: "Erro ao criar reserva" });
  }
});

// ==========================================================
// ROTAS DE COLABORADOR (validação, registo, solicitar-registo, recuperar senha)
// ==========================================================

// validar dados do colaborador antes do registro (procura coincidência no banco)
app.post("/validar-colaborador", async (req, res) => {
  const { email, nif, contacto } = req.body;
  try {
    const colaborador = await Colaborador.findOne({ email, nif, contacto });
    if (colaborador) return res.json({ success: true });
    return res.json({ success: false, message: "Colaborador não autorizado." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Erro interno" });
  }
});

// registar colaborador (atualiza senha e marca registado)
app.post("/registar-colaborador", async (req, res) => {
  const { email, nif, contacto, pass } = req.body;
  try {
    const existe = await Colaborador.findOne({ email, nif, contacto });
    if (!existe) return res.json({ success: false, message: "Colaborador não autorizado." });

    existe.senha = pass;
    existe.registado = true;
    await existe.save();
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Erro interno" });
  }
});

// rota para solicitar registo — envia email para admin com pedido (quando colaborador não pré-existe)
app.post("/solicitar-registo", async (req, res) => {
  const { nome, email, contacto } = req.body;
  if (!email || !nome) return res.status(400).json({ success: false, message: "Dados incompletos" });

  const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
  const mailOptions = {
    from: process.env.SMTP_USER,
    to: adminEmail,
    subject: `Pedido de registo de colaborador: ${nome}`,
    html: `<p>Recebemos pedido de registo:</p><ul><li>Nome: ${nome}</li><li>Email: ${email}</li><li>Contacto: ${contacto}</li></ul>`
  };

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) {
      console.error("Erro ao enviar email de pedido de registo:", err);
      return res.status(500).json({ success: false, message: "Erro ao enviar pedido" });
    }
    return res.json({ success: true, message: "Pedido enviado ao administrador" });
  });
});

// recuperar senha — envia link com token JWT para reset
app.post("/colaborador/recuperar-senha", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "Email obrigatório" });

    const col = await Colaborador.findOne({ email });
    if (!col) return res.json({ success: false, message: "Email não encontrado" });

    // cria token curto
    const token = jwt.sign({ id: col._id, email }, process.env.JWT_SECRET, { expiresIn: "1h" });
    const frontendUrl = process.env.FRONTEND_URL || `http://localhost:${PORT}/frontend`;
    const resetLink = `${frontendUrl}/reset-password.html?token=${token}`; // supondo reset page

    const mailOptions = {
      from: process.env.SMTP_USER,
      to: email,
      subject: "Recuperação de senha",
      html: `<p>Olá,</p><p>Para redefinir a sua senha clique no link abaixo:</p><p><a href="${resetLink}">${resetLink}</a></p><p>O link expira em 1 hora.</p>`
    };

    transporter.sendMail(mailOptions, (err) => {
      if (err) { console.error("Erro ao enviar email de recuperação:", err); return res.status(500).json({ success: false, message: "Erro ao enviar email" }); }
      return res.json({ success: true, message: "Email de recuperação enviado" });
    });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: "Erro interno" }); }
});

// reset de senha (o frontend chama esta rota com token e nova senha)
app.post("/colaborador/reset-senha", async (req, res) => {
  try {
    const { token, novaSenha } = req.body;
    if (!token || !novaSenha) return res.status(400).json({ success: false, message: "Dados incompletos" });

    jwt.verify(token, process.env.JWT_SECRET, async (err, payload) => {
      if (err) return res.status(400).json({ success: false, message: "Token inválido ou expirado" });
      const col = await Colaborador.findById(payload.id);
      if (!col) return res.status(404).json({ success: false, message: "Colaborador não encontrado" });
      col.senha = novaSenha;
      await col.save();
      return res.json({ success: true, message: "Senha atualizada" });
    });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: "Erro interno" }); }
});

// ==========================================================
// Seed inicial
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
// iniciar servidor
// ==========================================================
app.listen(PORT, () => console.log(`🚀 Servidor rodando em http://localhost:${PORT}`));
