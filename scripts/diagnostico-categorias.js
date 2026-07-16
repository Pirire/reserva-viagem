// diagnostico-categorias.js
// ══════════════════════════════════════════════════════════════
// Script de DIAGNÓSTICO — só leitura, não altera nada.
//
// Lista todos os veículos e mostra, para cada um, se a
// Marca/Modelo bate certo com alguma regra configurada em
// "Categorias Veículos". Serve para descobrir de uma vez quantos
// veículos ainda vão ter o mesmo problema do Mustang Mach-E, em vez
// de irmos descobrindo um a um à medida que aparecem bugs.
//
// Corre a partir da pasta backend:
//   node diagnostico-categorias.js
// ══════════════════════════════════════════════════════════════
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;

if (!MONGO_URI) {
  console.error("❌ Não encontrei a variável de ligação ao MongoDB no .env.");
  process.exit(1);
}

const VeiculoSchema = new mongoose.Schema({}, { strict: false });
const Veiculo = mongoose.models.Veiculo || mongoose.model("Veiculo", VeiculoSchema, "veiculos");

const RuleSchema = new mongoose.Schema({}, { strict: false });
const VehicleCategoryRule = mongoose.models.VehicleCategoryRule
  || mongoose.model("VehicleCategoryRule", RuleSchema, "vehiclecategoryrules");

function normalizar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("✅ Ligado ao MongoDB.");
  console.log("   Base de dados:", mongoose.connection.name);
  console.log("   Host:", mongoose.connection.host);
  console.log("   Pasta de onde correu (cwd):", process.cwd());
  console.log("");

  const [veiculos, regras] = await Promise.all([
    Veiculo.find({}).select("marca modelo matricula categoriasPermitidas aprovacao").lean(),
    VehicleCategoryRule.find({}).select("marcaLabel modeloLabel categorias").lean(),
  ]);

  const regrasSet = new Set(
    regras.map(r => `${normalizar(r.marcaLabel)}|${normalizar(r.modeloLabel)}`)
  );

  console.log(`Total de veículos: ${veiculos.length}`);
  console.log(`Total de regras configuradas: ${regras.length}\n`);
  console.log("─".repeat(70));

  let comRegra = 0;
  let semRegra = 0;

  for (const v of veiculos) {
    const chave = `${normalizar(v.marca)}|${normalizar(v.modelo)}`;
    const temRegra = regrasSet.has(chave);
    const temPermitidas = Array.isArray(v.categoriasPermitidas) && v.categoriasPermitidas.length > 0;

    if (temRegra) comRegra++; else semRegra++;

    const status = temRegra
      ? (temPermitidas ? "✅ OK" : "⚠️  REGRA EXISTE MAS categoriasPermitidas VAZIO — repete 'GUARDAR' no painel")
      : "❌ SEM REGRA — motorista nunca vai conseguir ligar categorias";

    console.log(
      `${v.matricula?.padEnd(12) || "(sem matrícula)"} | marca:"${v.marca}" modelo:"${v.modelo}" | ${status}`
    );
  }

  console.log("─".repeat(70));
  console.log(`\nResumo: ${comRegra} com regra correspondente, ${semRegra} SEM regra correspondente.`);
  if (semRegra > 0) {
    console.log(`\nPara cada veículo "❌ SEM REGRA": ou corrige a marca/modelo do veículo`);
    console.log(`(para bater certo com uma regra já existente), ou cria uma regra nova`);
    console.log(`no painel "Categorias Veículos" com essa Marca/Modelo exata.`);
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error("❌ Erro:", err);
  process.exit(1);
});