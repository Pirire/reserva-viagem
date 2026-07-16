// src/services/motoristaDisponibilidade.service.js
// ══════════════════════════════════════════════════════════════
// Verifica se um motorista tem conflito de agenda num intervalo.
//
// CORRECÇÃO: o campo canónico é "driver.driverId" (não
// "driver.motoristaId" como estava antes — nunca encontrava
// conflitos reais).
// ══════════════════════════════════════════════════════════════

import Trip from "../models/Trip.js";

/**
 * Verifica se o motorista está disponível no horário pedido.
 *
 * @param {string|ObjectId} motoristaId
 * @param {Date}   inicio
 * @param {Date}   fim
 * @param {number} bufferMin  — margem de segurança em minutos (default 15)
 * @param {string} [excludeTripId] — tripId a ignorar (útil em re-atribuições)
 *
 * @returns {{ ok: boolean, conflito: object|null }}
 */
export async function verificarDisponibilidadeMotorista(
  motoristaId,
  inicio,
  fim,
  bufferMin = 15,
  excludeTripId = null
) {
  try {
    if (!motoristaId) return { ok: false, conflito: null };

    const bufferMs     = bufferMin * 60 * 1000;
    const inicioBuffer = new Date(new Date(inicio).getTime() - bufferMs);
    const fimBuffer    = new Date(new Date(fim).getTime()    + bufferMs);

    const query = {
      "driver.driverId": motoristaId,

      status: { $in: ["assigned", "in_progress"] },

      // Intervalo com buffer — detecta sobreposição parcial ou total
      "driver.inicioPrevisto": { $lt: fimBuffer    },
      "driver.fimPrevisto":    { $gt: inicioBuffer },
    };

    // Excluir a própria viagem em caso de re-atribuição
    if (excludeTripId) {
      query.tripId = { $ne: excludeTripId };
    }

    const conflito = await Trip.findOne(query)
      .select("_id tripId driver.inicioPrevisto driver.fimPrevisto status")
      .lean();

    if (conflito) return { ok: false, conflito };

    return { ok: true, conflito: null };

  } catch (err) {
    console.error("❌ verificarDisponibilidadeMotorista:", err?.message || err);
    // Em caso de erro de BD, bloqueia por segurança
    return { ok: false, conflito: null };
  }
}