// src/twilioMessageStatus.js
//
// Diagnóstico directo via API — consulta o estado real de uma
// mensagem SMS específica sem depender da interface web da Twilio
// (que por vezes falha a abrir os detalhes).
//
// USO:
//   node src/twilioMessageStatus.js SMf20f495e6b5a96e8bdc8b62f82758f4c
//
// Sem argumento, mostra as últimas 5 mensagens enviadas pela conta.
//
import dotenv from "dotenv";
dotenv.config();

import twilio from "twilio";

const SID = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
const TOKEN = String(process.env.TWILIO_AUTH_TOKEN || "").trim();

if (!SID || !TOKEN) {
  console.error("❌ Falta TWILIO_ACCOUNT_SID ou TWILIO_AUTH_TOKEN no .env");
  process.exit(1);
}

const client = twilio(SID, TOKEN);
const messageSid = process.argv[2];

function printMessage(msg) {
  console.log("──────────────────────────────────────────");
  console.log("SID:           ", msg.sid);
  console.log("Data criação:  ", msg.dateCreated);
  console.log("De:            ", msg.from);
  console.log("Para:          ", msg.to);
  console.log("Status:        ", msg.status);
  console.log("Error Code:    ", msg.errorCode);
  console.log("Error Message: ", msg.errorMessage);
  console.log("Messaging SID: ", msg.messagingServiceSid || "(nenhum)");
}

async function main() {
  try {
    if (messageSid) {
      console.log(`🔍 A consultar mensagem específica: ${messageSid}\n`);
      const msg = await client.messages(messageSid).fetch();
      printMessage(msg);
    } else {
      console.log("🔍 A listar as últimas 5 mensagens enviadas...\n");
      const messages = await client.messages.list({ limit: 5 });
      if (!messages.length) {
        console.log("Nenhuma mensagem encontrada.");
        return;
      }
      messages.forEach(printMessage);
    }
  } catch (err) {
    console.error("❌ Erro ao consultar Twilio:", err?.message || err);
    process.exitCode = 1;
  }
}

main();