import Motorista from "../../models/Motorista.js";

function createError(message, statusCode = 500) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function atualizarLocalizacaoMotorista(motoristaId, payload = {}) {
  if (!motoristaId) {
    throw createError("ID do motorista é obrigatório.", 400);
  }

  const lat = toNumber(payload.lat);
  const lng = toNumber(payload.lng);
  const accuracy = toNumber(payload.accuracy);
  const speed = toNumber(payload.speed);
  const heading = toNumber(payload.heading);

  if (lat === null || lng === null) {
    throw createError("Latitude e longitude são obrigatórias.", 400);
  }

  const motorista = await Motorista.findById(motoristaId);
  if (!motorista) {
    throw createError("Motorista não encontrado.", 404);
  }

  motorista.lat = lat;
  motorista.lng = lng;

  if (!motorista.location || typeof motorista.location !== "object") {
    motorista.location = {};
  }

  motorista.location.lat = lat;
  motorista.location.lng = lng;
  motorista.location.updatedAt = new Date();
  motorista.location.accuracy = accuracy;
  motorista.location.speed = speed;
  motorista.location.heading = heading;

  await motorista.save();

  return {
    id: String(motorista._id),
    nome: motorista.nome || "",
    lat: motorista.lat ?? null,
    lng: motorista.lng ?? null,
    location: motorista.location || null,
    updatedAt: motorista.updatedAt || null,
  };
}