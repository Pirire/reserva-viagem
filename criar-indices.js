// criar-indices.js — REALMETROPOLIS
// node criar-indices.js
import mongoose from "mongoose";
import dotenv   from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
if (!MONGO_URI) { console.error("❌ MONGODB_URI não encontrada no .env"); process.exit(1); }

// Helper — cria índice e ignora se já existir
async function idx(col, spec, opts = {}) {
  try {
    await col.createIndex(spec, opts);
  } catch (e) {
    if (e.code === 85 || e.code === 86 || e.codeName === "IndexOptionsConflict" || e.codeName === "IndexKeySpecsConflict") {
      // índice já existe com opções diferentes — ignorar
    } else {
      throw e;
    }
  }
}

async function main() {
  console.log("\n🔧 REALMETROPOLIS — Índices MongoDB\n");
  await mongoose.connect(MONGO_URI);
  console.log("✅ MongoDB conectado\n");
  const db = mongoose.connection.db;

  console.log("📦 Viagens...");
  const v = db.collection("viagens");
  await idx(v, { status: 1, createdAt: -1 });
  await idx(v, { parceiroId: 1, status: 1 });
  await idx(v, { "hotel.id": 1, status: 1 });
  await idx(v, { hotelId: 1, status: 1 });
  await idx(v, { "motorista.id": 1, status: 1 });
  await idx(v, { clienteId: 1, createdAt: -1 });
  await idx(v, { createdAt: -1 });
  await idx(v, { datahora: 1 });
  await idx(v, { lat: 1, lng: 1 });
  await idx(v, { "extras.modoConvidado": 1, status: 1 });
  console.log("   ✅ Viagens OK\n");

  console.log("📦 Motoristas...");
  const m = db.collection("motoristas");
  await idx(m, { status: 1 });
  await idx(m, { lat: 1, lng: 1 });
  await idx(m, { status: 1, categoria: 1 });
  await idx(m, { ativo: 1, disponivel: 1 });
  // email já existe — ignorar
  console.log("   ✅ Motoristas OK\n");

  console.log("📦 Dispatch Sessions...");
  const d = db.collection("dispatchsessions");
  await idx(d, { tripId: 1 }, { unique: true });
  await idx(d, { status: 1 });
  await idx(d, { lockOwner: 1 });
  await idx(d, { updatedAt: -1 });
  console.log("   ✅ Dispatch OK\n");

  console.log("📦 Reservas...");
  const r = db.collection("reservas");
  await idx(r, { status: 1, createdAt: -1 });
  await idx(r, { clienteId: 1, createdAt: -1 });
  await idx(r, { codigo: 1 }, { unique: true, sparse: true });
  await idx(r, { canal: 1, status: 1 });
  await idx(r, { "extras.remetenteId": 1 });
  await idx(r, { "extras.tokenTicket": 1 }, { sparse: true });
  await idx(r, { datahora: 1 });
  console.log("   ✅ Reservas OK\n");

  console.log("📦 Parceiros...");
  const p = db.collection("conviteparceiros");
  await idx(p, { tipo: 1, status: 1 });
  await idx(p, { bloqueado: 1 });
  await idx(p, { tokenHash: 1 }, { sparse: true });
  console.log("   ✅ Parceiros OK\n");

  console.log("📦 Feedbacks...");
  const f = db.collection("feedbacks");
  await idx(f, { motoristaId: 1, createdAt: -1 });
  await idx(f, { viagemId: 1 });
  await idx(f, { nota: 1 });
  console.log("   ✅ Feedbacks OK\n");

  console.log("📦 Share Trips...");
  const st = db.collection("sharetrips");
  await idx(st, { status: 1, createdAt: -1 });
  await idx(st, { parceiroId: 1 });
  console.log("   ✅ Share Trips OK\n");

  console.log("📦 Clientes...");
  const c = db.collection("clientes");
  await idx(c, { createdAt: -1 });
  console.log("   ✅ Clientes OK\n");

  console.log("📦 Audit Logs...");
  const a = db.collection("auditlogs");
  await idx(a, { action: 1, createdAt: -1 });
  await idx(a, { targetId: 1 });
  await idx(a, { createdAt: -1 });
  console.log("   ✅ Audit Logs OK\n");

  console.log("📦 Finance Snapshots...");
  const fs = db.collection("financesnapshots");
  await idx(fs, { tipo: 1, periodo: -1 });
  await idx(fs, { createdAt: -1 });
  console.log("   ✅ Finance OK\n");

  console.log("═══════════════════════════════════════");
  console.log("✅ Todos os índices criados com sucesso");
  console.log("   Sistema pronto para escalar.");
  console.log("═══════════════════════════════════════\n");

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => { console.error("❌ Erro:", err.message); process.exit(1); });