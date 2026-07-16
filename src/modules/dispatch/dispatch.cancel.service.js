// src/modules/dispatch/dispatch.cancel.service.js
// ══════════════════════════════════════════════════════════════
// Cancelar-e-reatribuir — um motorista que já tinha aceite uma
// viagem cancela antes de a iniciar (por ação própria, ou porque
// não respondeu ao aviso automático de "hora de partir" dentro do
// tempo dado). Em vez de deixar a viagem sem motorista até alguém
// reparar manualmente, procura logo um substituto — o mesmo motor
// usado no despacho inicial (autoDispatch + runOfferEngine), só que
// desta vez excluindo explicitamente quem acabou de cancelar.
//
// Se não houver mais ninguém disponível, a viagem fica em
// "pendente" — visível no painel de despacho manual do admin,
// exatamente como já acontece quando o despacho inicial não
// encontra ninguém.
// ══════════════════════════════════════════════════════════════
import mongoose from "mongoose";
import DispatchSession from "../../models/DispatchSession.js";
import { autoDispatch } from "./dispatch.auto.service.js";
import { runOfferEngine } from "./dispatch.offer.engine.js";

function viagensCollection() {
  return mongoose.connection.db.collection("viagens");
}

/**
 * @param {string} tripId
 * @param {string} driverIdQueCancelou
 * @param {import('socket.io').Server} io
 * @returns {Promise<{ ok: boolean, motoristaEncontrado: boolean, reason?: string }>}
 */
export async function cancelarERedespachar(tripId, driverIdQueCancelou, io) {
  if (!tripId || !driverIdQueCancelou) {
    return { ok: false, motoristaEncontrado: false, reason: "MISSING_PARAMS" };
  }

  const col = viagensCollection();

  // Limpa a atribuição actual na Trip — deixa de estar "assigned" a
  // este motorista, volta a "pendente" para poder ser despachada de
  // novo (para outro, ou manualmente pelo admin se não houver mais
  // ninguém).
  await col.updateOne(
    { _id: new mongoose.Types.ObjectId(tripId) },
    {
      $set: { status: "pendente" },
      $unset: { "driver.driverId": "", "driver.atribuidoEm": "" },
    }
  );

  // Sessão de despacho reiniciada do zero — nova procura, sem
  // arrastar voltas/incentivo da tentativa anterior (que já foi
  // aceite e depois cancelada, não faz sentido continuar a contar
  // a partir de onde ficou).
  await DispatchSession.updateOne(
    { tripId: String(tripId) },
    {
      $set: {
        status: "SEARCHING",
        currentIndex: 0,
        voltas: 0,
        acceptedDriverId: null,
        lockOwner: null,
        lockedAt: null,
        comissaoAjustada: null,
        comissaoAjustadaEm: null,
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  try {
    const resultado = await autoDispatch(String(tripId), {
      excluirMotoristaId: driverIdQueCancelou,
    });
    const motoristaEncontrado = !!resultado?.ok;

    if (motoristaEncontrado && io) {
      const offerResult = await runOfferEngine({ io, tripId: String(tripId) });
      if (!offerResult?.ok) {
        console.warn("⚠️ [dispatch.cancel.service] Offer Engine não iniciou:", offerResult?.reason);
      }
    }

    return { ok: true, motoristaEncontrado };
  } catch (err) {
    // autoDispatch lança erro quando não há candidatos — caso
    // ESPERADO (ninguém mais disponível), não uma falha. A viagem
    // fica "pendente", visível no painel de despacho manual.
    console.warn(`⚠️ [dispatch.cancel.service] sem candidatos para reatribuir ${tripId}:`, err?.message);
    return { ok: true, motoristaEncontrado: false, reason: "NO_DRIVER" };
  }
}
