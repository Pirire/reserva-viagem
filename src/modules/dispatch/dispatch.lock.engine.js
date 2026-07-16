// dispatch.lock.engine.js

const locks = new Map();

/**
 * LOCK A TRIP FOR A DRIVER
 */
function lockTrip(tripId, driverId, ttlMs = 15000) {
  const now = Date.now();

  const existing = locks.get(tripId);

  if (existing && existing.expiresAt > now) {
    return {
      ok: false,
      reason: "TRIP_ALREADY_LOCKED",
      lock: existing
    };
  }

  const lock = {
    tripId,
    driverId,
    locked: true,
    createdAt: now,
    expiresAt: now + ttlMs
  };

  locks.set(tripId, lock);

  return {
    ok: true,
    lock
  };
}

/**
 * CHECK LOCK
 */
function isTripLocked(tripId) {
  const lock = locks.get(tripId);

  if (!lock) return false;

  if (lock.expiresAt < Date.now()) {
    locks.delete(tripId);
    return false;
  }

  return true;
}

/**
 * RELEASE LOCK
 */
function releaseLock(tripId, driverId = null) {
  const lock = locks.get(tripId);
  if (!lock) return;

  if (driverId && lock.driverId !== driverId) return;

  locks.delete(tripId);
}

/**
 * GET LOCK INFO
 */
function getLock(tripId) {
  const lock = locks.get(tripId);

  if (!lock) return null;

  if (lock.expiresAt < Date.now()) {
    locks.delete(tripId);
    return null;
  }

  return lock;
}

/**
 * CLEAN EXPIRED LOCKS
 */
function cleanupExpiredLocks() {
  const now = Date.now();

  for (const [tripId, lock] of locks.entries()) {
    if (lock.expiresAt < now) {
      locks.delete(tripId);
    }
  }
}

/**
 * AUTO CLEANER LOOP
 */
setInterval(cleanupExpiredLocks, 5000);

/**
 * EXPORT MODULE
 */
module.exports = {
  lockTrip,
  isTripLocked,
  releaseLock,
  getLock,
  cleanupExpiredLocks
};