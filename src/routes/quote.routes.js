// src/routes/quote.routes.js
//
// Cálculo de orçamento — fonte única de verdade para preços por km.
//
// ARQUITECTURA DE DADOS:
//   KmConfig          → preço por km por categoria (escrito pelo admin via PUT /admin/kms)
//   AdminQuoteConfig  → configuração operacional: mínimos, espera, portagens,
//                       hora de ponta, procura, taxas (escrito via PUT /admin/quote-config)
//
// BUG ANTERIOR: getConfig() lia precoKm de AdminQuoteConfig, que nunca era
// actualizado pelo painel de KMS do admin (que escreve em KmConfig). Os dois
// modelos nunca comunicavam, pelo que qualquer alteração de €/km no admin era
// completamente ignorada no cálculo.
//
// CORRECÇÃO: getConfig() passa a ler KmConfig para os preços por km e
// AdminQuoteConfig para tudo o resto. Os grupos (6/8/17) também passam a ser
// dinâmicos via KmConfig — os valores deixam de estar hardcoded.

import { Router }       from "express";
import KmConfig         from "../models/KmConfig.js";
import AdminQuoteConfig from "../models/AdminQuoteConfig.js";
import { calcTollsPortugalFromDirectionsRoute } from "../services/tolls.pt.js";

const router = Router();

/* ================================================================
   FALLBACKS
   Usados apenas se a BD não tiver registos. Em produção normal
   os valores vêm sempre da base de dados.
================================================================ */

/** Preços fallback por categoria — espelham os defaults do KmConfig */
const FALLBACK_KM = {
  economica: 0.85,
  confort:   1.05,
  executive: 1.35,
  luxury:    1.75,
  grupo6:    1.20,
  grupo8:    1.35,
  grupo17:   1.60,
};

/** Configuração operacional fallback — espelha os defaults do AdminQuoteConfig */
const FALLBACK_CFG = {
  minimos:           { aeroporto: 15,   normal: 10 },
  espera:            { minutosGratis: 10, valorPorMinExtra: 0.8 },
  portagem:          { valorFixo: 2.1 },
  transito:          { fatorMax: 1.3 },
  horaPonta:         { fator: 1.1, manhaInicio: 7, manhaFim: 10, tardeInicio: 17, tardeFim: 20 },
  procura:           { incrementoPorExcesso: 0.15, fatorMax: 1.5 },
  plataformaPercent: 0.15,
  descontoColaboradorPercent: 0,
  // Zonas especiais — locais (estádios, arenas, aeroporto fora de
  // horas) onde o preço sobe, por palavras-chave no texto de
  // origem/destino. "horaInicio"/"horaFim" opcionais: null = aplica
  // sempre; preenchidos = só dentro dessa janela horária (ex:
  // aeroporto de madrugada). Configurável via admin, para não
  // precisar de alterar código sempre que houver um evento novo.
  zonasEspeciais: [
    { nome: "Estádio da Luz",      palavrasChave: ["estádio da luz", "estadio da luz", "sl benfica"], fator: 1.30, horaInicio: null, horaFim: null },
    { nome: "Estádio de Alvalade", palavrasChave: ["estádio de alvalade", "estadio de alvalade", "sporting cp", "josé alvalade"], fator: 1.30, horaInicio: null, horaFim: null },
    { nome: "Altice Arena / MEO Arena", palavrasChave: ["altice arena", "meo arena"], fator: 1.30, horaInicio: null, horaFim: null },
    { nome: "Rock in Rio Lisboa",  palavrasChave: ["rock in rio", "parque da bela vista"], fator: 1.35, horaInicio: null, horaFim: null },
    { nome: "Aeroporto — madrugada", palavrasChave: ["aeroporto", "airport", "humberto delgado"], fator: 1.25, horaInicio: 0, horaFim: 6 },
  ],
};

/* ================================================================
   getConfig()
   Carrega a configuração completa de forma paralela:
     – KmConfig           → tabela de €/km (fonte: admin KMS)
     – AdminQuoteConfig   → restantes parâmetros operacionais
================================================================ */
async function getConfig() {
  // Executar as duas consultas em paralelo para minimizar latência
  const [kmDocs, opCfg] = await Promise.all([
    KmConfig.find({ ativo: true }).lean().catch(() => []),
    AdminQuoteConfig.findOne({ key: "default" }).lean().catch(() => null),
  ]);

  // ── Preços por km ─────────────────────────────────────────────
  // KmConfig guarda os preços com a chave normalizada para minúsculas
  // (ex: "economica", "confort", "executive", "luxury", "grupo6", ...)
  // Construímos um mapa { chave → valorPorKm } e fundimos com o fallback
  // para garantir que categorias ainda não configuradas têm um valor seguro.
  const kmMap = { ...FALLBACK_KM };
  for (const doc of kmDocs) {
    const key = String(doc.key || "").toLowerCase().trim();
    if (key && typeof doc.valorPorKm === "number" && doc.valorPorKm >= 0) {
      kmMap[key] = doc.valorPorKm;
    }
  }

  // ── Configuração operacional ───────────────────────────────────
  const op = opCfg || {};

  return {
    precoKm: kmMap,   // { economica, confort, executive, luxury, grupo6, grupo8, grupo17, ... }

    minimos: {
      aeroporto: Number(op.minimos?.aeroporto ?? FALLBACK_CFG.minimos.aeroporto),
      normal:    Number(op.minimos?.normal    ?? FALLBACK_CFG.minimos.normal),
    },
    espera: {
      minutosGratis:    Number(op.espera?.minutosGratis    ?? FALLBACK_CFG.espera.minutosGratis),
      valorPorMinExtra: Number(op.espera?.valorPorMinExtra ?? FALLBACK_CFG.espera.valorPorMinExtra),
    },
    portagem: {
      valorFixo: Number(op.portagem?.valorFixo ?? FALLBACK_CFG.portagem.valorFixo),
    },
    transito: {
      fatorMax: Number(op.transito?.fatorMax ?? FALLBACK_CFG.transito.fatorMax),
    },
    horaPonta: {
      fator:       Number(op.horaPonta?.fator       ?? FALLBACK_CFG.horaPonta.fator),
      manhaInicio: Number(op.horaPonta?.manhaInicio ?? FALLBACK_CFG.horaPonta.manhaInicio),
      manhaFim:    Number(op.horaPonta?.manhaFim    ?? FALLBACK_CFG.horaPonta.manhaFim),
      tardeInicio: Number(op.horaPonta?.tardeInicio ?? FALLBACK_CFG.horaPonta.tardeInicio),
      tardeFim:    Number(op.horaPonta?.tardeFim    ?? FALLBACK_CFG.horaPonta.tardeFim),
    },
    procura: {
      incrementoPorExcesso: Number(op.procura?.incrementoPorExcesso ?? FALLBACK_CFG.procura.incrementoPorExcesso),
      fatorMax:             Number(op.procura?.fatorMax             ?? FALLBACK_CFG.procura.fatorMax),
    },
    plataformaPercent: typeof op.plataformaPercent === "number"
      ? op.plataformaPercent
      : FALLBACK_CFG.plataformaPercent,
    descontoColaboradorPercent: typeof op.descontoColaboradorPercent === "number"
      ? op.descontoColaboradorPercent
      : FALLBACK_CFG.descontoColaboradorPercent,
    // Se o admin ainda não personalizou nada (campo em falta na BD),
    // usa a lista por defeito acima — não fica vazio "à espera" de
    // alguém configurar antes disto começar a funcionar.
    zonasEspeciais: Array.isArray(op.zonasEspeciais) && op.zonasEspeciais.length
      ? op.zonasEspeciais
      : FALLBACK_CFG.zonasEspeciais,
  };
}

/* ================================================================
   HELPERS DE CÁLCULO
================================================================ */

function isAeroporto(txt = "") {
  const t = String(txt).toLowerCase();
  return (
    t.includes("aeroporto") ||
    t.includes("airport")   ||
    t.includes("humberto delgado")
  );
}

/**
 * Verifica se a origem OU o destino batem com alguma zona especial
 * configurada, e se a hora da viagem (quando a zona tiver janela
 * horária definida) está dentro dessa janela. Devolve a zona com o
 * MAIOR fator entre as que corresponderem — se por acaso mais do
 * que uma bater certo, fica só o recargo mais alto, nunca somados
 * (evita um preço a disparar por acumular vários recargos ao mesmo
 * tempo).
 */
function detectarZonaEspecial(origemTexto = "", destinoTexto = "", dataHora, zonas = []) {
  const origemLower  = String(origemTexto  || "").toLowerCase();
  const destinoLower = String(destinoTexto || "").toLowerCase();
  const hora = dataHora ? new Date(dataHora).getHours() : null;

  let melhorZona = null;

  for (const zona of zonas) {
    const bate = (zona.palavrasChave || []).some(
      (p) => origemLower.includes(p) || destinoLower.includes(p)
    );
    if (!bate) continue;

    // Zona com janela horária definida, mas sem hora da viagem
    // disponível para verificar — não aplica (mais seguro assumir
    // preço normal do que arriscar cobrar a mais sem confirmar).
    if (zona.horaInicio != null && zona.horaFim != null) {
      if (hora == null) continue;
      const dentroDaJanela = zona.horaInicio <= zona.horaFim
        ? (hora >= zona.horaInicio && hora < zona.horaFim)
        : (hora >= zona.horaInicio || hora < zona.horaFim); // janela que atravessa a meia-noite
      if (!dentroDaJanela) continue;
    }

    if (!melhorZona || zona.fator > melhorZona.fator) melhorZona = zona;
  }

  return melhorZona;
}

/**
 * Resolve o €/km para uma categoria.
 * Aceita qualquer chave que exista em cfg.precoKm.
 * Para grupos aceita tanto "grupo6" como "grupo_6" como "grupo 6".
 */
function resolveValorKm(categoria, precoKm) {
  const raw = String(categoria || "").trim().toLowerCase();

  // Normalizar variantes de grupo: "grupo_6", "grupo 6" → "grupo6"
  const cat = raw.replace(/grupo[_\s]?(\d+)/, "grupo$1");

  const valor = precoKm[cat];
  if (typeof valor === "number" && valor > 0) return { cat, valorKm: valor };

  return { cat, valorKm: 0 };
}

/**
 * Função de cálculo pura — não acede à BD.
 * Recebe cfg já carregada e devolve o breakdown completo.
 */
function calcularPreco({ categoria, distanciaKm, directionsRoute, contexto, cfg }) {
  const { cat, valorKm } = resolveValorKm(categoria, cfg.precoKm);

  if (!valorKm) {
    return {
      ok: false,
      message: `Categoria não suportada ou sem preço configurado: "${categoria}". `
             + `Configure o valor em /admin → KMS.`,
    };
  }

  // ── Base ──────────────────────────────────────────────────────
  let base = +(valorKm * distanciaKm).toFixed(4);

  const origemAeroporto  = isAeroporto(contexto?.origemTexto);
  const destinoAeroporto = isAeroporto(contexto?.destinoTexto);
  const minimo = (origemAeroporto || destinoAeroporto)
    ? cfg.minimos.aeroporto
    : cfg.minimos.normal;

  if (base < minimo) base = minimo;

  // ── Zona especial (estádios, arenas, eventos, aeroporto fora de
  // horas) ──────────────────────────────────────────────────────
  // Aplicado DEPOIS do mínimo — o recargo multiplica o valor real
  // da viagem, já com o piso aplicado, não o ignora.
  const zonaEspecial = detectarZonaEspecial(
    contexto?.origemTexto, contexto?.destinoTexto, contexto?.datahora, cfg.zonasEspeciais
  );
  if (zonaEspecial) {
    base = +(base * zonaEspecial.fator).toFixed(2);
  }

  // ── Espera ────────────────────────────────────────────────────
  const minutosEspera = Number(contexto?.minutosEspera || 0);
  const minutosExtra  = Math.max(0, minutosEspera - cfg.espera.minutosGratis);
  const espera        = +(minutosExtra * cfg.espera.valorPorMinExtra).toFixed(2);

  // ── Portagens ─────────────────────────────────────────────────
  let portagens = 0;
  let tolls     = [];
  let hasTolls  = false;

  if (directionsRoute) {
    try {
      const t  = calcTollsPortugalFromDirectionsRoute(directionsRoute);
      hasTolls  = Boolean(t?.hasTolls);
      portagens = +(Number(t?.tollAmount || 0)).toFixed(2);
      tolls     = t?.tolls || [];
    } catch (err) {
      console.warn("[quote] Erro ao calcular portagens:", err.message);
    }
  }

  // ── Total ─────────────────────────────────────────────────────
  const total = +(base + espera + portagens).toFixed(2);
  base        = +base.toFixed(2);

  // ── Split financeiro ──────────────────────────────────────────
  const taxaPlataforma = cfg.plataformaPercent;
  const plataforma     = +(base * taxaPlataforma).toFixed(2);
  const motorista      = +(base - plataforma).toFixed(2);

  return {
    ok:        true,
    categoria: cat,
    km:        +distanciaKm.toFixed(2),
    valorKm,
    base,
    baseTotal: base,
    espera,
    portagens,
    hasTolls,
    tolls,
    total,
    breakdown: { plataforma, motorista, taxaPlataforma },
    taxaPlataforma,
    isAeroporto: origemAeroporto || destinoAeroporto,
    zonaEspecial: zonaEspecial ? { nome: zonaEspecial.nome, fator: zonaEspecial.fator } : null,
    status: [
      zonaEspecial ? `Recargo de zona: ${zonaEspecial.nome}` : null,
      hasTolls ? "Inclui portagens" : null,
    ].filter(Boolean).join(" · ") || "Sem recargos",
  };
}

/* ================================================================
   POST /api/quotes/quote
   Calcula orçamento para uma categoria e distância.

   Body:
     categoria     {string}  — "economica" | "confort" | "executive" |
                               "luxury" | "grupo6" | "grupo8" | "grupo17"
     distanciaKm   {number}  — distância em km
     directionsRoute {object} — (opcional) rota do Google Maps para portagens reais
     contexto      {object}  — (opcional) { origemTexto, destinoTexto, minutosEspera, datahora }
                               datahora (ISO) é necessária para zonas com
                               janela horária (ex: aeroporto de madrugada) —
                               sem ela, essas zonas específicas não aplicam
                               recargo (zonas sem janela, como estádios,
                               aplicam sempre, com ou sem datahora).
================================================================ */
router.post("/quote", async (req, res) => {
  try {
    const { categoria, distanciaKm, directionsRoute, contexto } = req.body || {};

    if (!categoria || distanciaKm == null) {
      return res.status(400).json({
        ok:      false,
        message: "Campos obrigatórios em falta: categoria, distanciaKm.",
      });
    }

    const km = Number(distanciaKm);
    if (!Number.isFinite(km) || km <= 0) {
      return res.status(400).json({
        ok:      false,
        message: "distanciaKm deve ser um número positivo.",
      });
    }

    const cfg    = await getConfig();
    const result = calcularPreco({
      categoria,
      distanciaKm:     km,
      directionsRoute: directionsRoute || null,
      contexto:        contexto        || {},
      cfg,
    });

    if (!result.ok) {
      return res.status(400).json({ ok: false, message: result.message });
    }

    return res.json(result);

  } catch (err) {
    console.error("❌ POST /quotes/quote:", err);
    return res.status(500).json({ ok: false, message: "Erro interno ao calcular orçamento." });
  }
});

/* ================================================================
   GET /api/quotes/tabela
   Devolve a tabela de preços activa e a configuração operacional.
   Útil para debug e para o painel admin verificar os valores em vigor.
================================================================ */
router.get("/tabela", async (_req, res) => {
  try {
    const cfg = await getConfig();
    return res.json({
      ok:     true,
      tabela: cfg.precoKm,
      config: cfg,
    });
  } catch (err) {
    console.error("❌ GET /quotes/tabela:", err);
    return res.status(500).json({ ok: false, message: "Erro ao obter tabela de preços." });
  }
});

// Exportados para reutilização noutras rotas (ex: partilha.routes.js,
// para o cálculo do valor por convidado usar exactamente a mesma
// lógica/preços configurados pelo admin — nunca duplicar a tabela
// de preços nem a fórmula de cálculo em mais do que um sítio.
export { getConfig, calcularPreco };

export default router;