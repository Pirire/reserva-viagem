// fix-imports.mjs
// Execute na pasta raiz do backend: node fix-imports.mjs

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const BASE = "./src";

const fixes = [
  {
    file: "routes/partilha.routes.js",
    from: "../services/smsTwilio.js",
    to:   "../modules/notifications/smsTwilio.js",
  },
  {
    file: "routes/quote.routes.js",
    from: "../services/pricing.service.js",
    to:   "../modules/pricing/pricing.service.js",
  },
  {
    file: "routes/ticket.routes.js",
    from: "../services/pricing.service.js",
    to:   "../modules/pricing/pricing.service.js",
  },
  {
    file: "modules/faturacao/financeSnapshot.service.js",
    from: "../models/FinanceSnapshot.js",
    to:   "../../models/FinanceSnapshot.js",
  },
  {
    file: "modules/faturacao/financeSnapshot.service.js",
    from: "../models/Reserva.js",
    to:   "../../models/Reserva.js",
  },
  {
    file: "modules/faturacao/financeSnapshot.service.js",
    from: "../utils/period.js",
    to:   "../../utils/period.js",
  },
  {
    file: "server.js",
    from: "./services/financeSnapshot.service.js",
    to:   "./modules/faturacao/financeSnapshot.service.js",
  },
];

let totalFixed = 0;

for (const fix of fixes) {
  const path = join(BASE, fix.file);
  try {
    const original = readFileSync(path, "utf-8");
    if (!original.includes(fix.from)) {
      console.log(`✅ ${fix.file} — já correcto`);
      continue;
    }
    const updated = original.split(fix.from).join(fix.to);
    writeFileSync(path, updated, "utf-8");
    console.log(`✅ ${fix.file} — corrigido`);
    console.log(`   "${fix.from}" → "${fix.to}"`);
    totalFixed++;
  } catch (err) {
    console.error(`❌ ${fix.file} — erro: ${err.message}`);
  }
}

console.log(`\n✅ Total corrigido: ${totalFixed} ficheiro(s)`);
console.log("🚀 Pode reiniciar o servidor agora.");
