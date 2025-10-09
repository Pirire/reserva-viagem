import express from "express";
import path from "path";
import basicAuth from "express-basic-auth";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 10000;

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

// Catch-all para páginas públicas
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Inicializa servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
