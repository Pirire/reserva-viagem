// src/services/verificarProximidadeMotoristas.service.js
// ══════════════════════════════════════════════════════════════
// Corre periodicamente (a cada minuto, via cron em server.js).
// Para cada viagem já atribuída mas ainda não iniciada, calcula —
// via OSRM, a mesma rota real usada em todos os mapas do sistema —
// quanto tempo o motorista demora, a partir de onde está agora, até
// ao ponto de recolha. Quando esse tempo mais uma margem de
// segurança de 20 minutos já bate certo com o tempo que falta até
// à hora marcada, avisa o motorista: "é agora que tem de sair".
//
// O aviso só é enviado UMA VEZ por viagem (marcado na própria Trip),
// para não repetir a cada minuto depois de já ter disparado.
// ══════════════════════════════════════════════════════════════
import mongoose from "mongoose";
import Motorista from "../models/Motorista.js";
import logger from "../config/logger.js";

// Margem de segurança — avisa 20 minutos antes do momento exacto em
// que "sair agora" bateria certo com a hora marcada. Dá tempo ao
// motorista de reagir aos 16 segundos do aviso e ainda sair a horas,
// em vez de o avisar em cima da hora exacta.
const MARGEM_AVISO_MIN = 20;

function viagensCollection() {
  return mongoose.connection.db.collection("viagens");
}

async function calcularEtaMinutos(motoristaLat, motoristaLng, destinoLat, destinoLng) {
  if (motoristaLat == null || motoristaLng == null || destinoLat == null || destinoLng == null) {
    return null;
  }
  try {
    const r = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${motoristaLng},${motoristaLat};${destinoLng},${destinoLat}?overview=false`
    );
    const d = await r.json();
    if (d?.routes?.[0]?.duration != null) {
      return Math.max(1, Math.round(d.routes[0].duration / 60));
    }
  } catch (err) {
    logger.warn({ err: err?.message }, "⚠️ verificarProximidadeMotoristas: OSRM falhou");
  }
  return null;
}

export async function verificarProximidadeMotoristas(io) {
  if (!io) return;

  const col = viagensCollection();

  // Candidatas: já atribuídas a um motorista, ainda não iniciadas,
  // com hora marcada, e ainda sem aviso enviado.
  const viagens = await col.find({
    status: "assigned",
    "driver.driverId": { $ne: null },
    avisoRecolhaEnviadoEm: { $exists: false },
    $or: [{ when: { $ne: null } }, { datahora: { $ne: null } }],
  }).toArray();

  if (!viagens.length) return;

  for (const viagem of viagens) {
    try {
      const horaMarcada = viagem.when || viagem.datahora;
      if (!horaMarcada) continue;

      const driverId = viagem.driver?.driverId;
      if (!driverId) continue;

      const motorista = await Motorista.findById(driverId).select("lat lng nome").lean();
      if (!motorista || motorista.lat == null || motorista.lng == null) continue;

      const pickupLat = viagem.origemGeo?.lat ?? viagem.lat;
      const pickupLng = viagem.origemGeo?.lng ?? viagem.lng;
      if (pickupLat == null || pickupLng == null) continue;

      const etaMin = await calcularEtaMinutos(motorista.lat, motorista.lng, pickupLat, pickupLng);
      if (etaMin == null) continue;

      const minutosRestantes = Math.round((new Date(horaMarcada).getTime() - Date.now()) / 60000);

      // "É hora de partir" quando o tempo de viagem + a margem de
      // segurança já bate certo (ou ultrapassa) o tempo que falta.
      if (etaMin + MARGEM_AVISO_MIN >= minutosRestantes) {
        await col.updateOne(
          { _id: viagem._id },
          { $set: { avisoRecolhaEnviadoEm: new Date() } }
        );

        io.to(`driver_${driverId}`).emit("hora_de_partir", {
          tripId: String(viagem._id),
          viagem: {
            partida: viagem.partida || viagem.origem || "—",
            destino: viagem.destino || "—",
            categoria: viagem.categoria || "—",
            datahora: horaMarcada,
            valor: viagem.valor || null,
            origemGeo: viagem.origemGeo || null,
            destinoGeo: viagem.destinoGeo || null,
          },
        });

        logger.info(
          { tripId: String(viagem._id), driverId: String(driverId), etaMin, minutosRestantes },
          "🔔 Aviso 'hora de partir' enviado"
        );
      }
    } catch (err) {
      logger.error({ err, tripId: String(viagem._id) }, "❌ verificarProximidadeMotoristas: erro numa viagem");
      // continua para as restantes viagens, não deixa uma falha parar o ciclo todo
    }
  }
}
