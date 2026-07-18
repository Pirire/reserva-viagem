// scripts/diagnosticoDespacho.js
// ══════════════════════════════════════════════════════════════
// Descobre PORQUE o despacho não encontra motorista.
// Testa, passo a passo, os mesmos filtros que o autoDispatch usa,
// e mostra quantos motoristas passam em cada etapa.
//
// USO:  node scripts/diagnosticoDespacho.js
// ══════════════════════════════════════════════════════════════
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
if (!uri) { console.log("❌ Falta MONGODB_URI no .env"); process.exit(1); }

await mongoose.connect(uri);
console.log("✅ Ligado à base de dados.\n");

const db = mongoose.connection.db;
const Motoristas = db.collection("motoristas");
const Veiculos   = db.collection("veiculos");
const Viagens    = db.collection("viagens");

// ─── Distância (mesma fórmula do autoDispatch) ───
function distKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}
const RAIO = 7;

console.log("═══════════════════════════════════════════");
console.log("  ETAPA 1 — MOTORISTAS");
console.log("═══════════════════════════════════════════");
const todos = await Motoristas.find({}).toArray();
console.log(`Total de motoristas na base: ${todos.length}`);

for (const m of todos) {
  console.log(`\n  • ${m.nome || "(sem nome)"} [${m._id}]`);
  console.log(`    disponivel: ${JSON.stringify(m.disponivel)}  (precisa: true)`);
  console.log(`    aprovacao:  ${JSON.stringify(m.aprovacao)}  (precisa: "aprovado")`);
  console.log(`    lat/lng:    ${m.lat} , ${m.lng}  ${(m.lat!=null&&m.lng!=null)?"✅":"❌ SEM COORDENADAS"}`);
  // campo status legacy (para despistar)
  if (m.status !== undefined) console.log(`    status (legacy): ${JSON.stringify(m.status)}`);
}

const disponiveis = todos.filter(m => m.disponivel === true && m.aprovacao === "aprovado");
console.log(`\n➡️  Passam em {disponivel:true, aprovacao:"aprovado"}: ${disponiveis.length} de ${todos.length}`);
if (!disponiveis.length) {
  console.log("❌ PROBLEMA AQUI: nenhum motorista com disponivel:true E aprovacao:'aprovado'.");
  console.log("   Verifica: o motorista clicou 'Ficar Online'? Está aprovado?");
}

console.log("\n═══════════════════════════════════════════");
console.log("  ETAPA 2 — VEÍCULOS");
console.log("═══════════════════════════════════════════");
const veiculos = await Veiculos.find({}).toArray();
console.log(`Total de veículos na base: ${veiculos.length}`);
for (const v of veiculos) {
  console.log(`\n  • Veículo [${v._id}]  motoristaId: ${v.motoristaId}`);
  console.log(`    disponivel: ${JSON.stringify(v.disponivel)}  (precisa: true)`);
  console.log(`    aprovacao:  ${JSON.stringify(v.aprovacao)}  (precisa: "aprovado")`);
  console.log(`    categoriasAtivas: ${JSON.stringify(v.categoriasAtivas)}`);
}

console.log("\n═══════════════════════════════════════════");
console.log("  ETAPA 3 — VIAGEM MAIS RECENTE (pendente)");
console.log("═══════════════════════════════════════════");
const viagem = await Viagens.find({}).sort({ _id: -1 }).limit(1).toArray().then(a => a[0]);
if (!viagem) {
  console.log("❌ Nenhuma viagem na base.");
} else {
  console.log(`Viagem: ${viagem.tripId || viagem._id}`);
  console.log(`  status: ${viagem.status}`);
  console.log(`  categoria: ${JSON.stringify(viagem.categoria)}  (a viagem pede esta)`);
  console.log(`  lat/lng: ${viagem.lat} , ${viagem.lng}  ${(viagem.lat!=null&&viagem.lng!=null)?"✅":"❌ SEM COORDENADAS — o despacho rejeita já aqui!"}`);

  // ── Simular a cadeia completa ──
  console.log("\n═══════════════════════════════════════════");
  console.log("  SIMULAÇÃO DA CADEIA DE DESPACHO");
  console.log("═══════════════════════════════════════════");

  const catPedida = String(viagem.categoria || "").toLowerCase();
  console.log(`Categoria pedida (normalizada): "${catPedida}"`);

  // veículos elegíveis para a categoria
  const veicElegiveis = veiculos.filter(v =>
    v.motoristaId != null &&
    v.disponivel === true &&
    v.aprovacao === "aprovado" &&
    Array.isArray(v.categoriasAtivas) &&
    v.categoriasAtivas.map(c=>String(c).toLowerCase()).includes(catPedida)
  );
  console.log(`\nVeículos elegíveis para "${catPedida}": ${veicElegiveis.length}`);
  if (!veicElegiveis.length) {
    console.log(`❌ PROVÁVEL PROBLEMA: nenhum veículo tem "${catPedida}" em categoriasAtivas`);
    console.log(`   (ou o veículo não está disponivel:true / aprovacao:"aprovado" / sem motoristaId)`);
    console.log(`   Categorias que os veículos TÊM:`);
    veiculos.forEach(v => console.log(`     - ${JSON.stringify(v.categoriasAtivas)}`));
  }

  const idsElegiveis = new Set(veicElegiveis.map(v => String(v.motoristaId)));
  const motElegiveis = disponiveis.filter(m => idsElegiveis.has(String(m._id)));
  console.log(`\nMotoristas disponíveis COM veículo elegível: ${motElegiveis.length}`);

  if (viagem.lat != null && viagem.lng != null) {
    const dentroRaio = motElegiveis.filter(m => {
      if (m.lat == null || m.lng == null) return false;
      const d = distKm(viagem.lat, viagem.lng, m.lat, m.lng);
      console.log(`   ${m.nome}: ${d.toFixed(2)} km ${d<=RAIO?"✅ dentro":"❌ FORA do raio "+RAIO+"km"}`);
      return d <= RAIO;
    });
    console.log(`\n➡️  Candidatos finais (dentro de ${RAIO}km): ${dentroRaio.length}`);
    if (!dentroRaio.length && motElegiveis.length) {
      console.log(`❌ PROBLEMA: há motoristas elegíveis mas estão a MAIS de ${RAIO}km da origem.`);
      console.log(`   Origem da viagem: ${viagem.lat}, ${viagem.lng}`);
    }
    if (dentroRaio.length) {
      console.log(`\n✅✅ DEVERIA ENCONTRAR MOTORISTA! Se mesmo assim falha, o problema é outro.`);
    }
  }
}

await mongoose.disconnect();
console.log("\nFeito.");
