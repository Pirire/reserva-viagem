import DispatchSession from "../../models/DispatchSession.js";

export async function getNextOffer(tripId) {
  const session = await DispatchSession.findOne({ tripId });

  if (!session) {
    return { ok: false, reason: "SESSION_NOT_FOUND" };
  }

  if (session.status === "ACCEPTED") {
    return { ok: false, reason: "ALREADY_ACCEPTED" };
  }

  const index = session.currentIndex || 0;

  const candidato = session.candidatos?.[index];

  if (!candidato) {
    await DispatchSession.updateOne(
      { tripId },
      {
        $set: {
          status: "EXPIRED",
          updatedAt: new Date(),
        },
      }
    );

    return { ok: false, reason: "NO_MORE_DRIVERS" };
  }

  return {
    ok: true,
    tripId,
    motorista: candidato,
    index,
  };
}

export async function moveToNextDriver(tripId) {
  return DispatchSession.findOneAndUpdate(
    { tripId },
    {
      $inc: { currentIndex: 1 },
      $set: { updatedAt: new Date() },
    },
    { new: true }
  );
}