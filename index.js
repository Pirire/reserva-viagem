import express from "express";
import path from "path";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import Reserva from "./models/Reserva.js";
import Motorista from "./models/Motorista.js";
import Categoria from "./models/Categoria.js"; // <-- novo
import Config from "./models/Config.js";       // <-- novo
import nodemailer from "nodemailer";
import paypal from "@paypal/paypal-server-sdk";
import jwt from "jsonwebtoken";
import cors from "cors";
import multer from "multer";
import cron from "node-cron";

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
  host: process.env.SMTP_HOST,
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
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_CLIENT_SECRET
      )
    : new paypal.core.SandboxEnvironment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_CLIENT_SECRET
      )
);

// ==========================================================
// 🔐 LOGIN ADMIN - DOIS TIPOS DE USUÁRIO
// ==========================================================
const ADMIN_USER_MASTER = process.env.ADMIN_USER_MASTER; // acesso total
const ADMIN_PASS_MASTER = process.env.ADMIN_PASS_MASTER;

const ADMIN_USER_RESERVA = process.env.ADMIN_USER_RESERVA; // apenas atribuição
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
// 🔐 MIDDLEWARE AUTENTICAÇÃO COM TIPOS
// ==========================================================
function autenticarAdmin(tipoNecessario = null) {
  return (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) return res.status(403).json({ message: "Acesso negado!" });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (err) return res.status(403).json({ message: "Token inválido!" });
      if (tipoNecessario && user.tipo !== tipoNecessario) {
        return res.status(403).json({ message: "Permissão insuficiente!" });
      }
      req.user = user;
      next();
    });
  };
}

// ==========================================================
// 🚗 CRIAR RESERVA
// (mantive igual ao original)
// ==========================================================
app.post("/reserva", async (req, res) => {
  try {
    const { nome, email, categoria, partida, destino, datahora, valor, contato, codigo } = req.body;

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
      status: "pendente",
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
// 🚫 CANCELAR RESERVA COM TAXA % (mantive igual)
// ==========================================================
const TAXA_CANCELAMENTO_PERCENT = 20;
const LIMITE_HORAS_TAXA = 4;

app.post("/cancelar-reserva", async (req, res) => {
  try {
    const { email, codigo } = req.body;
    const reserva = await Reserva.findOne({ email, codigo }).populate("motorista");
    if (!reserva)
      return res.status(404).json({ error: "Reserva não encontrada" });

    const agora = new Date();
    const dataReserva = new Date(reserva.datahora);
    const horasRestantes = (dataReserva - agora) / (1000 * 60 * 60);

    let taxa = 0;
    let valorDevolver = reserva.valor;

    if (horasRestantes < LIMITE_HORAS_TAXA) {
      taxa = (reserva.valor * TAXA_CANCELAMENTO_PERCENT) / 100;
      valorDevolver = reserva.valor - taxa;
    }

    await Reserva.findByIdAndDelete(reserva._id);

    transporter.sendMail({
      from: process.env.SMTP_USER,
      to: `${email},${process.env.ADMIN_EMAIL}`,
      subject: `Reserva Cancelada: ${codigo}`,
      html: `
        <p>Sua reserva ${codigo} foi cancelada.</p>
        <p>Taxa aplicada: €${taxa}</p>
        <p>Valor devolvido: €${valorDevolver}</p>
        ${reserva.motorista ? `
          <p>Motorista: ${reserva.motorista.nome}</p>
          <p>Veículo: ${reserva.motorista.veiculo}</p>
          <img src="${req.protocol}://${req.get('host')}${reserva.motorista.imagem}" alt="Veículo" width="200"/>
        ` : ''}
      `,
    });

    res.json({ success: true, taxa, valorDevolver });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao cancelar reserva" });
  }
});

// ==========================================================
// 💳 PAYPAL - CAPTURA MANUAL (SOMENTE MASTER)
// ==========================================================
app.post("/capture-paypal-order/:authorizationID", autenticarAdmin("master"), async (req, res) => {
  try {
    const { authorizationID } = req.params;
    const captureRequest = new paypal.payments.AuthorizationsCaptureRequest(authorizationID);
    captureRequest.requestBody({});
    const capture = await client.execute(captureRequest);
    res.json({ success: true, details: capture.result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao capturar pagamento", details: err.message });
  }
});

// ==========================================================
// 🧾 LISTAR RESERVAS (PAINEL ADMIN)
// ==========================================================
app.get("/reservas", autenticarAdmin(null), async (req, res) => {
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

    res.json({ total, page, limit, reservas });
  } catch (err) {
    console.error("Erro ao buscar reservas:", err);
    res.status(500).json({ error: "Erro ao buscar reservas" });
  }
});

// ==========================================================
// ====================== MOTORISTAS (MASTER) ========================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "public/uploads")),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// CRUD MOTORISTAS MASTER (mantive igual)
app.post("/admin/motorista", autenticarAdmin("master"), upload.single("imagem"), async (req, res) => {
  try {
    const { codigo, nome, veiculo, email } = req.body; // email para envio diário
    const imagem = req.file ? `/uploads/${req.file.filename}` : undefined;
    const motorista = await Motorista.create({ codigo, nome, veiculo, imagem, email });
    res.json({ success: true, motorista });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar motorista" });
  }
});

app.get("/admin/motoristas", autenticarAdmin("master"), async (req, res) => {
  try {
    const motoristas = await Motorista.find().sort({ nome: 1 });
    res.json({ motoristas });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar motoristas" });
  }
});
app.put("/admin/motorista/:id", autenticarAdmin("master"), upload.single("imagem"), async (req, res) => {
  try {
    const { codigo, nome, veiculo } = req.body;
    const updateData = { codigo, nome, veiculo };
    if (req.file) updateData.imagem = `/uploads/${req.file.filename}`;
    const motorista = await Motorista.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.json({ success: true, motorista });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar motorista" });
  }
});
app.delete("/admin/motorista/:id", autenticarAdmin("master"), async (req, res) => {
  try {
    await Motorista.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao deletar motorista" });
  }
});

// ==========================================================
// 👨‍✈️ ATRIBUIR MOTORISTA (RESERVA E MASTER) (mantive)
// ==========================================================
app.post("/reserva/:id/atribuir", autenticarAdmin(null), async (req, res) => {
  try {
    const reserva = await Reserva.findById(req.params.id);
    if (reserva.motoristaAutomatica) {
      return res.status(403).json({ error: "Não pode atribuir motorista automático" });
    }
    const { motoristaId } = req.body;
    reserva.motorista = motoristaId;
    reserva.status = "em andamento";
    await reserva.save();
    res.json(reserva);
  } catch (err) {
    console.error("Erro ao atribuir motorista:", err);
    res.status(500).json({ error: "Erro ao atribuir motorista" });
  }
});

// ==========================================================
// ✅ MARCAR COMO ENTREGUE (APENAS MASTER) (mantive)
// ==========================================================
app.post("/reserva/:id/entregue", autenticarAdmin("master"), async (req, res) => {
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
// ====================== NOVAS ROTAS: CATEGORIAS / CONFIG ========================
// (Públicas para leitura; admin para CRUD)
// ==========================================================

// Seed defaults (valores provisórios) - altere aqui se quiser outros valores iniciais
const DEFAULT_CATEGORIAS = [
  { nome: "Confort", precoKm: 0.50 },
  { nome: "Premium", precoKm: 0.75 },
  { nome: "XL 7", precoKm: 1.00 },
  { nome: "Passeio", precoKm: 0.70 }
];

// Tempo extra padrão (minutos -> euros)
const DEFAULT_TEMPO_EXTRA = {
  "30": 10,
  "45": 15,
  "60": 20,
  "120": 40,
  "180": 60
};

// GET categorias (público) -> retorna lista
app.get("/categorias", async (req, res) => {
  try {
    const categorias = await Categoria.find().sort({ nome: 1 }).lean();
    res.json(categorias);
  } catch (err) {
    console.error("Erro /categorias:", err);
    res.status(500).json({ error: "Erro ao buscar categorias" });
  }
});

// ADMIN: listar categorias
app.get("/admin/categorias", autenticarAdmin("master"), async (req, res) => {
  try {
    const categorias = await Categoria.find().sort({ nome: 1 });
    res.json({ categorias });
  } catch (err) {
    console.error("Erro /admin/categorias:", err);
    res.status(500).json({ error: "Erro ao buscar categorias" });
  }
});

// ADMIN: criar categoria
app.post("/admin/categoria", autenticarAdmin("master"), async (req, res) => {
  try {
    const { nome, precoKm } = req.body;
    const c = await Categoria.create({ nome, precoKm });
    res.json({ success: true, categoria: c });
  } catch (err) {
    console.error("Erro criar categoria:", err);
    res.status(500).json({ error: "Erro ao criar categoria" });
  }
});

// ADMIN: editar
app.put("/admin/categoria/:id", autenticarAdmin("master"), async (req, res) => {
  try {
    const { nome, precoKm } = req.body;
    const c = await Categoria.findByIdAndUpdate(req.params.id, { nome, precoKm }, { new: true });
    res.json({ success: true, categoria: c });
  } catch (err) {
    console.error("Erro atualizar categoria:", err);
    res.status(500).json({ error: "Erro ao atualizar categoria" });
  }
});

// ADMIN: deletar
app.delete("/admin/categoria/:id", autenticarAdmin("master"), async (req, res) => {
  try {
    await Categoria.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error("Erro deletar categoria:", err);
    res.status(500).json({ error: "Erro ao deletar categoria" });
  }
});

// Config: obter tempoExtra (público)
app.get("/config", async (req, res) => {
  try {
    let config = await Config.findOne().lean();
    if (!config) {
      // se não existir, respondemos com DEFAULT_TEMPO_EXTRA
      return res.json({ tempoExtra: DEFAULT_TEMPO_EXTRA });
    }
    // converter Map para objeto simples
    const obj = {};
    for (const [k, v] of config.tempoExtra.entries()) obj[k] = v;
    res.json({ tempoExtra: obj });
  } catch (err) {
    console.error("Erro /config:", err);
    res.status(500).json({ error: "Erro ao buscar config" });
  }
});

// ADMIN: obter config completa
app.get("/admin/config", autenticarAdmin("master"), async (req, res) => {
  try {
    let config = await Config.findOne();
    if (!config) {
      // cria default
      config = await Config.create({ tempoExtra: DEFAULT_TEMPO_EXTRA });
    }
    const obj = {};
    for (const [k, v] of config.tempoExtra.entries()) obj[k] = v;
    res.json({ config: obj });
  } catch (err) {
    console.error("Erro /admin/config:", err);
    res.status(500).json({ error: "Erro ao buscar config" });
  }
});

// ADMIN: atualizar config (envia objeto { tempoExtra: { "30":10, ... } })
app.put("/admin/config", autenticarAdmin("master"), async (req, res) => {
  try {
    const { tempoExtra } = req.body;
    let config = await Config.findOne();
    if (!config) {
      config = new Config();
    }
    config.tempoExtra = tempoExtra;
    await config.save();
    res.json({ success: true });
  } catch (err) {
    console.error("Erro atualizar config:", err);
    res.status(500).json({ error: "Erro ao atualizar config" });
  }
});

// ==========================================================
// 🔹 SEED INICIAL: cria categorias/config padrão se não existir
// ==========================================================
async function seedDefaults() {
  try {
    const cnt = await Categoria.countDocuments();
    if (cnt === 0) {
      console.log("📦 Seed: criando categorias padrão...");
      await Categoria.insertMany(DEFAULT_CATEGORIAS);
      console.log("✅ Categorias criadas");
    }

    const conf = await Config.findOne();
    if (!conf) {
      console.log("📦 Seed: criando config de tempoExtra padrão...");
      await Config.create({ tempoExtra: DEFAULT_TEMPO_EXTRA });
      console.log("✅ Config padrão criada");
    }
  } catch (err) {
    console.error("Erro no seedDefaults:", err);
  }
}
seedDefaults();

// ==========================================================
// 🔹 CRON DIÁRIO - ENVIO DE LINK PARA MOTORISTAS (5h da manhã) (mantive)
// ==========================================================
cron.schedule('0 5 * * *', async () => {
  try {
    console.log('📤 Enviando links de acesso para motoristas...');
    const motoristas = await Motorista.find();
    for (let m of motoristas) {
      const token = jwt.sign({ motoristaId: m._id }, process.env.JWT_SECRET, { expiresIn: '24h' });
      const painelUrl = `${process.env.FRONTEND_URL}/painel-motorista.html?token=${token}`;
      await transporter.sendMail({
        from: process.env.SMTP_USER,
        to: m.email,
        subject: 'Acesso ao seu Painel de Faturação',
        html: `
          <p>Olá ${m.nome},</p>
          <p>Seu painel de faturação está disponível. Clique no botão abaixo para acessar:</p>
          <a href="${painelUrl}" style="display:inline-block;margin-top:10px;padding:10px 20px;background-color:#22c55e;color:white;border-radius:6px;text-decoration:none;">Acessar Painel</a>
          <p>Este link expira em 24 horas.</p>
        `
      });
    }
    console.log('✅ Links enviados com sucesso');
  } catch(err) {
    console.error('❌ Erro ao enviar links de motoristas:', err);
  }
});

// ==========================================================
// 🚀 INICIAR SERVIDOR
app.listen(PORT, () =>
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`)
);

/* ==========================================================
📝 SINALIZAÇÃO FUTURA:
- Adicionar botão para resgate de saldo visível apenas sexta 06:00–13:00
- Campos para upload PDF e duas imagens JPG (até 2MB)
- Controle de saldo líquido + percentual retido
- Relatórios de faturação semanais via PayPal
- Visualização em cards no painel do motorista
- Atualizar cron diário conforme necessário
=========================================================== */
