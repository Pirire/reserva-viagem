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

// Conexão com o MongoDB
const client = new MongoClient(process.env.MONGO_URI);
let db;

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
