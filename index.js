// index.js
import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());

// Caminho para a pasta public
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware de autenticação para o admin
app.get("/admin-reservas.html", (req, res, next) => {
  const auth = { login: process.env.ADMIN_USER, password: process.env.ADMIN_PASS };
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

  if (login && password && login === auth.login && password === auth.password) {
    return res.sendFile(path.join(__dirname, "public", "admin-reservas.html"));
  }

  res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
  res.status(401).send('Autorização necessária.');
});

// Servir arquivos públicos normalmente
app.use(express.static(path.join(__dirname, "public")));

// Conexão com o MongoDB
if (!process.env.MONGO_URI) {
  console.error("❌ Erro: MONGO_URI não foi definida no ambiente!");
  process.exit(1);
} else {
  console.log("🔎 MONGO_URI carregada: OK (valor encontrado)");
}

const client = new MongoClient(process.env.MONGO_URI);
let db;

async function conectarMongo() {
  try {
    await client.connect();
    db = client.db();
    console.log("✅ Conectado ao MongoDB!");
  } catch (err) {
    console.error("Erro ao conectar ao MongoDB:", err);
  }
}
conectarMongo();

// Rotas da API
app.get("/ver-reservas", async (req, res) => {
  try {
    const reservas = await db.collection("reservas").find().toArray();
    res.json(reservas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar reservas" });
  }
});

// Inicia o servidor
app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});
