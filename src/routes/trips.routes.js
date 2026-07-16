// src/routes/trips.routes.js
import { Router } from "express";
import Trip from "../models/Trip.js";
import Motorista from "../models/Motorista.js";

const router = Router();

console.log("✅ trips.routes.js carregado");

// ping
router.get("/trips/ping", (req, res) => {
  res.json({ ok: true, where: "trips.routes.js" });
});

// =====================================================
// Helpers
// =====================================================
function toDate(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addMinutes(date, min) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() + Number(min || 0));
  return d;
}

// conflito: existe outra viagem do mesmo motorista que cruza horário?
async function hasConflict({ motoristaId, inicio, fim, ignoreTripId = null }) {
  const base = {
    "driver.driverId": motoristaId,
    status: { $nin: ["cancelled"] }, // cancelada não conta
    "driver.inicioPrevisto": { $lt: fim },
    "driver.fimPrevisto": { $gt: inicio },
  };

  if (ignoreTripId) base.tripId = { $ne: ignoreTripId };

  const exists = await Trip.findOne(base).select("tripId driver").lean();
  return exists || null;
}

// =====================================================
// ✅ 1) Criar viagem (para teste rápido)
// POST /api/trips/create-test
// body: { tripId:"RM-0001", pickup:"A", dropoff:"B", when:"2026-02-16T16:00:00.000Z" }
// =====================================================
router.post("/trips/create-test", async (req, res) => {
  try {
    const tripId = String(req.body?.tripId || "").trim();
    const pickup = String(req.body?.pickup || "").trim();
    const dropoff = String(req.body?.dropoff || "").trim();
    const when = toDate(req.body?.when);

    if (!tripId || !pickup || !dropoff || !when) {
      return res.status(400).json({ ok: false, message: "Campos obrigatórios: tripId, pickup, dropoff, when" });
    }

    const exists = await Trip.findOne({ tripId }).lean();
    if (exists) {
      return res.status(409).json({ ok: false, message: "tripId já existe", tripId });
    }

    const doc = await Trip.create({
      tripId,
      canal: "publico",
      subcanal: "normal",
      pickup,
      dropoff,
      when,
      quote: {
        categoria: "ECONOMICA",
        km: 1,
        valorKm: 1,
        baseTotal: 1,
        total: 1,
        currency: "EUR",
      },
      paymentPlan: { payerType: "single", customerDue: 1, hotelDue: 0, items: [] },
      status: "paid",
      paymentStatus: "paid",
    });

    return res.json({ ok: true, trip: { tripId: doc.tripId, id: String(doc._id) } });
  } catch (e) {
    console.error("❌ create-test:", e);
    return res.status(500).json({ ok: false, message: "Erro ao criar viagem" });
  }
});

// =====================================================
// ✅ 2) Ver disponibilidade do motorista
// POST /api/trips/check-availability
// body: { motoristaId, inicio, duracaoMin }
// =====================================================
router.post("/trips/check-availability", async (req, res) => {
  try {
    const motoristaId = String(req.body?.motoristaId || "").trim();
    const inicio = toDate(req.body?.inicio);
    const duracaoMin = Number(req.body?.duracaoMin || 0);

    if (!motoristaId || !inicio || !duracaoMin) {
      return res.status(400).json({ ok: false, message: "Campos obrigatórios: motoristaId, inicio, duracaoMin" });
    }

    const fim = addMinutes(inicio, duracaoMin);

    const conflict = await hasConflict({
      motoristaId,
      inicio,
      fim,
      ignoreTripId: null,
    });

    if (conflict) {
      return res.status(409).json({
        ok: false,
        available: false,
        message: "Conflito: motorista já tem viagem neste horário",
        conflictTripId: conflict.tripId,
        conflito: conflict.driver,
      });
    }

    return res.json({ ok: true, available: true });
  } catch (e) {
    console.error("❌ check-availability:", e);
    return res.status(500).json({ ok: false, message: "Erro ao verificar disponibilidade" });
  }
});

// =====================================================
// ✅ 3) Atribuir motorista a uma viagem (com anti-conflito)
// POST /api/trips/:tripId/assign-driver
// body: { motoristaId, inicio, duracaoMin }
// =====================================================
router.post("/trips/:tripId/assign-driver", async (req, res) => {
  try {
    const tripId = String(req.params.tripId || "").trim();
    const motoristaId = String(req.body?.motoristaId || "").trim();
    const inicio = toDate(req.body?.inicio);
    const duracaoMin = Number(req.body?.duracaoMin || 0);

    if (!tripId || !motoristaId || !inicio || !duracaoMin) {
      return res.status(400).json({
        ok: false,
        message: "Campos obrigatórios: motoristaId, inicio, duracaoMin",
      });
    }

    const trip = await Trip.findOne({ tripId });
    if (!trip) {
      return res.status(404).json({ ok: false, message: "Viagem não encontrada", tripId });
    }

    const motorista = await Motorista.findById(motoristaId).lean();
    if (!motorista) {
      return res.status(404).json({ ok: false, message: "Motorista não encontrado", motoristaId });
    }

    const fim = addMinutes(inicio, duracaoMin);

    // anti-conflito
    const conflict = await hasConflict({
      motoristaId,
      inicio,
      fim,
      ignoreTripId: tripId,
    });

    if (conflict) {
      return res.status(409).json({
        ok: false,
        message: "Conflito: motorista já tem viagem neste horário",
        tripId,
        conflictTripId: conflict.tripId,
      });
    }

    trip.driver = {
      driverId: motoristaId,
      inicioPrevisto: inicio,
      fimPrevisto: fim,
      atribuidoEm: new Date(),
    };
    trip.status = "assigned";

    await trip.save();

    return res.json({
      ok: true,
      message: "Motorista atribuído com sucesso",
      tripId,
      driver: trip.driver,
    });
  } catch (e) {
    console.error("❌ assign-driver:", e);
    return res.status(500).json({ ok: false, message: "Erro ao atribuir motorista" });
  }
});

export default router;
