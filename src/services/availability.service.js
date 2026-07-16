import Colaborador from "../models/Colaborador.js";

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
