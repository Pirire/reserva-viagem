#!/usr/bin/env node
// scripts/limpar-invites-todos.js
// ══════════════════════════════════════════════════════════════
// Apaga TODOS os invites de Reserva Flexível (modo Evento).
// Inclui pagos, pendentes, expirados — TUDO.
//
// COMO CORRER:
//   1) Dry-run (mostra o que ia apagar):
//      node scripts/limpar-invites-todos.js
//
//   2) Apagar mesmo:
//      node scripts/limpar-invites-todos.js --confirmar
//
// ATENÇÃO: Esta operação é irreversível.
//   • Não apaga invites de Partilha normal (só modo Evento)
//   • Não apaga ShareTrip (os "eventos-mãe"). Se quiseres também
//     apagar os ShareTrip, corre depois com --incluir-trips
// ══════════════════════════════════════════════════════════════

import mongoose from "mongoose";
import ShareInvite from "../src/models/ShareInvite.js";
import ShareTrip   from "../src/models/ShareTrip.js";
import dotenv from "dotenv";
dotenv.config();

const CONFIRMAR      = process.argv.includes("--confirmar");
const INCLUIR_TRIPS  = process.argv.includes("--incluir-trips");

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  LIMPEZA TOTAL — RESERVA FLEXÍVEL (modo Evento)");
  console.log("═══════════════════════════════════════════════════");
  console.log("Modo:", CONFIRMAR ? "⚠️  CONFIRMAR (IRÁ APAGAR TUDO!)" : "✅ DRY-RUN (só mostra)");
  console.log("Incluir ShareTrip?", INCLUIR_TRIPS ? "SIM" : "não (só ShareInvite)");
  console.log("");

  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log("✅ Ligação MongoDB estabelecida");
  console.log("");

  // Estatísticas iniciais
  const totalInvitesGeral = await ShareInvite.countDocuments({});
  const totalInvitesEvento = await ShareInvite.countDocuments({ modoEvento: true });
  const totalTripsGeral = await ShareTrip.countDocuments({});
  const totalTripsEvento = INCLUIR_TRIPS ? await ShareTrip.countDocuments({ modoEvento: true }) : 0;

  const pendentes = await ShareInvite.countDocuments({ modoEvento: true, status: "pendente" });
  const pagos     = await ShareInvite.countDocuments({ modoEvento: true, pago: true });

  console.log("📊 Estado ATUAL:");
  console.log(`   • ShareInvite total: ${totalInvitesGeral}`);
  console.log(`   • ShareInvite modo Evento: ${totalInvitesEvento}`);
  console.log(`      ↳ pendentes: ${pendentes}`);
  console.log(`      ↳ pagos:     ${pagos}`);
  if (INCLUIR_TRIPS) {
    console.log(`   • ShareTrip total: ${totalTripsGeral}`);
    console.log(`   • ShareTrip modo Evento: ${totalTripsEvento}`);
  }
  console.log("");

  if (totalInvitesEvento === 0 && (!INCLUIR_TRIPS || totalTripsEvento === 0)) {
    console.log("✅ Nada para apagar — coleção já está limpa.");
    await mongoose.disconnect();
    return;
  }

  if (!CONFIRMAR) {
    console.log("⚠️  DRY-RUN: nada foi apagado.");
    console.log("");
    console.log("Para apagar mesmo TODOS os invites de Reserva Flexível:");
    console.log("   node scripts/limpar-invites-todos.js --confirmar");
    if (!INCLUIR_TRIPS) {
      console.log("");
      console.log("Para apagar TAMBÉM os ShareTrip (eventos-mãe):");
      console.log("   node scripts/limpar-invites-todos.js --confirmar --incluir-trips");
    }
    await mongoose.disconnect();
    return;
  }

  // Apagar invites
  const resInv = await ShareInvite.deleteMany({ modoEvento: true });
  console.log(`🗑️  ShareInvite apagados: ${resInv.deletedCount}`);

  // Apagar trips (opcional)
  if (INCLUIR_TRIPS) {
    const resTrip = await ShareTrip.deleteMany({ modoEvento: true });
    console.log(`🗑️  ShareTrip apagados: ${resTrip.deletedCount}`);
  }
  console.log("");

  // Estatísticas finais
  const restaInvites = await ShareInvite.countDocuments({});
  const restaTrips = await ShareTrip.countDocuments({});
  console.log("📊 Estado FINAL:");
  console.log(`   • ShareInvite restantes: ${restaInvites} (era ${totalInvitesGeral})`);
  console.log(`   • ShareTrip restantes:   ${restaTrips} (era ${totalTripsGeral})`);
  console.log("");
  console.log("✅ Limpeza concluída.");

  await mongoose.disconnect();
}

main().catch(err => {
  console.error("❌ ERRO:", err);
  process.exit(1);
});