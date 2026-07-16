import { haversineKm } from "../utils/geo.js";

function diffMinutes(now, startAt) {
  return Math.floor((startAt.getTime() - now.getTime()) / 60000);
}

export function getRuleByLeadMinutes(leadMinutes) {
  // ordem importa
  if (leadMinutes < 7) {
    return { ok: false, code: "MIN_LEAD", minLeadMinutes: 7 };
  }

  // >= 4h
  if (leadMinutes >= 240) {
    return { ok: true, allowedKm: 50, rule: "LEAD_GTE_4H" };
  }

  // >= 2h
  if (leadMinutes >= 120) {
    return { ok: true, allowedKm: 35, rule: "LEAD_GTE_2H" };
  }

  // < 20 min
  if (leadMinutes < 20) {
    return { ok: true, allowedKm: 20, rule: "LEAD_LT_20M" };
  }

  // default (20m .. <2h)
  return { ok: true, allowedKm: 20, rule: "LEAD_DEFAULT" };
}

export function validateBookingRules({
  origemGeo,
  destinoGeo,
  datahora,
  valor,
  minValue = 15,
}) {
  // geo obrigatório
  if (
    !origemGeo?.lat ||
    !origemGeo?.lng ||
    !destinoGeo?.lat ||
    !destinoGeo?.lng
  ) {
    return {
      ok: false,
      code: "MISSING_GEO",
      message: "Faltam coordenadas (origemGeo/destinoGeo).",
    };
  }

  // data obrigatória
  const startAt = new Date(datahora);
  if (Number.isNaN(startAt.getTime())) {
    return { ok: false, code: "INVALID_DATE", message: "datahora inválida." };
  }

  const now = new Date();

  // não pode ser no passado
  if (startAt.getTime() <= now.getTime()) {
    return {
      ok: false,
      code: "PAST_DATE",
      message: "A data/hora da reserva não pode ser no passado.",
    };
  }

  const leadMinutes = diffMinutes(now, startAt);
  const leadRule = getRuleByLeadMinutes(leadMinutes);

  if (!leadRule.ok) {
    return {
      ok: false,
      code: leadRule.code,
      message: `Reserva não permitida: mínimo de antecedência é ${leadRule.minLeadMinutes} minutos.`,
      meta: { leadMinutes, minLeadMinutes: leadRule.minLeadMinutes },
    };
  }

  // distância origem->destino (aproximação)
  const tripKm = haversineKm(
    { lat: Number(origemGeo.lat), lng: Number(origemGeo.lng) },
    { lat: Number(destinoGeo.lat), lng: Number(destinoGeo.lng) }
  );

  if (tripKm > leadRule.allowedKm) {
    return {
      ok: false,
      code: "OUT_OF_RADIUS",
      message: `Reserva não permitida: para esta antecedência, a distância máxima é ${leadRule.allowedKm} km.`,
      meta: {
        leadMinutes,
        allowedKm: leadRule.allowedKm,
        tripKm: Number(tripKm.toFixed(2)),
        rule: leadRule.rule,
      },
    };
  }

  // valor mínimo
  const v = Number(valor || 0);
  if (v < minValue) {
    return {
      ok: false,
      code: "MIN_VALUE",
      message: `Reserva não permitida: valor mínimo é €${minValue.toFixed(2)}.`,
      meta: { valor: v, minValue },
    };
  }

  return {
    ok: true,
    meta: {
      leadMinutes,
      allowedKm: leadRule.allowedKm,
      tripKm: Number(tripKm.toFixed(2)),
      rule: leadRule.rule,
      valor: v,
    },
  };
}
