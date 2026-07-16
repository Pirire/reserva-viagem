// src/services/regiaoSeguranca.service.js
// ══════════════════════════════════════════════════════════════
// Serviço de activação/desactivação automática da segurança
// por região, baseado nos gestores de frota aprovados.
//
// Regra:
//   - Gestor de frota aprovado num concelho → segurança activa
//   - Nenhum gestor de frota aprovado → segurança inactiva
//   - Activação automática quando admin aprova um colaborador tipo "frota"
// ══════════════════════════════════════════════════════════════

import Colaborador from "../models/colaboradores.js";
import logger      from "../config/logger.js";

// ── Cache em memória das regiões activas ──────────────────────
// { "lisboa": { activa: true, gestores: 3, activadaEm: Date } }
const regioesCacheMap = new Map();
let _lastRefresh = 0;
const CACHE_TTL = 60 * 1000; // 1 minuto

/**
 * Carrega (ou refresca) todas as regiões com frota aprovada.
 */
export async function refreshRegioes() {
  try {
    const gestores = await Colaborador.find({
      tipo:    "frota",
      aprovado: true,
    }).select("concelho cidade nome email").lean();

    // Agrupar por concelho
    const porConcelho = {};
    for (const g of gestores) {
      const key = String(g.concelho || g.cidade || "").trim().toLowerCase();
      if (!key) continue;
      if (!porConcelho[key]) porConcelho[key] = [];
      porConcelho[key].push(g);
    }

    // Actualizar cache
    regioesCacheMap.clear();
    for (const [concelho, lista] of Object.entries(porConcelho)) {
      regioesCacheMap.set(concelho, {
        activa:     true,
        concelho,
        gestores:   lista.length,
        activadaEm: new Date(),
      });
    }

    _lastRefresh = Date.now();
    logger.info(
      { regioes: [...regioesCacheMap.keys()] },
      `🗺️ Regiões de segurança activas: ${regioesCacheMap.size}`
    );
    return [...regioesCacheMap.values()];
  } catch (err) {
    logger.error({ err }, "❌ Erro ao carregar regiões de segurança");
    return [];
  }
}

/**
 * Verifica se a segurança está activa para um concelho.
 * Refresca o cache se expirado.
 */
export async function isSegurancaActiva(concelho) {
  if (!concelho) return false;
  if (Date.now() - _lastRefresh > CACHE_TTL) await refreshRegioes();
  const key = String(concelho).trim().toLowerCase();
  return regioesCacheMap.has(key);
}

/**
 * Lista todas as regiões com segurança activa.
 */
export async function getRegioesActivas() {
  if (Date.now() - _lastRefresh > CACHE_TTL) await refreshRegioes();
  return [...regioesCacheMap.values()];
}

/**
 * Activar segurança para um concelho específico (chamado quando
 * um gestor de frota é aprovado pelo admin).
 */
export function activarRegiao(concelho, info = {}) {
  const key = String(concelho || "").trim().toLowerCase();
  if (!key) return;
  const jaActiva = regioesCacheMap.has(key);
  regioesCacheMap.set(key, {
    activa:     true,
    concelho:   key,
    gestores:   (regioesCacheMap.get(key)?.gestores || 0) + 1,
    activadaEm: new Date(),
    ...info,
  });
  if (!jaActiva) {
    logger.info({ concelho: key }, "🛡️ Segurança ACTIVADA para região");
  }
}

/**
 * Desactivar segurança para um concelho (ex: último gestor removido).
 */
export async function desactivarRegiao(concelho) {
  const key = String(concelho || "").trim().toLowerCase();
  // Confirmar que não há mais gestores aprovados antes de desactivar
  const count = await Colaborador.countDocuments({
    tipo: "frota", aprovado: true,
    $or: [{ concelho: key }, { cidade: key }],
  });
  if (count === 0) {
    regioesCacheMap.delete(key);
    logger.warn({ concelho: key }, "🛡️ Segurança DESACTIVADA — sem gestores na região");
  }
}