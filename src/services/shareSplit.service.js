// src/services/shareSplit.service.js

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Haversine simples (km) – só para fallback se faltar algo
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad((b.lat - a.lat));
  const dLng = toRad((b.lng - a.lng));
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 = Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s1 + s2)));
}

/**
 * Retorna uma "medida" de distância restante até ao destino final.
 * Preferência:
 * - se tiveres distances na própria route (melhor, mas nem sempre vem fácil)
 * - fallback: distância em linha reta (haversine)
 */
function remainingToDestKm(stopLatLng, destLatLng) {
  if (!stopLatLng || !destLatLng) return null;
  return haversineKm(stopLatLng, destLatLng);
}

/**
 * Split justo por legs com regra anti "contra o destino":
 *
 * - legs que aproximam do destino: pagam os onboard
 * - legs que afastam do destino: paga SOMENTE o passageiro que está a ser recolhido no fim desse leg
 *
 * @param {object} params
 * @param {object} params.directionsRoute routes[0] do Google
 * @param {Array<{contacto:string, nome?:string}>} params.orderedPassengers (na ordem do utilizador)
 * @param {number} params.baseTotal total sem portagens
 * @param {Array<number>} params.tollByLegEUR portagens por leg (mesmo tamanho de legs)
 *
 * @returns {object} { items, totalCheck, flags }
 */
export function splitShareByLegs({
  directionsRoute,
  orderedPassengers,
  baseTotal,
  tollByLegEUR = [],
}) {
  if (!directionsRoute || !Array.isArray(directionsRoute.legs) || !directionsRoute.legs.length) {
    throw new Error("directionsRoute inválido (sem legs).");
  }
  if (!Array.isArray(orderedPassengers) || orderedPassengers.length < 2) {
    throw new Error("orderedPassengers precisa ter pelo menos 2 passageiros.");
  }

  const legs = directionsRoute.legs;
  const N = orderedPassengers.length;

  // items
  const items = orderedPassengers.map((p) => ({
    contacto: String(p.contacto || "").trim(),
    nome: String(p.nome || "").trim() || null,
    kmInCar: 0,
    kmAgainstFlow: 0, // kms “contra destino” cobrados ao próprio
    amountDue: 0,
  }));

  // tentativa de obter destino final (lat/lng)
  // legs[].end_location existe (lat/lng)
  const lastLeg = legs[legs.length - 1];
  const destLatLng = lastLeg?.end_location
    ? { lat: Number(lastLeg.end_location.lat), lng: Number(lastLeg.end_location.lng) }
    : null;

  // determinar se há leg pré-pickup (quando o route começa antes do 1º passageiro)
  // Caso típico para partilha bem montada: legs = N (pickups->destino)
  // Se legs = N+1, assume leg0 é pré-pickup (não cobrado)
  const hasPrePickupLeg = (legs.length === N + 1);

  // Vamos calcular “remaining distance” em cada stop (início de leg e fim de leg)
  // Usando end_location de cada leg como stop seguinte
  // stop0: start_location do leg0
  // stop1: end_location do leg0
  // ...
  const stopLatLngs = [];
  for (let i = 0; i < legs.length; i++) {
    const st = legs[i]?.start_location;
    const en = legs[i]?.end_location;
    if (i === 0 && st) stopLatLngs.push({ lat: Number(st.lat), lng: Number(st.lng) });
    if (en) stopLatLngs.push({ lat: Number(en.lat), lng: Number(en.lng) });
  }

  // remaining[k] = distância do stop k até destino final
  const remaining = stopLatLngs.map((s) => remainingToDestKm(s, destLatLng));

  // total de km cobrável (para ratear baseTotal)
  let chargedKmSum = 0;

  // 1) acumular km por passageiro, com a regra anti contra-fluxo
  for (let legIndex = 0; legIndex < legs.length; legIndex++) {
    const leg = legs[legIndex];
    const km = Number(leg?.distance?.value || 0) / 1000;
    if (!Number.isFinite(km) || km <= 0) continue;

    // onboardLastIndex determina quantos já estão no carro nesse leg
    let onboardLastIndex = hasPrePickupLeg ? (legIndex - 1) : legIndex;
    const onboardCount = Math.min(N, onboardLastIndex + 1);

    // pré-pickup: ninguém paga
    if (onboardCount <= 0) continue;

    // detectar se este leg “afasta do destino”
    // compara remaining no stop antes e depois do leg
    const remA = remaining[legIndex];       // stop antes do leg
    const remB = remaining[legIndex + 1];   // stop depois do leg
    const isAgainstFlow =
      (typeof remA === "number" && typeof remB === "number" && remB > remA + 0.05); // +50m margem

    chargedKmSum += km;

    if (!isAgainstFlow) {
      // ✅ fluxo normal: onboard paga
      for (let i = 0; i < onboardCount; i++) {
        items[i].kmInCar += km;
      }
    } else {
      // ✅ contra-fluxo: paga SOMENTE o passageiro que vai ser recolhido no final deste leg
      // Quem é o “culpado”? é o passageiro que entra depois deste leg.
      // Ex: leg vai buscar o passageiro #2 -> índice 1
      const pickedIndex = onboardCount; // porque onboardCount antes do pickup = nº já dentro
      if (pickedIndex >= 0 && pickedIndex < N) {
        items[pickedIndex].kmInCar += km;
        items[pickedIndex].kmAgainstFlow += km;
      } else {
        // fallback: se não bater, cobra ao último (evita crash)
        items[N - 1].kmInCar += km;
        items[N - 1].kmAgainstFlow += km;
      }
    }
  }

  chargedKmSum = Number(chargedKmSum.toFixed(6));
  if (chargedKmSum <= 0) throw new Error("chargedKmSum=0 (rota sem km cobráveis).");

  // 2) ratear baseTotal pelos kmInCar (já inclui a regra do contra-fluxo)
  for (const it of items) {
    const frac = it.kmInCar / chargedKmSum;
    it.amountDue = round2(Number(baseTotal || 0) * frac);
    it.kmInCar = round2(it.kmInCar);
    it.kmAgainstFlow = round2(it.kmAgainstFlow);
  }

  // 3) portagens por leg:
  // - se for fluxo normal: onboard paga igualmente
  // - se for contra-fluxo: só paga o passageiro recolhido nesse leg
  if (Array.isArray(tollByLegEUR) && tollByLegEUR.length) {
    for (let legIndex = 0; legIndex < legs.length; legIndex++) {
      const toll = round2(Number(tollByLegEUR[legIndex] || 0));
      if (toll <= 0) continue;

      let onboardLastIndex = hasPrePickupLeg ? (legIndex - 1) : legIndex;
      const onboardCount = Math.min(N, onboardLastIndex + 1);
      if (onboardCount <= 0) continue;

      const remA = remaining[legIndex];
      const remB = remaining[legIndex + 1];
      const isAgainstFlow =
        (typeof remA === "number" && typeof remB === "number" && remB > remA + 0.05);

      if (!isAgainstFlow) {
        const per = round2(toll / onboardCount);
        for (let i = 0; i < onboardCount; i++) {
          items[i].amountDue = round2(items[i].amountDue + per);
        }
      } else {
        const pickedIndex = onboardCount;
        const idx = (pickedIndex >= 0 && pickedIndex < N) ? pickedIndex : (N - 1);
        items[idx].amountDue = round2(items[idx].amountDue + toll);
      }
    }
  }

  // 4) fechar centavos exatamente
  const sum = round2(items.reduce((s, x) => s + Number(x.amountDue || 0), 0));
  const tollSum = round2((tollByLegEUR || []).reduce((s, x) => s + Number(x || 0), 0));
  const target = round2(Number(baseTotal || 0) + tollSum);

  const diff = round2(target - sum);
  if (diff !== 0) {
    items[items.length - 1].amountDue = round2(items[items.length - 1].amountDue + diff);
  }

  return {
    items: items.map((x) => ({
      contacto: x.contacto,
      nome: x.nome,
      kmInCar: x.kmInCar,
      kmAgainstFlow: x.kmAgainstFlow,
      amountDue: x.amountDue,
    })),
    totalCheck: round2(items.reduce((s, x) => s + x.amountDue, 0)),
    flags: {
      hasAgainstFlow: items.some((x) => (x.kmAgainstFlow || 0) > 0),
    },
  };
}
