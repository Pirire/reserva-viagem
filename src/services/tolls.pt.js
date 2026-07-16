/**
 * Cálculo profissional de portagens (Portugal)
 * - NÃO depende do Google
 * - NÃO duplica valores
 * - Compatível com ESM (type: module)
 *
 * Export principal esperado pelas rotas:
 *   calcTollsPortugalFromDirectionsRoute(routeOrDistanceKm, categoria?)
 *
 * Aceita:
 *  - um número (distância em km)
 *  - ou um "route" (objeto) do tipo Google Directions/Routes, desde que tenha distância
 */

function calcularPortagens(distanciaKm, categoria) {
  if (!Number.isFinite(distanciaKm) || distanciaKm <= 0) {
    return { total: 0, tolls: [], status: "SEM_DADOS" };
  }

  // ZONA URBANA / CURTA
  if (distanciaKm < 25) {
    return { total: 0, tolls: [], status: "SEM_PORTAGENS" };
  }

  // TABELA FIXA POR DISTÂNCIA (PT)
  let valor = 0;

  if (distanciaKm >= 25 && distanciaKm < 60) valor = 1.5;
  else if (distanciaKm >= 60 && distanciaKm < 120) valor = 3.0;
  else if (distanciaKm >= 120 && distanciaKm < 250) valor = 5.5;
  else valor = 7.5;

  // SERVIÇOS PREMIUM absorvem parte do custo
  if (["EXECUTIVE", "LUXURY"].includes(String(categoria || "").toUpperCase())) {
    valor *= 0.85;
  }

  const v = Number(valor.toFixed(2));

  return {
    total: v,
    status: "PORTAGEM_FIXA",
    tolls: [
      {
        code: "AUTOESTRADA",
        name: "Autoestrada (estimativa)",
        amountEUR: v,
      },
    ],
  };
}

/**
 * Extrai distância (em km) de formatos comuns:
 * - number (já em km)
 * - Google Directions: route.legs[].distance.value (metros)
 * - Google Routes v2: route.distanceMeters (metros)
 * - Campos genéricos: distanceKm, distance_km, distanciaKm
 */
function extractDistanceKm(routeOrDistanceKm) {
  if (typeof routeOrDistanceKm === "number") return routeOrDistanceKm;

  if (!routeOrDistanceKm || typeof routeOrDistanceKm !== "object") return NaN;

  // Google Routes v2 (distanceMeters)
  if (Number.isFinite(routeOrDistanceKm.distanceMeters)) {
    return routeOrDistanceKm.distanceMeters / 1000;
  }

  // Google Directions (legs[].distance.value em metros)
  if (Array.isArray(routeOrDistanceKm.legs) && routeOrDistanceKm.legs.length) {
    const meters = routeOrDistanceKm.legs.reduce((sum, leg) => {
      const v = leg?.distance?.value;
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);
    if (meters > 0) return meters / 1000;
  }

  // Alternativos
  if (Number.isFinite(routeOrDistanceKm.distanceKm)) return routeOrDistanceKm.distanceKm;
  if (Number.isFinite(routeOrDistanceKm.distance_km)) return routeOrDistanceKm.distance_km;
  if (Number.isFinite(routeOrDistanceKm.distanciaKm)) return routeOrDistanceKm.distanciaKm;

  return NaN;
}

/**
 * ✅ Export que as tuas rotas estão a pedir.
 * Pode receber:
 * - (routeObject, categoria)
 * - (distanciaKmNumber, categoria)
 */
export function calcTollsPortugalFromDirectionsRoute(routeOrDistanceKm, categoria) {
  const distanciaKm = extractDistanceKm(routeOrDistanceKm);
  return calcularPortagens(distanciaKm, categoria);
}

/**
 * ✅ Mantém compatibilidade com o teu nome antigo.
 */
export { calcularPortagens };
