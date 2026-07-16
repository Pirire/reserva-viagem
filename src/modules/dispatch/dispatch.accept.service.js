import DispatchSession from "../../models/DispatchSession.js";

export async function acceptDispatch({ tripId, driverId }) {
  if (!tripId || !driverId) {
    return { ok: false, reason: "MISSING_PARAMS" };
  }

  // 🔒 ATOMIC LOCK (NUNCA DUPLICA ACEITAÇÃO)
  const session = await DispatchSession.findOneAndUpdate(
    {
      tripId,
      status: { $ne: "ACCEPTED" },
      $or: [
        { lockOwner: null },
        { lockOwner: driverId }
      ]
    },
    {
      $set: {
        status: "ACCEPTED",
        acceptedDriverId: driverId,
        lockOwner: driverId,
        lockedAt: new Date(),
        updatedAt: new Date(),
      }
    },
    {
      new: true
    }
  );

  if (!session) {
    return {
      ok: false,
      reason: "ALREADY_TAKEN"
    };
  }

  return {
    ok: true,
    tripId,
    driverId,
    status: "ACCEPTED"
  };
}