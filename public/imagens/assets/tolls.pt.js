// src/services/tolls.pt.js
/**
 * BACKEND B — PORTAGENS PORTUGAL (TABELA NACIONAL)
 * Estilo Uber:
 * - Só cobra se a rota passar
 * - Deteta por keywords no Google Directions (route + steps)
 * - Fácil de expandir
 */

export const TOLLS_PT = [
  // ================= LISBOA =================
  {
    id: "ponte_25_abril",
    name: "Ponte 25 de Abril",
    amountEUR: 2.10,
    keywords: ["25 de abril", "ponte 25", "a2"],
  },
  {
    id: "ponte_vasco_gama",
    name: "Ponte Vasco da Gama",
    amountEUR: 3.25,
    keywords: ["vasco da gama", "ponte vasco", "a12"],
  },

  // ================= A5 =================
  {
    id: "a5_porto_salvo",
    name: "A5 Porto Salvo / Oeiras",
    amountEUR: 1.55,
    keywords: ["a5", "porto salvo", "oeiras"],
  },
  {
    id: "a5_carcavelos",
    name: "A5 Carcavelos",
    amountEUR: 1.40,
    keywords: ["a5", "carcavelos"],
  },

  // ================= A16 =================
  {
    id: "a16_mafra",
    name: "A16 Mafra",
    amountEUR: 1.20,
    keywords: ["a16", "mafra"],
  },
  {
    id: "a16_ericeira",
    name: "A16 Ericeira",
    amountEUR: 1.30,
    keywords: ["a16", "ericeira"],
  },

  // ================= A1 =================
  {
    id: "a1_coimbra",
    name: "A1 Coimbra",
    amountEUR: 2.85,
    keywords: ["a1", "coimbra"],
  },
  {
    id: "a1_fatima",
    name: "A1 Fátima",
    amountEUR: 2.40,
    keywords: ["a1", "fátima", "fatima"],
  },
  {
    id: "a1_pombal",
    name: "A1 Pombal",
    amountEUR: 2.20,
    keywords: ["a1", "pombal"],
  },
  {
    id: "a1_porto",
    name: "A1 Porto",
    amountEUR: 4.60,
    keywords: ["a1", "porto"],
  },

  // ================= A2 / ALGARVE =================
  {
    id: "a2_algarve",
    name: "A2 Algarve",
    amountEUR: 8.95,
    keywords: ["a2", "algarve", "faro", "albufeira", "portimão"],
  },

  // ================= SETÚBAL =================
  {
    id: "a2_setubal",
    name: "A2 Setúbal",
    amountEUR: 2.30,
    keywords: ["a2", "setúbal", "setubal"],
  },
  {
    id: "a12_setubal",
    name: "A12 Setúbal",
    amountEUR: 3.25,
    keywords: ["a12", "setúbal", "setubal"],
  },
  {
    id: "a33_setubal",
    name: "A33 Setúbal / Seixal",
    amountEUR: 1.90,
    keywords: ["a33", "seixal", "barreiro", "montijo", "setúbal", "setubal"],
  },
];

/* =================================================
   IMPLEMENTAÇÃO (não mexer)
   ================================================= */

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractRouteText(route) {
  const parts = [];

  if (route?.summary) parts.push(route.summary);
  if (Array.isArray(route?.warnings)) parts.push(route.warnings.join(" "));

  const legs = route?.legs || [];
  for (const leg of legs) {
    for (const step of leg.steps || []) {
      if (step.html_instructions) parts.push(stripHtml(step.html_instructions));
      if (step.instructions) parts.push(stripHtml(step.instructions)); // se vier texto normal
      if (step.road_name) parts.push(String(step.road_name));
    }
  }

  return parts.join(" ").toLowerCase();
}

/**
 * Recebe UM "route" do Google Directions (routes[0])
 * e devolve:
 * - hasTolls: boolean
 * - tollAmount: number
 * - tolls: lista de portagens identificadas
 */
export function calcTollsPortugalFromDirectionsRoute(route) {
  const text = extractRouteText(route);

  const matched = [];
  let total = 0;

  for (const toll of TOLLS_PT) {
    const hit = toll.keywords.some((k) => text.includes(String(k).toLowerCase()));
    if (hit) {
      matched.push({
        id: toll.id,
        name: toll.name,
        amountEUR: toll.amountEUR,
      });
      total += Number(toll.amountEUR || 0);
    }
  }

  total = Number(total.toFixed(2));

  return {
    hasTolls: matched.length > 0,
    tollAmount: total,
    tolls: matched,
  };
}

export function listTollsPortugal() {
  return TOLLS_PT.map((t) => ({
    id: t.id,
    name: t.name,
    amountEUR: t.amountEUR,
  }));
}
