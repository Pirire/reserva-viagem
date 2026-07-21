// scripts/verVeiculo.js
// Mostra EXATAMENTE como o veículo está gravado e ligado ao motorista,
// para sabermos os nomes certos dos campos (marca/modelo/matricula) e
// o campo de ligação (motoristaId? motorista? dono?).
//
//   node scripts/verVeiculo.js

import "dotenv/config";
import mongoose from "mongoose";

const MOTORISTA_ID = "6a538533c82d768d210f8b6e";
const MONGO = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL || "";

async function main() {
  if (!MONGO) { console.error("❌ Sem MONGO_URI."); process.exit(1); }
  await mongoose.connect(MONGO);
  console.log("✅ Ligado");
  console.log("──────────────────────────────────────────");
  const db = mongoose.connection.db;

  // Listar coleções para achar a de veículos
  const cols = (await db.listCollections().toArray()).map(c => c.name);
  const nomeColecao = cols.find(n => /veic/i.test(n));
  console.log("Coleções com 'veic':", cols.filter(n => /veic/i.test(n)).join(", ") || "(nenhuma)");
  console.log("──────────────────────────────────────────");

  if (!nomeColecao) { console.log("❌ Nenhuma coleção de veículos encontrada."); await mongoose.disconnect(); process.exit(0); }

  const col = db.collection(nomeColecao);
  const motObjId = new mongoose.Types.ObjectId(MOTORISTA_ID);

  // Tentar vários campos de ligação
  const tentativas = [
    { motoristaId: motObjId }, { motoristaId: MOTORISTA_ID },
    { motorista: motObjId },   { motorista: MOTORISTA_ID },
    { dono: motObjId },        { condutorId: motObjId },
  ];
  let achou = null, campoUsado = null;
  for (const q of tentativas) {
    const v = await col.findOne(q);
    if (v) { achou = v; campoUsado = Object.keys(q)[0]; break; }
  }

  if (!achou) {
    console.log(`⚠️ Não achei veículo deste motorista em "${nomeColecao}" por nenhum campo comum.`);
    console.log("   Mostro 1 veículo qualquer para ver a estrutura:");
    achou = await col.findOne({});
    campoUsado = "(desconhecido)";
  }

  if (achou) {
    console.log(`Coleção de veículos:  "${nomeColecao}"`);
    console.log(`Campo de ligação:     "${campoUsado}"`);
    console.log("──────────────────────────────────────────");
    console.log("CAMPOS DO VEÍCULO (os nomes reais):");
    for (const [k, val] of Object.entries(achou)) {
      if (k === "_id") continue;
      const s = typeof val === "object" ? JSON.stringify(val) : String(val);
      console.log(`   ${k}: ${s.slice(0, 60)}`);
    }
    console.log("──────────────────────────────────────────");
    console.log("O QUE O ENDPOINT PRECISA:");
    console.log("  • campo de ligação =", campoUsado, "(o endpoint usa 'motoristaId')");
    console.log("  • marca? modelo? matricula? — confirmar acima os nomes exatos");
  }

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error("❌", e.message); process.exit(1); });
