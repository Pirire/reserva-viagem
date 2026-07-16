import mongoose from "mongoose";
import Motorista from "../../models/Motorista.js";
import { getAdminConfig } from "../../modules/admin/adminConfig.service.js";

function createError(message, statusCode = 500) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function viagensCollection() {
  return mongoose.connection.db.collection("viagens");
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

function motoristaDisponivel(motorista) {
  const status = String(motorista?.status || "").trim().toLowerCase();
  return status === "disponível" || status === "disponivel";
}

export async function verificarOfertaUltimoMotorista(clienteId, origemAtual) {
  if (!clienteId) {
    throw createError("ID do cliente é obrigatório.", 400);
  }

  const lat = num(origemAtual?.lat);
  const lng = num(origemAtual?.lng);

  if (lat === null || lng === null) {
    throw createError("Origem atual sem coordenadas válidas.", 400);
  }

  const config = await getAdminConfig();

  if (!config.repeatDriverEnabled) {
    return {
      eligible: false,
      reason: "Funcionalidade desativada.",
    };
  }

  const ultimaViagem = await viagensCollection()
    .find({
      $or: [
        { "customer.userId": String(clienteId) },
        { "customer.id": String(clienteId) },
        { clienteId: String(clienteId) },
      ],
    })
    .sort({ createdAt: -1, when: -1 })
    .limit(1)
    .next();

  if (!ultimaViagem) {
    return {
      eligible: false,
      reason: "Cliente sem viagens anteriores.",
    };
  }

  const ultimaData = new Date(
    ultimaViagem.updatedAt || ultimaViagem.createdAt || ultimaViagem.when || Date.now()
  );

  const diffMinutes = (Date.now() - ultimaData.getTime()) / 60000;

  if (diffMinutes > Number(config.repeatDriverMaxMinutes || 60)) {
    return {
      eligible: false,
      reason: "Última viagem fora da janela permitida.",
    };
  }

  const motoristaId =
    ultimaViagem?.motorista?.id ||
    ultimaViagem?.driver?.driverId ||
    null;

  if (!motoristaId || !mongoose.Types.ObjectId.isValid(String(motoristaId))) {
    return {
      eligible: false,
      reason: "Último motorista inválido ou ausente.",
    };
  }

  const motorista = await Motorista.findById(String(motoristaId)).lean();

  if (!motorista) {
    return {
      eligible: false,
      reason: "Último motorista não encontrado.",
    };
  }

  if (!motoristaDisponivel(motorista)) {
    return {
      eligible: false,
      reason: "Último motorista não está disponível.",
    };
  }

  const mLat = num(motorista?.lat ?? motorista?.location?.lat);
  const mLng = num(motorista?.lng ?? motorista?.location?.lng);

  if (mLat === null || mLng === null) {
    return {
      eligible: false,
      reason: "Último motorista sem coordenadas válidas.",
    };
  }

  const distanciaKm = getDistanceKm(lat, lng, mLat, mLng);
  const maxKm = Number(config.repeatDriverMaxDistanceKm || 5);

  if (distanciaKm > maxKm) {
    return {
      eligible: false,
      reason: "Último motorista fora do raio permitido.",
    };
  }

  return {
    eligible: true,
    motorista: {
      id: String(motorista._id),
      nome: motorista.nome || "",
      email: motorista.email || "",
      contacto: motorista.contacto || "",
      categoria: motorista.categoria || "",
      status: motorista.status || "",
      distanciaKm: Number(distanciaKm.toFixed(2)),
      lat: mLat,
      lng: mLng,
    },
    pricing: {
      empresaPercent: Number(config.repeatDriverEmpresaPercent || 7.5),
      motoristaPercent: Number(config.repeatDriverMotoristaPercent || 92.5),
    },
    config: {
      maxDistanceKm: maxKm,
      maxMinutes: Number(config.repeatDriverMaxMinutes || 60),
    },
    lastTrip: {
      id: String(ultimaViagem._id),
      origem: ultimaViagem.origem || ultimaViagem.pickup || "",
      destino: ultimaViagem.destino || ultimaViagem.dropoff || "",
    },
  };
}