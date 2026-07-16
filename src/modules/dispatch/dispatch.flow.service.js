import DispatchSession from "../../models/DispatchSession.js";
import { DISPATCH_STATUS } from "./dispatch.status.js";

const OFFER_TIMEOUT = 15000;

export async function processNextDriver(io, tripId) {

  const session = await DispatchSession.findOne({ tripId });

  if (!session) {
    return {
      ok: false,
      reason: "SESSION_NOT_FOUND",
    };
  }

  // já aceite
  if (session.status === DISPATCH_STATUS.ACCEPTED) {
    return {
      ok: false,
      reason: "ALREADY_ACCEPTED",
    };
  }

  const candidato = session.candidatos[session.currentIndex];

  // sem mais motoristas
  if (!candidato) {

    session.status = DISPATCH_STATUS.EXPIRED;

    await session.save();

    io.to(`trip_${tripId}`).emit("dispatch_expired", {
      tripId,
    });

    return {
      ok: false,
      reason: "NO_MORE_DRIVERS",
    };
  }

  // actualizar sessão
  session.status = DISPATCH_STATUS.OFFERED;

  session.lockOwner = candidato.motoristaId;

  session.lockedAt = new Date();

  session.expiresAt = new Date(
    Date.now() + OFFER_TIMEOUT
  );

  await session.save();

  // enviar oferta realtime
  io.to(`driver_${candidato.motoristaId}`).emit(
    "trip_offer",
    {
      tripId,
      motoristaId: candidato.motoristaId,
      nome: candidato.nome,
      distanciaKm: candidato.distanciaKm,
      timeout: OFFER_TIMEOUT,
    }
  );

  console.log(
    "📡 Oferta enviada:",
    candidato.motoristaId
  );

  // timeout automático
  setTimeout(async () => {

    const updated = await DispatchSession.findOne({
      tripId,
    });

    if (!updated) return;

    // já aceite
    if (
      updated.status ===
      DISPATCH_STATUS.ACCEPTED
    ) {
      return;
    }

    // mudou driver
    if (
      updated.lockOwner !==
      candidato.motoristaId
    ) {
      return;
    }

    console.log(
      "⌛ Oferta expirada:",
      candidato.motoristaId
    );

    updated.currentIndex += 1;

    updated.status =
      DISPATCH_STATUS.SEARCHING;

    await updated.save();

    // próximo motorista
    await processNextDriver(io, tripId);

  }, OFFER_TIMEOUT);

  return {
    ok: true,
    motorista: candidato,
  };
}