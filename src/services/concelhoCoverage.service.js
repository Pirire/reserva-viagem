import { CONCELHOS } from "../config/concelhos.js";
import { haversineKm } from "../utils/geo.js";

const norm = (s) => String(s || "").trim();

export function concelhoExists(concelho) {
  return Boolean(CONCELHOS[norm(concelho)]);
}

export function isPointInsideConcelho(point, concelho) {
  const c = CONCELHOS[norm(concelho)];
  if (!c) return { ok: false, reason: "CONCELHO_DESCONHECIDO" };
  if (!point?.lat || !point?.lng) return { ok: false, reason: "SEM_GEO" };

  const d = haversineKm({ lat: c.lat, lng: c.lng }, { lat: Number(point.lat), lng: Number(point.lng) });
  const raio = Number(c.raioKm || 20);

  return d <= raio
    ? { ok: true, distanceKm: Number(d.toFixed(2)), raioKm: raio }
    : { ok: false, reason: "FORA_CONCELHO", distanceKm: Number(d.toFixed(2)), raioKm: raio };
}

/**
 * Regra: permitido se ORIGEM OU DESTINO estiverem dentro do concelho.
 */
export function tripTouchesConcelho({ origemGeo, destinoGeo, concelho }) {
  const a = isPointInsideConcelho(origemGeo, concelho);
  if (a.ok) return { ok: true, side: "ORIGEM", ...a };

  const b = isPointInsideConcelho(destinoGeo, concelho);
  if (b.ok) return { ok: true, side: "DESTINO", ...b };

  return { ok: false, reason: "NAO_TEM_ORIGEM_NEM_DESTINO_NO_CONCELHO", origem: a, destino: b };
}
