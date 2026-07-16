// scripts/limparViagensTeste.js
// ══════════════════════════════════════════════════════════════
// Apaga TODOS os documentos das coleções relacionadas com viagens
// — Trip (collection "viagens"), Reserva, ShareTrip, ShareInvite,
// DispatchSession — para limpar dados de teste antes de ir para
// produção.
//
// NÃO apaga: Motorista, Veiculo, Cliente, Colaborador, OperadorSeguranca,
// nem nenhuma configuração (KmConfig, AdminQuoteConfig). Só o que é
// gerado por reservas/viagens/partilhas de teste.
//
// USO:
//   node scripts/limparViagensTeste.js
//   node scripts/limparViagensTeste.js --confirmar
//
// Por segurança, sem --confirmar o script só MOSTRA quantos
// documentos seriam apagados em cada coleção (modo "dry run"), sem
// apagar nada. Só apaga de facto com a flag --confirmar.
// ══════════════════════════════════════════════════════════════
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const CONFIRMAR = process.argv.includes("--confirmar");

// Coleções a limpar — usar nomes de coleção directamente (não os
// modelos, para não depender de imports/schemas que podem mudar).
const COLECOES = [
  "viagens",          // Trip.js (model "Trip", collection "viagens")
  "reservas",         // Reserva.js
  "sharetrips",       // ShareTrip.js
  "shareinvites",     // ShareInvite.js
  "dispatchsessions", // DispatchSession.js
];

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ MONGODB_URI (ou MONGO_URI) não definido no .env. Abortado.");
    process.exit(1);
  }

  console.log(`🔌 A ligar a: ${uri.replace(/\/\/.*@/, "//***:***@")}`); // esconde credenciais no log
  await mongoose.connect(uri);
  console.log("✅ Ligado.\n");

  const db = mongoose.connection.db;
  let totalEncontrados = 0;

  for (const nome of COLECOES) {
    const existe = await db.listCollections({ name: nome }).hasNext();
    if (!existe) {
      console.log(`⚪ ${nome.padEnd(20)} — coleção não existe, a ignorar.`);
      continue;
    }
    const count = await db.collection(nome).countDocuments();
    totalEncontrados += count;
    console.log(`${count > 0 ? "🟡" : "⚪"} ${nome.padEnd(20)} — ${count} documento(s)`);
  }

  console.log("");

  if (!CONFIRMAR) {
    console.log(`ℹ️  Modo de simulação (dry run) — nada foi apagado.`);
    console.log(`ℹ️  Total a apagar: ${totalEncontrados} documento(s).`);
    console.log(`ℹ️  Para apagar de facto, corra: node scripts/limparViagensTeste.js --confirmar`);
  } else {
    console.log(`🗑️  A apagar ${totalEncontrados} documento(s)...\n`);
    for (const nome of COLECOES) {
      const existe = await db.listCollections({ name: nome }).hasNext();
      if (!existe) continue;
      const result = await db.collection(nome).deleteMany({});
      console.log(`✅ ${nome.padEnd(20)} — ${result.deletedCount} apagado(s)`);
    }
    console.log(`\n✅ Limpeza concluída.`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
