import { CONCELHOS } from "../config/concelhos.js";
import { haversineKm } from "../utils/geo.js";
import { hasFleetInConcelho } from "./availability.service.js";

export async function pickNearestConcelhoWithFleet(origemGeo) {
  if (!origemGeo?.lat || !origemGeo?.lng) return null;

  const entries = Object.entries(CONCELHOS);

  // calcula distâncias
  const ranked = entries
    .map(([name, c]) => ({
      concelho: name,
      distanceKm: haversineKm(
        { lat: Number(c.lat), lng: Number(c.lng) },
        { lat: Number(origemGeo.lat), lng: Number(origemGeo.lng) }
      ),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  // escolhe o mais próximo que tenha frota aprovada
  for (const item of ranked) {
    const ok = await hasFleetInConcelho(item.concelho);
    if (ok) return { concelho: item.concelho, distanceKm: Number(item.distanceKm.toFixed(2)) };
  }

  return null;
}
