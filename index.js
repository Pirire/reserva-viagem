// index.js
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
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
app.use(express.static(path.join(__dirname, "public")));

// Verificar variável de ambiente
const mongoUri = process.env.MONGO_URI;
console.log("🔎 MONGO_URI carregada:", mongoUri ? "OK (valor encontrado)" : "❌ Não definida");

// Conexão com o MongoDB
let db;
if (!mongoUri) {
console.error("❌ Erro: MONGO_URI não foi definida no ambiente!");
} else {
const client = new MongoClient(mongoUri);

async function conectarMongo() {
try {
await client.connect();
db = client.db(); // usa o banco definido na URI
console.log("✅ Conectado ao MongoDB!");
} catch (err) {
console.error("Erro ao conectar ao MongoDB:", err);
}
}
conectarMongo();
}

// Rotas da API
app.get("/ver-reservas", async (req, res) => {
try {
if (!db) return res.status(500).json({ error: "Banco de dados não conectado" });
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
