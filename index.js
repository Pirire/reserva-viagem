// index.js - Servidor de Reservas com autenticação JWT para admin
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import Stripe from "stripe";
import mongoose from "mongoose";
import path from "path";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const JWT_SECRET = process.env.JWT_SECRET || "troque-este-segredo";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

if (!STRIPE_SECRET) console.warn("⚠️ STRIPE_SECRET_KEY não está definido no .env");
if (!process.env.MONGODB_URI) console.warn("⚠️ MONGODB_URI não está definido no .env");
if (!ADMIN_USER || !ADMIN_PASS) console.warn("⚠️ ADMIN_USER / ADMIN_PASS não estão definidos no .env");

// Stripe
const stripe = new Stripe(STRIPE_SECRET);

// Conectar MongoDB
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB conectado ✅"))
  .catch(err => console.error("Erro ao conectar MongoDB:", err));

// ---------- MODELS ----------
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
  motorista: { type: String, default: "" },
  status: { type: String, default: "ativo" }, // ativo, cancelado, concluido
  criadoEm: { type: Date, default: Date.now }
});
const Reserva = mongoose.model("Reserva", reservaSchema);

const adminSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  passwordHash: String,
  criadoEm: { type: Date, default: Date.now }
});
const AdminUser = mongoose.model("AdminUser", adminSchema);

// ---------- MIDDLEWARES ----------
app.use(cors({
  origin: [FRONTEND_URL], // permitir apenas seu frontend (ajuste conforme necessário)
}));
app.use(bodyParser.json());

// Servir frontend da pasta public (frontend público)
const __dirname = path.resolve();
app.use(express.static(path.join(__dirname, "public")));

// ---------- HELPERS & AUTH ----------
async function ensureAdminUser() {
  if (!ADMIN_USER || !ADMIN_PASS) return;
  const existing = await AdminUser.findOne({ username: ADMIN_USER });
  if (existing) {
    // se existir, verificar se a senha env mudou (não substituímos automaticamente por segurança)
    return;
  }
  const hash = await bcrypt.hash(ADMIN_PASS, 10);
  await AdminUser.create({ username: ADMIN_USER, passwordHash: hash });
  console.log("Admin criado a partir de ENV (username):", ADMIN_USER);
}

function generateToken(admin) {
  return jwt.sign({ id: admin._id, username: admin.username }, JWT_SECRET, { expiresIn: "4h" });
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Token ausente" });
  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Token ausente" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido" });
  }
}

// garantir admin user no início
ensureAdminUser().catch(err => console.error("Erro ao garantir admin:", err));

// ------------------- ROTAS PÚBLICAS -------------------

// test
app.get("/api", (req, res) => res.json({ message: "Backend de reservas ativo 🚀" }));

// Criar checkout (frontend envia dados)
app.post("/checkout", async (req, res) => {
  try {
    const { nome, email, categoria, partida, destino, valor, datahora } = req.body;
    const codigo = "RM-" + Math.random().toString(36).substring(2, 6).toUpperCase();

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: { name: `Reserva de viagem - ${nome}` },
            unit_amount: Math.round((valor || 0) * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${FRONTEND_URL}?status=sucesso&codigo=${codigo}`,
      cancel_url: `${FRONTEND_URL}?status=cancelado`,
      metadata: { nome, email, categoria, partida, destino, datahora, codigo }
    });

    // opcional: criar reserva temporária com status pendente (se quiser)
    // await Reserva.create({ nome, email, categoria, partida, destino, datahora, valor, codigo, status: "pendente" });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Erro Stripe:", err);
    res.status(500).json({ error: "Erro ao criar checkout", detalhes: err.message });
  }
});

// Stripe webhook (salva a reserva após pagamento)
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
        codigo: session.metadata.codigo,
        status: "ativo"
      });
      await novaReserva.save();
      console.log("Reserva salva após pagamento ✅", novaReserva.codigo);
    } catch (err) {
      console.error("Erro ao salvar reserva:", err.message);
    }
  }

  res.json({ received: true });
});

// rota pública para cancelar (frontend público) - exige código e contato batendo com registro
// NOTE: este endpoint espera { codigo, contato } no body; buscar reserva por codigo e email/contato pode variar
app.put("/reservas/cancelar", async (req, res) => {
  try {
    const { codigo, contato } = req.body;
    if (!codigo || !contato) return res.status(400).json({ success: false, message: "codigo e contato necessários" });

    const reserva = await Reserva.findOne({ codigo });
    if (!reserva) return res.status(404).json({ success: false, message: "Reserva não encontrada" });

    // a validação "contato" depende de como você guarda o contato; aqui comparamos com email ou nome (ajuste conforme necessário)
    // Se armazenou o número de contato em reserva.nome ou outro campo, ajuste essa checagem. 
    // Para segurança, o ideal é armazenar o numero no campo contato no schema.
    if (reserva.email !== contato && reserva.nome !== contato && String(reserva._id) !== contato) {
      return res.status(403).json({ success: false, message: "Contato não corresponde à reserva" });
    }

    reserva.status = "cancelado";
    await reserva.save();
    return res.json({ success: true, message: "Reserva cancelada" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Erro ao cancelar" });
  }
});

// ------------------- ROTAS ADMIN (PROTEGIDAS) -------------------

// Login admin
app.post("/admin/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "username e password necessários" });

    const user = await AdminUser.findOne({ username });
    if (!user) return res.status(401).json({ error: "Credenciais inválidas" });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: "Credenciais inválidas" });

    const token = generateToken(user);
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro no login" });
  }
});

// Listar reservas (ordenadas pela data mais próxima) - protegido
app.get("/admin/reservas", authMiddleware, async (req, res) => {
  try {
    // Ordenar por datahora ascendente (mais próxima primeiro)
    const reservas = await Reserva.find().sort({ datahora: 1 });
    res.json({ reservas });
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar reservas" });
  }
});

// Atribuir motorista a uma reserva (PATCH)
app.patch("/admin/reservas/:id/motorista", authMiddleware, async (req, res) => {
  try {
    const { motorista } = req.body;
    const reserva = await Reserva.findByIdAndUpdate(req.params.id, { motorista, paraMotorista: true }, { new: true });
    if (!reserva) return res.status(404).json({ error: "Reserva não encontrada" });
    res.json({ reserva });
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar reserva" });
  }
});

// Cancelar reserva (admin)
app.delete("/admin/reservas/:id", authMiddleware, async (req, res) => {
  try {
    const reserva = await Reserva.findByIdAndUpdate(req.params.id, { status: "cancelado" }, { new: true });
    if (!reserva) return res.status(404).json({ error: "Reserva não encontrada" });
    res.json({ reserva });
  } catch (err) {
    res.status(500).json({ error: "Erro ao cancelar reserva" });
  }
});

// Rota para recuperar um resumo (opcional)
app.get("/admin/reservas/:id", authMiddleware, async (req, res) => {
  try {
    const reserva = await Reserva.findById(req.params.id);
    if (!reserva) return res.status(404).json({ error: "Reserva não encontrada" });
    res.json({ reserva });
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar reserva" });
  }
});

// Servir admin (arquivo protegido) - você deve hospedar um admin frontend em public/admin-reservas.html
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-reservas.html"));
});

// Catch-all para outras rotas desconhecidas → serve index.html (frontend)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Inicializa servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
