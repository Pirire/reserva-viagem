import "dotenv/config";
import mongoose from "mongoose";
import crypto from "crypto";
import Motorista from "./src/models/Motorista.js";

async function gerar() {

  await mongoose.connect(process.env.MONGODB_URI);

  const id = "697bab8aa9829b9535180878";

  const token = crypto.randomBytes(32).toString("hex");

  const tokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24);

  await Motorista.findByIdAndUpdate(id, {
    $set: {
      "convite.tokenHash": tokenHash,
      "convite.expiresAt": expiresAt,
      "convite.usadoEm": null,
    },
  });

  console.log("\n============================");
  console.log("🔗 LINK DO MOTORISTA:");
  console.log(`http://localhost:10000/motorista-primeiro-acesso.html?token=${token}`);
  console.log("============================\n");

  process.exit();
}

gerar();
