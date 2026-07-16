import { pickNearestConcelhoWithFleet } from "./concelhoPicker.service.js";
import { tripTouchesConcelho } from "./concelhoCoverage.service.js";

export async function gateRequestByConcelho({ origemGeo, destinoGeo }) {
  // 1) escolher concelho automaticamente (baseado na origem)
  const picked = await pickNearestConcelhoWithFleet(origemGeo);

  if (!picked) {
    return {
      ok: false,
      code: "NO_COVERAGE",
      message: "Lamentamos, mas não temos motoristas disponíveis nesta área.",
    };
  }

  // 2) validar se a viagem “toca” o concelho (origem OU destino dentro)
  const touch = tripTouchesConcelho({ origemGeo, destinoGeo, concelho: picked.concelho });

  if (!touch.ok) {
    return {
      ok: false,
      code: "OUT_OF_AREA",
      message: "Lamentamos, mas não temos motoristas disponíveis nesta área.",
      meta: { concelho: picked.concelho },
    };
  }

  return { ok: true, concelho: picked.concelho, meta: { picked } };
}
