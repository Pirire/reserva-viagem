// src/services/criarEDespacharViagem.service.js
// ══════════════════════════════════════════════════════════════
// Ponto único de criação de viagens despacháveis. Usado por TODOS
// os fluxos que geram uma viagem que precisa de motorista:
//   - RESERVAR            (reservas.routes.js)
//   - PARTILHAR VIAGEM    (shareFinalize.service.js)
//   - CRIAR TICKET        (reservas.routes.js / ticket flow)
//   - CONVIDADO           (convidado.routes.js)
//   - CRIAR EVENTO        (rm-events.js backend equivalente)
//
// ANTES desta versão, cada fluxo tinha a sua própria lógica de
// criação — alguns criavam Reserva (modelo antigo, invisível ao
// painel de despacho), outros não despachavam de todo. Resultado:
// só "Partilhar Viagem" aparecia no painel de despacho do admin.
//
// Agora todos criam uma Trip (models/Trip.js, collection "viagens"
// — a mesma fonte usada pelo painel admin-master.html) e são
// entregues ao MESMO motor de despacho profissional (fila de
// candidatos, oferta com timeout, fallback automático para
// WAITING_ADMIN quando não há motorista disponível).
// ══════════════════════════════════════════════════════════════
import * as ViagemRepository from "../repositories/viagem.repository.js";
import { autoDispatch } from "../modules/dispatch/dispatch.auto.service.js";
import { runOfferEngine } from "../modules/dispatch/dispatch.offer.engine.js";

/**
 * @param {object} dados
 * @param {string} dados.canal           - "publico"|"utilizador"|"colaborador"|"partilha"
 * @param {string} dados.subcanal        - texto livre (ex: "reserva", "ticket", "convidado", "evento")
 * @param {string} dados.tripId          - código de negócio (ex: "RM-XXXX")
 * @param {string} dados.pickup
 * @param {string} dados.dropoff
 * @param {Date}   dados.when
 * @param {{lat,lng,address}} [dados.origemGeo]
 * @param {{lat,lng,address}} [dados.destinoGeo]
 * @param {{nome,email,contacto}} dados.customer
 * @param {{categoria,total,currency}} dados.quote
 * @param {object} [dados.meta]
 * @param {import('socket.io').Server} [io]
 *
 * @returns {Promise<{ viagem: object, motoristaEncontrado: boolean }>}
 */
export async function criarEDespacharViagem(dados, io = null) {
  const viagem = await ViagemRepository.create({
    tripId:   dados.tripId,
    canal:    dados.canal || "publico",
    subcanal: dados.subcanal || "normal",

    pickup:  dados.pickup  || "",
    dropoff: dados.dropoff || "",
    when:    dados.when    || new Date(),

    origemGeo:  dados.origemGeo  || { lat: null, lng: null, address: "" },
    destinoGeo: dados.destinoGeo || { lat: null, lng: null, address: "" },

    // Campos legacy directos — autoDispatch() lê viagem.lat/lng, não
    // viagem.origemGeo.lat (o pre-save hook do Trip.js só sincroniza
    // depois de gravado; aqui garantimos consistência desde já).
    lat: dados.origemGeo?.lat ?? null,
    lng: dados.origemGeo?.lng ?? null,

    customer: dados.customer || {},
    quote:    dados.quote || {},

    status: "pendente",
    paymentStatus: dados.paymentStatus || "none",

    meta: dados.meta || {},
  });

  let motoristaEncontrado = false;
  try {
    const resultado = await autoDispatch(String(viagem._id));
    motoristaEncontrado = !!resultado?.ok;

    if (motoristaEncontrado && io) {
      const offerResult = await runOfferEngine({ io, tripId: String(viagem._id) });
      if (!offerResult?.ok) {
        console.warn("⚠️ [criarEDespacharViagem] Offer Engine não iniciou:", offerResult?.reason);
      }
    }
  } catch (err) {
    // autoDispatch() lança erro quando não há candidatos disponíveis
    // — caso ESPERADO, não uma falha. A viagem fica em "pendente",
    // visível no painel de despacho manual do admin.
    console.warn(`⚠️ [criarEDespacharViagem] sem candidatos para ${dados.tripId}:`, err?.message);
  }

  return { viagem, motoristaEncontrado };
}
