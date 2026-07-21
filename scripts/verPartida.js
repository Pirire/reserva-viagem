// scripts/verPartida.js
// Diagnóstico: mostra a PARTIDA (lat/lng) das últimas reservas/eventos.
// No ShareTrip, o campo "destino" guarda a PARTIDA (convenção do código).
// Se a partida não tiver lat/lng, o despacho calcula distância errada
// e exclui o motorista → "nenhum motorista dentro de 7km".
//
// Correr:  node scripts/verPartida.js

import "dotenv/config";
import mongoose from "mongoose";

const MONGO =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.DATABASE_URL ||
  "";

async function main() {
  if (!MONGO) {
    console.error("❌ Sem MONGO_URI no .env.");
    process.exit(1);
  }
  await mongoose.connect(MONGO);
  console.log("✅ Ligado à base de dados");
  console.log("──────────────────────────────────────────");

  const db = mongoose.connection.db;

  // As últimas 3 ShareTrip (eventos/reservas flexíveis)
  const sharetrips = db.collection("sharetrips");
  const ultimas = await sharetrips.find({}).sort({ createdAt: -1 }).limit(3).toArray();

  if (!ultimas.length) {
    console.log("⚠️  Nenhuma ShareTrip encontrada.");
  } else {
    console.log(`ÚLTIMAS ${ultimas.length} RESERVAS (ShareTrip):`);
    for (const t of ultimas) {
      console.log("  ─────");
      console.log("   shareId:      ", t.shareId);
      console.log("   modoEvento:   ", t.modoEvento);
      console.log("   PARTIDA (campo 'destino'):");
      console.log("     address:    ", t.destino?.address || "(sem address)");
      console.log("     lat:        ", t.destino?.lat, (t.destino?.lat == null ? "❌ SEM LAT — causa do bug!" : "✅"));
      console.log("     lng:        ", t.destino?.lng, (t.destino?.lng == null ? "❌ SEM LNG — causa do bug!" : "✅"));
      console.log("   categoria:    ", t.categoria);
      console.log("   status:       ", t.status);
    }
  }

  console.log("──────────────────────────────────────────");

  // As últimas 3 Trip (viagens despachadas) — o que o motor lê
  const trips = db.collection("trips");
  const ultimasTrips = await trips.find({}).sort({ _id: -1 }).limit(3).toArray();

  if (!ultimasTrips.length) {
    console.log("⚠️  Nenhuma Trip (viagem) encontrada.");
  } else {
    console.log(`ÚLTIMAS ${ultimasTrips.length} VIAGENS (Trip) — o que o despacho lê:`);
    for (const v of ultimasTrips) {
      console.log("  ─────");
      console.log("   _id:          ", String(v._id));
      console.log("   status:       ", v.status);
      console.log("   lat (legacy): ", v.lat, (v.lat == null ? "❌ SEM LAT — motor não calcula distância!" : "✅"));
      console.log("   lng (legacy): ", v.lng, (v.lng == null ? "❌ SEM LNG — motor não calcula distância!" : "✅"));
      console.log("   origemGeo:    ", v.origemGeo ? `lat=${v.origemGeo.lat} lng=${v.origemGeo.lng}` : "(sem origemGeo)");
    }
  }

  console.log("──────────────────────────────────────────");
  console.log("SE 'lat (legacy)' das Trips estiver ❌ null:");
  console.log("  → é ESSA a causa. A partida não chega ao motor com coordenadas,");
  console.log("    a distância dá erro, e o motorista é sempre excluído.");

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Erro:", e.message);
  process.exit(1);
});
