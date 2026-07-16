import mongoose from "mongoose";
import DispatchSession from "../../models/DispatchSession.js";
import AdminQuoteConfig from "../../models/AdminQuoteConfig.js";
import { recoverDispatch } from "./dispatch.recovery.service.js";

const CORTE_COMISSAO_PONTOS = 0.10; // 10 pontos percentuais (ex: 25% → 15%)
// Piso do valor JÁ REDUZIDO — nunca abaixo de 5%, mesmo que a base
// configurável (AdminQuoteConfig.plataformaPercent) esteja no seu
// próprio mínimo permitido (15%): 15% − 10 pontos = exatamente 5%,
// nunca menos. Duas camadas de proteção (aqui e no schema) em vez
// de confiar só numa.
const COMISSAO_MINIMA_INCENTIVO = 0.05;
// Cada candidato (ou grupo de candidatos, se houver mais do que um)
// é tentado no máximo 2 vezes: a 1ª volta à comissão normal, a 2ª
// já com o incentivo de 10%. Ao fim da 2ª volta sem ninguém aceitar,
// desiste de vez e escala para despacho manual — nunca um ciclo
// indefinido.
const MAX_VOLTAS = 2;

export async function runOfferEngine({ io, tripId }) {
  if (!tripId || !io) {
    return { ok: false, reason: "MISSING_PARAMS" };
  }

  const session = await DispatchSession.findOne({ tripId });

  if (!session) {
    return { ok: false, reason: "SESSION_NOT_FOUND" };
  }

  // 🔒 se já foi aceite, parar tudo
  if (session.status === "ACCEPTED") {
    return { ok: true, reason: "ALREADY_ACCEPTED" };
  }

  const voltas = session.voltas || 0; // 0 = 1ª volta (normal), 1 = 2ª volta (incentivo)

  // Comissão base — buscada sempre, mesmo na 1ª volta sem incentivo,
  // porque o motorista precisa de saber quanto vai ganhar em
  // qualquer oferta, reforçada ou não.
  const configAtual = await AdminQuoteConfig.findOne({ key: "default" }).lean();
  const comissaoBase = Number(configAtual?.plataformaPercent ?? 0.25);

  // ── Incentivo "motorista mais próximo" ──────────────────────
  // Activa-se exactamente na 2ª volta (voltas === 1) — não depende
  // de tempo decorrido, só de já se ter esgotado a lista de
  // candidatos uma vez sem ninguém aceitar. Aplicado uma única vez
  // por sessão (comissaoAjustada só fica preenchida a primeira vez
  // que a 2ª volta começa).
  let comissaoAjustada = session.comissaoAjustada;
  if (voltas >= 1 && comissaoAjustada == null) {
    comissaoAjustada = Math.max(
      COMISSAO_MINIMA_INCENTIVO,
      Number((comissaoBase - CORTE_COMISSAO_PONTOS).toFixed(4))
    );

    await DispatchSession.updateOne(
      { tripId },
      { $set: { comissaoAjustada, comissaoAjustadaEm: new Date() } }
    );

    console.log(
      `💸 [dispatch.offer.engine] Incentivo ativado para ${tripId} — comissão ${(comissaoBase * 100).toFixed(0)}% → ${(comissaoAjustada * 100).toFixed(0)}% (2ª volta)`
    );
  }
  // A comissão que vale AGORA, para esta oferta específica — reduzida
  // se já estivermos na 2ª volta, senão a base normal.
  const comissaoEfetiva = comissaoAjustada ?? comissaoBase;

  const index = session.currentIndex || 0;
  const driver = session.candidatos?.[index];

  // 🚨 chegámos ao fim desta volta pela lista de candidatos
  if (!driver) {
    const proximaVolta = voltas + 1;
    if (session.candidatos?.length && proximaVolta < MAX_VOLTAS) {
      // Ainda não fizemos as 2 voltas — reinicia a lista desde o
      // início, agora já na volta seguinte (que activa o incentivo,
      // calculado acima na próxima chamada).
      await DispatchSession.updateOne(
        { tripId },
        { $set: { currentIndex: 0, voltas: proximaVolta, updatedAt: new Date() } }
      );
      console.log(`🔁 [dispatch.offer.engine] Fim da volta ${voltas + 1}/${MAX_VOLTAS}, ${tripId} — a iniciar a volta ${proximaVolta + 1}`);
      return runOfferEngine({ io, tripId });
    }
    // Já fizemos as 2 voltas (normal + incentivo) e ninguém aceitou
    // — desiste de vez, escala para despacho manual.
    return await recoverDispatch({ tripId, reason: "NO_DRIVER" });
  }

  // 🔒 atualizar sessão (lock do driver atual)
  await DispatchSession.updateOne(
    { tripId },
    {
      $set: {
        status: "OFFERED",
        lockOwner: driver.motoristaId,
        lockedAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );

  // 📡 emitir socket
  // Dados públicos da viagem (sem passageiro)
  let _vp = {};
  try {
    const _col = mongoose.connection.db.collection("viagens");
    const _v   = await _col.findOne({ _id: new mongoose.Types.ObjectId(tripId) }).catch(()=>null);
    if (_v) _vp = {
      partida:     _v.partida     || _v.origem  || "—",
      destino:     _v.destino     || "—",
      categoria:   _v.categoria   || "—",
      distanciaKm: _v.distanciaKm || null,
      valor:       _v.valor        || null,
      datahora:    _v.datahora     || null,
      modoConvidado: !!(_v.extras?.modoConvidado),
      // Coordenadas já geocodificadas na criação da viagem — sem
      // isto, o ecrã do motorista teria de geocodificar os endereços
      // de novo (Nominatim, mais lento, menos fiável) só para
      // desenhar o mapa da oferta. origemGeo é sincronizado a partir
      // de lat/lng legacy quando em falta (Trip.js pre-save hook só
      // sincroniza num sentido: origemGeo → lat/lng, não o inverso).
      origemGeo: _v.origemGeo?.lat != null
        ? _v.origemGeo
        : (_v.lat != null && _v.lng != null ? { lat: _v.lat, lng: _v.lng, address: _v.origem || "" } : null),
      destinoGeo: _v.destinoGeo?.lat != null ? _v.destinoGeo : null,
      // O motorista NÃO deve ver o valor total da viagem (o que o
      // cliente paga) — vê quanto VAI GANHAR, já com a comissão da
      // plataforma descontada. Sem isto, mostrar "€10,00" não diz
      // nada sobre se esta oferta paga melhor por causa do
      // incentivo — o cliente continua a pagar o mesmo sempre; o que
      // muda é a fatia que fica para o motorista.
      ganhoMotorista: _v.valor != null
        ? Number((_v.valor * (1 - comissaoEfetiva)).toFixed(2))
        : null,
    };
  } catch(_e) {}

  io.to(`driver_${driver.motoristaId}`).emit("trip_offer", {
    tripId,
    motorista: driver,
    message: "Nova viagem disponível",
    viagem: _vp,
    // O motorista vê se esta oferta paga mais que o habitual —
    // pode pesar na decisão de aceitar.
    comissaoReduzida: comissaoAjustada != null,
    comissaoAtual: comissaoAjustada,
  });

  console.log("📡 Emit trip_offer para:", driver.motoristaId);

  // ⏱ timeout controlado (SÓ UMA VEZ) — este é o tempo de resposta
  // de CADA motorista individual (12s), continua igual. É o relógio
  // TOTAL da sessão (session.createdAt, acima) que decide o
  // incentivo — não este timeout por motorista.
  setTimeout(async () => {
    const updated = await DispatchSession.findOne({ tripId });

    if (!updated) return;

    // 🔒 se já aceitou → stop total
    if (updated.status === "ACCEPTED") return;

    // 🔒 se não for o mesmo lock → já mudou de driver
    if (updated.lockOwner !== driver.motoristaId) return;

    // 🔁 avançar índice
    await DispatchSession.updateOne(
      { tripId },
      {
        $inc: { currentIndex: 1 },
        $set: {
          updatedAt: new Date(),
        },
      }
    );

    // 🔁 tentar próximo motorista
    await runOfferEngine({ io, tripId });
  }, 12000);

  return {
    ok: true,
    offeredDriver: driver,
    comissaoAjustada,
  };
}