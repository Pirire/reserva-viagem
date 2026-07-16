import Viagem from "../../models/Viagem.js";
import Motorista from "../../models/Motorista.js";

function createError(message, statusCode = 500) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeCategory(value) {
  const v = normalize(value);
  if (v.includes("econom")) return "ECONOMICA";
  if (v.includes("confort")) return "CONFORT";
  if (v.includes("execut")) return "EXECUTIVA";
  if (v.includes("grupo")) return "GRUPO";
  return String(value || "").trim().toUpperCase();
}

function getDriverCoords(driver) {
  const lat = num(
    driver?.lat ??
      driver?.latitude ??
      driver?.localizacao?.lat ??
      driver?.localização?.lat ??
      driver?.location?.lat ??
      driver?.gps?.lat
  );

  const lng = num(
    driver?.lng ??
      driver?.lon ??
      driver?.longitude ??
      driver?.localizacao?.lng ??
      driver?.localização?.lng ??
      driver?.localizacao?.lon ??
      driver?.localização?.lon ??
      driver?.location?.lng ??
      driver?.gps?.lng
  );

  if (lat === null || lng === null) return null;
  return { lat, lng };
}

function getTripCoords(viagem) {
  const lat = num(viagem?.lat);
  const lng = num(viagem?.lng);

  if (lat === null || lng === null) return null;
  return { lat, lng };
}

function getDriverRating(driver) {
  const rating = num(
    driver?.classificacao ??
      driver?.classificação ??
      driver?.rating ??
      driver?.avaliacao ??
      driver?.avaliação ??
      driver?.media ??
      driver?.nota
  );

  return rating === null ? 5 : rating;
}

function isDriverAvailable(driver) {
  const status = normalize(
    driver?.status ?? driver?.estado ?? driver?.disponibilidade
  );

  return [
    "disponivel",
    "disponível",
    "online",
    "ativo",
    "activo",
    "livre",
  ].includes(status);
}

function tripCategoryMatches(driver, viagem) {
  const tripCat = normalizeCategory(viagem?.categoria);
  const driverCat = normalizeCategory(
    driver?.categoria ?? driver?.category ?? driver?.tipoVeiculo
  );

  if (!tripCat || tripCat === "TODOS") return true;
  return tripCat === driverCat;
}

function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export async function listarCandidatosParaViagem(viagemId, maxKm = 5) {
  if (!viagemId) {
    throw createError("ID da viagem é obrigatório.", 400);
  }

  const viagem = await Viagem.findById(viagemId);
  if (!viagem) {
    throw createError("Viagem não encontrada.", 404);
  }

  const tripCoords = getTripCoords(viagem);
  if (!tripCoords) {
    throw createError("A viagem não tem coordenadas válidas.", 400);
  }

  const motoristas = await Motorista.find({});
  const candidatos = motoristas
    .map((motorista) => {
      const coords = getDriverCoords(motorista);
      if (!coords) return null;

      const distanciaKm = getDistanceKm(
        tripCoords.lat,
        tripCoords.lng,
        coords.lat,
        coords.lng
      );

      return {
        motorista,
        coords,
        distanciaKm,
      };
    })
    .filter(Boolean)
    .filter((item) => item.distanciaKm <= maxKm)
    .filter((item) => isDriverAvailable(item.motorista))
    .filter((item) => tripCategoryMatches(item.motorista, viagem))
    .sort((a, b) => a.distanciaKm - b.distanciaKm)
    .map((item) => ({
      id: String(item.motorista._id),
      nome: item.motorista.nome || "-",
      email: item.motorista.email || "",
      contacto: item.motorista.contacto || "",
      categoria: item.motorista.categoria || "",
      status: item.motorista.status || item.motorista.estado || "",
      rating: getDriverRating(item.motorista),
      distanciaKm: Number(item.distanciaKm.toFixed(2)),
      lat: item.coords.lat,
      lng: item.coords.lng,
      matricula:
        item.motorista.matricula ||
        item.motorista.veiculo?.matricula ||
        "",
    }));

  return {
    viagemId: String(viagem._id),
    raioKm: maxKm,
    candidatos,
  };
}