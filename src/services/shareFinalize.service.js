// src/services/shareFinalize.service.js
// ══════════════════════════════════════════════════════════════
// Quando TODOS os participantes de uma viagem partilhada pagam,
// cria a Trip canónica (models/Trip.js, collection "viagens" —
// a MESMA fonte de verdade usada por reservas normais, pelo painel
// de despacho do admin, e por todo o sistema de despacho
// profissional) e entrega-a ao motor de despacho automático.
//
// ANTES desta versão, esta função criava uma Reserva (modelo
// diferente, coleção diferente) — por isso as viagens partilhadas
// NUNCA apareciam no painel de despacho do admin-master.html (que
// lê exclusivamente de /admin/viagens → Trip), independentemente
// de terem ou não motorista atribuído. Era um problema de "duas
// fontes de verdade" em paralelo, não um bug de filtro.
//
// Despacho:
//   autoDispatch()    → calcula candidatos, grava DispatchSession
//   runOfferEngine()  → oferece ao melhor candidato, com timeout;
//                        se ninguém aceitar/existir, cai
//                        automaticamente em recoverDispatch(), que
//                        marca status:"WAITING_ADMIN" — é isso que
//                        faz a viagem aparecer no painel manual.
//
// Chamado a partir de:
//   - partilha.routes.js  → /invite/confirmar-pagamento (Stripe)
//   - payments.routes.js  → markPaidFromCustomId (PayPal)
// ══════════════════════════════════════════════════════════════
import ShareTrip from "../models/ShareTrip.js";
import ShareInvite from "../models/ShareInvite.js";
import * as ViagemRepository from "../repositories/viagem.repository.js";
import { autoDispatch } from "../modules/dispatch/dispatch.auto.service.js";
import { runOfferEngine } from "../modules/dispatch/dispatch.offer.engine.js";

function gerarTripId() {
  return (
    "SH-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    Math.random().toString(36).slice(2, 5).toUpperCase()
  );
}

/**
 * Verifica se todos os convidados de uma partilha já pagaram e,
 * se sim, cria a Trip e entrega-a ao despacho automático.
 * Idempotente — chamar várias vezes para a mesma shareId não cria
 * viagens duplicadas (verifica trip.tripRefId antes de criar).
 *
 * @returns {Promise<object|null>} a Trip criada, ou null se ainda
 *   não estiverem todos pagos, a viagem já tiver sido finalizada,
 *   ou não existir.
 */
export async function finalizeSharedTrip(shareId, io) {
  try {
    const trip = await ShareTrip.findOne({ shareId });
    if (!trip) return null;
    if (trip.tripRefId) return null; // já finalizada — evita duplicar

    const invites = await ShareInvite.find({ shareId });
    if (!invites.length) return null;

    // Só considera quem ainda está activo na partilha — quem falhou
    // o pagamento já foi marcado como "falhou" antes disto ser
    // chamado novamente (ver /invite/pagamento-falhou).
    const ativos = invites.filter((i) => i.status !== "falhou" && i.status !== "cancelado");
    if (!ativos.length) return null;

    const todosPagos = ativos.every((i) => i.status === "pagou");
    if (!todosPagos) return null;

    const tripIdNegocio = gerarTripId();
    const valorTotal = ativos.reduce((s, i) => s + Number(i.amountDue || 0), 0);

    // Trip canónica — campos pickup/dropoff/when/quote/customer são
    // os "novos" (lidos pelo painel de despacho); origem/destino/
    // valor/categoria/lat/lng são sincronizados automaticamente
    // pelo pre-save hook do Trip.js (compatibilidade legacy).
    const viagem = await ViagemRepository.create({
      tripId: tripIdNegocio,
      canal: "partilha",
      subcanal: "viagem_partilhada",

      pickup:  trip.recolha?.address || "",
      dropoff: trip.destino?.address || "",
      when:    trip.scheduledAt ? new Date(trip.scheduledAt) : new Date(),

      origemGeo: trip.recolha?.lat != null
        ? { lat: trip.recolha.lat, lng: trip.recolha.lng, address: trip.recolha.address }
        : { lat: null, lng: null, address: "" },
      destinoGeo: trip.destino?.lat != null
        ? { lat: trip.destino.lat, lng: trip.destino.lng, address: trip.destino.address }
        : { lat: null, lng: null, address: "" },

      // lat/lng directos também — autoDispatch() lê viagem.lat/viagem.lng
      // (campos legacy), não viagem.origemGeo.lat. O pre-save hook do
      // Trip.js só sincroniza nesse sentido quando origemGeo.lat é
      // truthy, por isso definimos os dois para nunca depender da
      // ordem de execução do hook.
      lat: trip.recolha?.lat ?? null,
      lng: trip.recolha?.lng ?? null,

      customer: {
        nome:  trip.nomeOrganizador || "Viagem partilhada",
        email: trip.emailOrganizador || "",
      },

      // Identidade do hotel/cliente que criou esta partilha — mesma
      // correcção já aplicada hoje às chamadas de Reservar e Evento.
      // Undefined em vez de string vazia quando não existe: uma
      // partilha criada por alguém sem conta (organizador anónimo,
      // só nome+email) genuinamente não tem hotel a associar — isso
      // é esperado, não um bug a esconder.
      collaborator: trip.organizadorId ? { collaboratorId: String(trip.organizadorId) } : undefined,

      quote: {
        categoria: trip.categoria || "",
        total:     Number(valorTotal.toFixed(2)),
        currency:  "EUR",
      },

      status: "pendente",
      paymentStatus: "paid", // todos os participantes já pagaram

      meta: {
        origemPartilha: true,
        shareId,
        participantes: ativos.map((i) => ({
          nome: i.nome || i.contacto,
          contacto: i.contacto,
          valor: Number(i.amountDue || 0),
          provider: i.payProvider || null,
        })),
      },
    });

    trip.tripRefId = viagem._id;
    trip.tripIdNegocio = tripIdNegocio;
    await trip.save();

    // Entregar ao motor de despacho profissional — calcula
    // candidatos por proximidade/categoria/rating e regista a
    // DispatchSession.
    let dispatchOk = false;
    try {
      const resultado = await autoDispatch(String(viagem._id));
      dispatchOk = !!resultado?.ok;

      // Iniciar a oferta ao melhor candidato (com timeout e
      // fallback automático para WAITING_ADMIN se ninguém aceitar
      // ou não houver candidatos) — mesmo fluxo usado por
      // dispatch.auto.controller.js para reservas normais.
      if (dispatchOk && io) {
        const offerResult = await runOfferEngine({ io, tripId: String(viagem._id) });
        if (!offerResult?.ok) {
          console.warn("⚠️ [shareFinalize] Offer Engine não iniciou:", offerResult?.reason);
        }
      }
    } catch (err) {
      // autoDispatch() lança erro (não devolve {ok:false}) quando não
      // há candidatos — "Nenhum motorista compatível disponível."
      // Isto é um caso ESPERADO (sem motoristas registados), não uma
      // falha do sistema; a viagem fica em "pendente", visível no
      // painel de despacho manual do admin, exactamente como deve.
      console.warn("⚠️ [shareFinalize] autoDispatch sem candidatos:", err?.message);
    }

    // Avisar o organizador em tempo real, se estiver com a página
    // aberta (sala "share_<shareId>" — ver server.js / rm-share.js).
    if (io) {
      io.to(`share_${shareId}`).emit("partilha_finalizada", {
        shareId,
        codigo: tripIdNegocio,
        tripId: String(viagem._id),
        motoristaEncontrado: dispatchOk,
      });
    }

    return viagem;
  } catch (err) {
    console.error("❌ [shareFinalize] finalizeSharedTrip:", err);
    return null;
  }
}