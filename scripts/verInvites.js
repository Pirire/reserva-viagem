// verInvites.js — mostra o que está gravado nos ShareInvites mais recentes.
// Uso: node verInvites.js
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const URI = process.env.MONGODB_URI;
if (!URI) { console.error("❌ MONGODB_URI não encontrado no .env"); process.exit(1); }

const run = async () => {
  await mongoose.connect(URI);
  console.log("✅ Ligado a", mongoose.connection.name, "\n");

  const col = mongoose.connection.collection("shareinvites");
  // Os 6 invites mais recentes
  const invites = await col.find({}).sort({ createdAt: -1 }).limit(6).toArray();

  if (!invites.length) { console.log("⚠️  Nenhum ShareInvite encontrado."); }

  for (const inv of invites) {
    const dest = inv.destinoParticipante;
    console.log("──────────────────────────────────────────");
    console.log("nome:          ", inv.nome);
    console.log("contacto:      ", inv.contacto);
    console.log("shareId:       ", inv.shareId);
    console.log("pago:          ", inv.pago);
    console.log("status:        ", inv.status);
    console.log("amountDue:     ", inv.amountDue);
    console.log("destino addr:  ", dest?.address ?? "❌ VAZIO");
    console.log("destino lat/lng:", dest ? `${dest.lat}, ${dest.lng}` : "❌ VAZIO");
    console.log("prontoOtpHash: ", inv.prontoOtpHash ? "✅ existe (" + inv.prontoOtpHash.slice(0,15) + "...)" : "❌ VAZIO (sem código chamar motorista)");
    console.log("otpHash (part):", inv.otpHash ? "✅ existe" : "❌ vazio");
  }
  console.log("──────────────────────────────────────────");

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((e) => { console.error("❌ Erro:", e.message); process.exit(1); });
