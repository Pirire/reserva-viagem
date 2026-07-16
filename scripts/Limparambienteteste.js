// scripts/limparAmbienteTeste.js
// ══════════════════════════════════════════════════════════════
// Apaga TODOS os dados de teste do sistema de motoristas/validação:
//   • motoristas           (registados directamente)
//   • veiculos             (todos)
//   • validationsubmissions (submissões via gestor de frota)
//   • motoristapendentes   (legado)
//
// Usar quando queremos começar do zero — por exemplo antes de
// testar o fluxo end-to-end da Reserva Flexível.
//
// USO:
//   node scripts/limparAmbienteTeste.js              (simulação)
//   node scripts/limparAmbienteTeste.js --confirmar  (apaga)
// ══════════════════════════════════════════════════════════════
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const CONFIRMAR = process.argv.includes("--confirmar");

const COLECOES_A_LIMPAR = [
  "motoristas",
  "veiculos",
  "validationsubmissions",
  "motoristapendentes",
];

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ MONGODB_URI (ou MONGO_URI) não definido no .env. Abortado.");
    process.exit(1);
  }
  console.log(`🔌 A ligar a: ${uri.replace(/\/\/.*@/, "//***:***@")}`);
  await mongoose.connect(uri);
  console.log("✅ Ligado.\n");

  const db = mongoose.connection.db;

  console.log("═══════════════════════════════════════════════════");
  console.log("  ESTADO ACTUAL");
  console.log("═══════════════════════════════════════════════════");
  const totais = {};
  for (const nome of COLECOES_A_LIMPAR) {
    const existe = await db.listCollections({ name: nome }).hasNext();
    const total = existe ? await db.collection(nome).countDocuments() : 0;
    totais[nome] = { existe, total };
    console.log(`${total > 0 ? "🟡" : "⚪"} ${nome.padEnd(25)} — ${total} documento(s)`);
  }
  console.log("");

  if (!CONFIRMAR) {
    console.log("ℹ️  Modo de simulação (dry run) — nada foi apagado.");
    console.log("ℹ️  Para apagar de facto, corra:");
    console.log("      node scripts/limparAmbienteTeste.js --confirmar");
  } else {
    console.log("═══════════════════════════════════════════════════");
    console.log("  A APAGAR");
    console.log("═══════════════════════════════════════════════════");
    for (const nome of COLECOES_A_LIMPAR) {
      if (!totais[nome].existe) continue;
      const r = await db.collection(nome).deleteMany({});
      console.log(`✅ ${nome.padEnd(25)} — ${r.deletedCount} apagado(s)`);
    }
    console.log("\n✅ Ambiente de teste limpo.");
    console.log("");
    console.log("📝 PRÓXIMO PASSO:");
    console.log("   Registar novo motorista no gestor-frota.html e");
    console.log("   confirmar que aparece no painel de validações.");
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});