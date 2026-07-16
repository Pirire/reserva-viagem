// src/modules/dispatch/dispatch.engine.js

import { lockTrip, releaseLock } from "../dispatch.lock.engine.js";
import { DISPATCH_STATUS } from "./dispatch.status.js";

const activeDispatches = new Map();
const acceptLocks = new Map();
const dispatchEvents = new Map();

/**
 * LOG SYSTEM
 */
function logDispatchEvent(tripId, type, payload = {}) {
  if (!dispatchEvents.has(tripId)) {
    dispatchEvents.set(tripId, []);
  }

  dispatchEvents.get(tripId).push({
    type,
    payload,
    at: Date.now()
  });
}

/**
 * ENGINE
 */
export function dispatchEngine({
  io,
  tripId,
  candidatos = [],
  timeoutMs = 15000
}) {
  if (!candidatos.length) {
    return { ok: false, reason: "NO_DRIVERS" };
  }

  const lock = lockTrip(tripId, "dispatch-engine", timeoutMs + 5000);

  if (!lock.ok) {
    return { ok: false, reason: "TRIP_LOCKED" };
  }

  const state = {
    tripId,
    status: DISPATCH_STATUS.SEARCHING,
    candidatos,
    index: 0,
    accepted: false,
    offerAck: null,
    timer: null
  };

  activeDispatches.set(tripId, state);

  logDispatchEvent(tripId, "SEARCHING");

  tryNext(io, state, timeoutMs);

  return { ok: true, status: state.status };
}

/**
 * TRY NEXT DRIVER
 */
function tryNext(io, state, timeoutMs) {
  if (state.accepted) return;

  if (state.index >= state.candidatos.length) {
    state.status = DISPATCH_STATUS.EXPIRED;

    logDispatchEvent(state.tripId, "EXPIRED");

    activeDispatches.delete(state.tripId);
    releaseLock(state.tripId);

    return;
  }

  const driver = state.candidatos[state.index];

  state.status = DISPATCH_STATUS.OFFERED;
  state.offerAck = null;

  logDispatchEvent(state.tripId, "OFFERED", {
    driverId: driver.motorista.id
  });

  io.to(`driver_${driver.motorista.id}`).emit("trip_offer", {
    tripId: state.tripId,
    motorista: driver.motorista,
    distanciaKm: driver.distanciaKm
  });

  setTimeout(() => {
    if (state.accepted) return;

    const currentDriver = state.candidatos[state.index];

    const hasAck =
      state.offerAck?.driverId === currentDriver?.motorista?.id;

    if (hasAck) {
      state.timer = setTimeout(() => {
        if (state.accepted) return;
        state.index++;
        tryNext(io, state, timeoutMs);
      }, 1500);
      return;
    }

    state.index++;
    tryNext(io, state, timeoutMs);

  }, timeoutMs);
}

/**
 * ACCEPT DISPATCH
 */
export function acceptDispatch({ tripId, driverId }) {
  const state = activeDispatches.get(tripId);
  if (!state) return { ok: false, reason: "NO_DISPATCH" };

  if (acceptLocks.get(tripId)) {
    return { ok: false, reason: "ALREADY_ACCEPTED" };
  }

  acceptLocks.set(tripId, true);

  const current = state.candidatos[state.index];

  if (!current || current.motorista.id !== driverId) {
    acceptLocks.delete(tripId);
    return { ok: false, reason: "INVALID_DRIVER" };
  }

  state.accepted = true;
  state.status = DISPATCH_STATUS.ACCEPTED;

  activeDispatches.delete(tripId);
  releaseLock(tripId, driverId);

  acceptLocks.delete(tripId);

  logDispatchEvent(tripId, "ACCEPTED", { driverId });

  return { ok: true, tripId, driverId };
}

/**
 * ACK OFFER
 */
export function ackDispatchOffer({ tripId, driverId }) {
  const state = activeDispatches.get(tripId);
  if (!state) return { ok: false, reason: "DISPATCH_NOT_FOUND" };

  const current = state.candidatos?.[state.index];

  if (!current || current.motorista.id !== driverId) {
    return { ok: false, reason: "INVALID_DRIVER" };
  }

  state.offerAck = {
    driverId,
    tripId,
    ackedAt: Date.now()
  };

  logDispatchEvent(tripId, "ACKED", { driverId });

  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  return { ok: true, tripId, driverId, status: "ACKED" };
}

/**
 * STATE
 */
export function getDispatchState(tripId) {
  return activeDispatches.get(tripId) || null;
}

/**
 * LOGS
 */
export function getDispatchLogs(tripId) {
  return dispatchEvents.get(tripId) || [];
}