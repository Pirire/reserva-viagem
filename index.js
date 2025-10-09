// index.js - Servidor de Reservas com admin protegido
import express from "express";
import path from "path";
import basicAuth from "express-basic-auth";
import dotenv from "dotenv";

import Reserva from "./models/Reserva.js";
import Motorista from "./models/Motorista.js";
import TaxaCancelamento from "./models/TaxaCancelamento.js";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 10000;

// Ajuste __dirname para ES Module
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --------------------
// Proteção Basic Auth para admin
// --------------------
app.use("/admin", basicAuth({
  users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
  challenge: true
}));

// Servir frontend admin
app.use("/admin", express.static(path.join(__dirname, "admin")));

// --------------------
// Servir frontend público
// --------------------
app.use(express.static(path.join(__dirname, "public")));

// --------------------
// Catch-all para páginas públicas
// --------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Inicializa servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
