// scripts/verMotorista.js
// Diagnóstico: mostra o que está gravado no motorista de teste —
// posição (lat/lng), disponibilidade, e veículos. É o que o despacho
// lê para decidir se o motorista é "compatível dentro de 7km".
//
// Correr:  node scripts/verMotorista.js
//
// Se o motorista aparecer com lat/lng a null (ou disponivel:false, ou
// sem veículo disponível+aprovado na categoria certa), essa é a causa
// de "Nenhum motorista compatível dentro de 7km".

import "dotenv/config";
import mongoose from "mongoose";

const MOTORISTA_ID = "6a538533c82d768d210f8b6e"; // o motorista de teste (do log)

const MONGO =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.DATABASE_URL ||
  "";

async function main() {
  if (!MONGO) {
    console.error("❌ Sem MONGO_URI no .env — não sei a que base ligar.");
    process.exit(1);
  }
  await mongoose.connect(MONGO);
  console.log("✅ Ligado à base de dados");
  console.log("──────────────────────────────────────────");

  const db = mongoose.connection.db;

  // 1) O MOTORISTA
  const motoristas = db.collection("motoristas");
  let mot = null;
  try {
    mot = await motoristas.findOne({ _id: new mongoose.Types.ObjectId(MOTORISTA_ID) });
  } catch (e) {
    mot = await motoristas.findOne({ _id: MOTORISTA_ID });
  }

  if (!mot) {
    console.log(`❌ Motorista ${MOTORISTA_ID} NÃO encontrado na coleção "motoristas".`);
  } else {
    console.log("MOTORISTA:");
    console.log("  nome:        ", mot.nome || mot.name || "(sem nome)");
    console.log("  disponivel:  ", mot.disponivel, mot.disponivel === true ? "✅" : "❌ (tem de ser true)");
    console.log("  online:      ", mot.online);
    console.log("  lat:         ", mot.lat, (mot.lat == null ? "❌ SEM POSIÇÃO" : "✅"));
    console.log("  lng:         ", mot.lng, (mot.lng == null ? "❌ SEM POSIÇÃO" : "✅"));
    console.log("  ultimaPosicaoEm:", mot.ultimaPosicaoEm || mot.locatedAt || mot.posicaoAt || "(n/d)");
    console.log("  categoriasAtivas:", mot.categoriasAtivas || mot.categorias || "(n/d)");
    console.log("  veiculoAtivo:", mot.veiculoAtivo || mot.veiculoSelecionado || "(n/d)");
  }

  console.log("──────────────────────────────────────────");

  // 2) OS VEÍCULOS deste motorista
  const veiculos = db.collection("veiculos");
  const listaVeic = await veiculos
    .find({ $or: [
      { motoristaId: MOTORISTA_ID },
      { motoristaId: mot?._id },
      { motorista: MOTORISTA_ID },
      { dono: MOTORISTA_ID },
    ]})
    .toArray();

  if (!listaVeic.length) {
    console.log("⚠️  Nenhum veículo encontrado ligado a este motorista.");
    console.log("    (o despacho precisa de 1 veículo disponível+aprovado na categoria certa)");
  } else {
    console.log(`VEÍCULOS (${listaVeic.length}):`);
    for (const v of listaVeic) {
      console.log("  ─────");
      console.log("   matricula:      ", v.matricula || v.placa || "(n/d)");
      console.log("   disponivel:     ", v.disponivel, v.disponivel === true ? "✅" : "❌ (tem de ser true)");
      console.log("   aprovacao:      ", v.aprovacao, v.aprovacao === "aprovado" ? "✅" : "❌ (tem de ser 'aprovado')");
      console.log("   categoria(s):   ", v.categoriasAtivas || v.categorias || v.categoria || "(n/d)");
    }
  }

  console.log("──────────────────────────────────────────");
  console.log("COMO LER ISTO:");
  console.log("Para o despacho encontrar o motorista, TODAS têm de estar ✅:");
  console.log("  • motorista.disponivel = true");
  console.log("  • motorista.lat e .lng com números (NÃO null)");
  console.log("  • 1 veículo com disponivel:true + aprovacao:'aprovado'");
  console.log("    + categoria a bater com a da reserva");
  console.log("Se algum estiver ❌, é essa a causa de 'nenhum motorista em 7km'.");

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Erro:", e.message);
  process.exit(1);
});
