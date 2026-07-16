// fix-comissao-plataforma.js
// ══════════════════════════════════════════════════════════════
// Script de correção ÚNICA — o valor por defeito no schema mudou
// de 0.15 (15%) para 0.25 (25%), mas isso só afeta configurações
// NOVAS. Se já existe um documento AdminQuoteConfig gravado (quase
// certo, é uma configuração singleton), este script corrige o
// valor já guardado.
//
// Corre uma vez, a partir da pasta backend:
//   node fix-comissao-plataforma.js
// ══════════════════════════════════════════════════════════════
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;

if (!MONGO_URI) {
  console.error("Nao encontrei a variavel de ligacao ao MongoDB no .env.");
  process.exit(1);
}

const AdminQuoteConfigSchema = new mongoose.Schema({}, { strict: false });
const AdminQuoteConfig = mongoose.models.AdminQuoteConfig
  || mongoose.model("AdminQuoteConfig", AdminQuoteConfigSchema, "adminquoteconfigs");

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("Ligado ao MongoDB.");
  console.log("   Base de dados:", mongoose.connection.name);
  console.log("   Host:", mongoose.connection.host);
  console.log("");

  const todos = await AdminQuoteConfig.find({});
  console.log(`Documentos AdminQuoteConfig encontrados: ${todos.length}`);

  if (!todos.length) {
    console.log("Nenhum documento existente — o valor novo (0.25) só se aplica quando o schema criar um, nao ha nada para corrigir agora.");
    await mongoose.disconnect();
    return;
  }

  for (const doc of todos) {
    console.log(`Antes [key=${doc.key}]: plataformaPercent =`, doc.plataformaPercent);
    doc.plataformaPercent = 0.25;
    await doc.save();
    const confirmacao = await AdminQuoteConfig.findById(doc._id).lean();
    console.log(`Depois [key=${doc.key}]: plataformaPercent =`, confirmacao.plataformaPercent);
  }

  console.log("Corrigido com sucesso.");
  await mongoose.disconnect();
}

main().catch(err => {
  console.error("Erro:", err);
  process.exit(1);
});
