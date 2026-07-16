// src/twilioCheck.js
import dotenv from "dotenv";
dotenv.config();

import twilio from "twilio";

console.log("✅ twilioCheck arrancou");

const sid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
const token = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
const from = String(process.env.TWILIO_FROM || "").trim();

console.log("[ENV] sidPrefix:", sid.slice(0, 4), "sidLen:", sid.length);
console.log("[ENV] tokenLen:", token.length);
console.log("[ENV] from:", from);

async function main() {
  try {
    if (!sid || !token) throw new Error("Falta TWILIO_ACCOUNT_SID ou TWILIO_AUTH_TOKEN no .env");

    const client = twilio(sid, token);
    const acc = await client.api.accounts(sid).fetch();

    console.log("✅ TWILIO AUTH OK — account:", acc.friendlyName);
  } catch (e) {
    console.error("❌ TWILIO AUTH FAIL:", e?.status, e?.code, e?.message || e);
    process.exitCode = 1;
  }
}

main();