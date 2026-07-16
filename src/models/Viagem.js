// src/models/Viagem.js
// ══════════════════════════════════════════════════════════════
// ALIAS de compatibilidade — aponta para o modelo canónico Trip.
//
// Este ficheiro existe apenas para não quebrar imports existentes
// que referenciem "Viagem" ou "ViagemAtual".
// Em código novo, importar sempre diretamente de Trip.js.
// ══════════════════════════════════════════════════════════════

export { default } from "./Trip.js";