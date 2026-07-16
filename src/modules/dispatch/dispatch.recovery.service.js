import DispatchSession from "../../models/DispatchSession.js";

export async function recoverDispatch({ tripId, reason }) {
  if (!tripId) {
    return { ok: false, reason: "MISSING_TRIP_ID" };
  }

  const session = await DispatchSession.findOne({ tripId });

  if (!session) {
    return { ok: false, reason: "SESSION_NOT_FOUND" };
  }

  // 🔒 se já foi aceite → nunca mexer
  if (session.status === "ACCEPTED") {
    return { ok: true, reason: "ALREADY_ACCEPTED" };
  }

  const currentIndex = session.currentIndex || 0;
  const nextIndex = currentIndex + 1;

  const nextDriver = session.candidatos?.[nextIndex];

  // 🔒 validação de lock (evita race com offer engine)
  const isLockedBySameDriver =
    session.lockOwner &&
    session.lockOwner === session.candidatos?.[currentIndex]?.motoristaId;

  // ⛔ se não está consistente, não avança
  if (!isLockedBySameDriver && session.status === "OFFERED") {
    return {
      ok: false,
      reason: "LOCK_MISMATCH",
    };
  }

  // 🔁 NEXT DRIVER EXISTE
  if (nextDriver) {
    await DispatchSession.updateOne(
      { tripId },
      {
        $set: {
          currentIndex: nextIndex,
          lockOwner: null,
          lockedAt: null,
          status: "SEARCHING",
          updatedAt: new Date(),
        },
      }
    );

    return {
      ok: true,
      action: "NEXT_DRIVER",
      nextIndex,
      reason,
    };
  }

  // 🧠 SEM MOTORISTAS → PAINEL ADMIN
  await DispatchSession.updateOne(
    { tripId },
    {
      $set: {
        status: "WAITING_ADMIN",
        lockOwner: null,
        lockedAt: null,
        updatedAt: new Date(),
      },
    }
  );

  return {
    ok: true,
    action: "ADMIN_REQUIRED",
    reason,
  };
}