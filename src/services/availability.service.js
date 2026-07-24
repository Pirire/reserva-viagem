// O ficheiro real chama-se "colaboradores.js" (minusculas, plural).
// Este import dizia "Colaborador.js": no Windows o sistema de
// ficheiros ignora maiusculas e funciona; no Linux do Render, nao —
// o import rebenta e qualquer rota que dependa desta cadeia
// (requestGate → concelhoPicker → aqui) da erro 500 SO em producao.
import Colaborador from "../models/colaboradores.js";

/**
 * Existe pelo menos 1 colaborador do tipo "frota" nesse concelho e aprovado?
 */
export async function hasFleetInConcelho(concelho) {
  const c = String(concelho || "").trim();
  const count = await Colaborador.countDocuments({
    tipo: "frota",
    concelho: c,
    aprovado: true,
  });
  return count > 0;
}