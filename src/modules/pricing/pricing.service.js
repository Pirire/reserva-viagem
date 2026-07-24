// src/modules/pricing/pricing.service.js
import { calcTollsPortugalFromDirectionsRoute } from "../../services/tolls.pt.js";

/**
 * =========================
 * TABELA OFICIAL DE PREÇOS
 * =========================
 * ⚠️ ALTERA APENAS AQUI
 */
export const PRICING_TABLE = {
  economica: 0.85,
  confort: 1.05,
  executive: 1.35,
  luxury: 1.75,

  grupo: {
    6: 1.20,
    8: 1.35,
    17: 1.60,
  },
};

/**
 * =========================
 * REGRAS GERAIS
 * =========================
 */
const MIN_PRECO_GERAL = 10;
const MIN_PRECO_AEROPORTO = 15;

const ESPERA_GRATIS_MIN = 10;
const ESPERA_PRECO_POR_MIN = 0.8;

// Comissao da plataforma usada no "breakdown" informativo abaixo.
// A fonte de verdade e AdminQuoteConfig.plataformaPercent (25% por
// defeito) — este ficheiro tinha 0.15, o valor antigo, e por isso o
// resumo mostrava uma divisao que nao correspondia ao que o
// motorista recebe. Como esta funcao e sincrona e usada em varios
// sitios, aceita-se um override em contexto.plataformaPercent; quem
// tiver a config a mao deve passa-la.
const PLATAFORMA_PERCENT = 0.25;

/**
 * =========================
 * HELPERS
 * =========================
 */
function isAeroporto(texto = "") {
  const t = texto.toLowerCase();
  return (
    t.includes("aeroporto") ||
    t.includes("airport") ||
    t.includes("humberto") ||
    t.includes("lisbon airport")
  );
}

/**
 * =========================
 * CORE – CÁLCULO DE VIAGEM
 * =========================
 */
export function calculateTripPrice({
  categoria,
  distanciaKm,
  directionsRoute = null,

  // contexto define quem paga e como
  contexto = {
    canal: "publico", // publico | colaborador | partilha
    solicitanteTipo: "cliente", // cliente | hotel | alojamento
    politicaPagamento: "CLIENTE_PAGA", // CLIENTE_PAGA | HOTEL_PAGA | AMBOS
    descontoPercent: 0,
    participantesCount: 1,

    origemTexto: "",
    destinoTexto: "",
    minutosEspera: 0,
  },
}) {
  try {
    if (!categoria || !Number.isFinite(distanciaKm) || distanciaKm <= 0) {
      return { ok: false, message: "categoria ou distanciaKm inválidos" };
    }

    // =========================
    // 1) VALOR POR KM
    // =========================
    // A tabela tem as chaves em minusculas (economica, confort, ...)
    // mas o codigo comparava com "GRUPO" em maiusculas. Resultado:
    // "grupo6" — o valor usado em todo o resto do sistema — nunca
    // batia certo e devolvia "Categoria nao suportada". Normalizamos
    // primeiro e aceitamos grupo6 / GRUPO6 / grupo_6 / grupo 6.
    const catNorm = String(categoria || "").trim().toLowerCase();
    let valorKm = 0;

    const mGrupo = catNorm.match(/^grupo[\s_-]?(\d+)$/);
    if (mGrupo) {
      valorKm = PRICING_TABLE.grupo[Number(mGrupo[1])] || 0;
    } else {
      valorKm = PRICING_TABLE[catNorm] || 0;
    }

    if (!valorKm) {
      return { ok: false, message: "Categoria não suportada" };
    }

    // =========================
    // 2) BASE (KM * TARIFA)
    // =========================
    let base = valorKm * distanciaKm;

    // mínimo
    const min =
      isAeroporto(contexto.origemTexto) ||
      isAeroporto(contexto.destinoTexto)
        ? MIN_PRECO_AEROPORTO
        : MIN_PRECO_GERAL;

    if (base < min) base = min;

    // =========================
    // 3) ESPERA
    // =========================
    const mins = Number(contexto.minutosEspera || 0);
    const extraMins = Math.max(0, mins - ESPERA_GRATIS_MIN);
    const espera = +(extraMins * ESPERA_PRECO_POR_MIN).toFixed(2);

    // =========================
    // 4) PORTAGENS (REAIS)
    // =========================
    let portagens = 0;
    let tolls = [];
    let hasTolls = false;

    if (directionsRoute) {
      // tolls.pt.js devolve { total, tolls, status } — este codigo lia
      // t.tollAmount e t.hasTolls, campos que NAO existem. Ambos saiam
      // undefined, portanto as portagens eram SEMPRE zero, apesar de
      // toda a logica estar escrita e a funcionar. Numa Lisboa-Porto
      // perdiam-se ~5,50 EUR por viagem.
      const t = calcTollsPortugalFromDirectionsRoute(directionsRoute, catNorm);
      portagens = Number(t?.total || 0);
      tolls     = Array.isArray(t?.tolls) ? t.tolls : [];
      hasTolls  = portagens > 0;
    }

    // =========================
    // 5) TOTAL
    // =========================
    const total = +(base + espera + portagens).toFixed(2);

    // =========================
    // 6) SPLIT FINANCEIRO
    // =========================
    const baseServico = +(base + espera).toFixed(2);
    const pct = Number.isFinite(Number(contexto.plataformaPercent))
      ? Number(contexto.plataformaPercent)
      : PLATAFORMA_PERCENT;
    const plataforma = +(baseServico * pct).toFixed(2);
    const motorista = +(baseServico - plataforma).toFixed(2);

    let clientePaga = total;
    let hotelPaga = 0;

    if (contexto.politicaPagamento === "HOTEL_PAGA") {
      clientePaga = 0;
      hotelPaga = total;
    }

    if (contexto.politicaPagamento === "AMBOS") {
      const desconto = +(total * (contexto.descontoPercent / 100)).toFixed(2);
      clientePaga = +(total - desconto).toFixed(2);
      hotelPaga = desconto;
    }

    // =========================
    // RESULTADO FINAL
    // =========================
    return {
      ok: true,

      categoria,
      km: +distanciaKm.toFixed(2),
      valorKm,

      base: +base.toFixed(2),
      espera,
      portagens,
      hasTolls,
      tolls,

      total,

      breakdown: {
        clientePaga,
        hotelPaga,
        plataforma,
        motorista,
      },

      status: hasTolls ? "Inclui portagens" : "Sem portagens",
    };
  } catch (err) {
    console.error("❌ calculateTripPrice:", err);
    return { ok: false, message: "Erro interno no cálculo" };
  }
}

/**
 * =========================
 * EXPOSIÇÃO CONTROLADA
 * =========================
 */
export function getPricingTable() {
  return PRICING_TABLE;
}