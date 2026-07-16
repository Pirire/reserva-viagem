import mongoose from "mongoose";
import Motorista from "../../models/Motorista.js";
import Veiculo from "../../models/Veiculo.js";
import DispatchSession from "../../models/DispatchSession.js";
import { obterRankingMotoristas } from "../feedback/feedback.ranking.service.js";

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

function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

// Enum canónico — tem de bater certo com CATEGORIAS em models/Veiculo.js
const CATEGORIAS_VALIDAS = ["economica", "confort", "executive", "luxury", "grupo6", "grupo8", "grupo17"];

// Raio máximo de procura de motorista — aplica-se a TODAS as
// reservas (índice, hotel, evento/Reserva Flexível), já que todas
// passam por este motor. Fora deste raio, o motorista nem entra na
// lista de candidatos — nem é ordenado por perto/longe, é excluído.
const RAIO_DESPACHO_KM = 7;

// Devolve sempre um dos valores de CATEGORIAS_VALIDAS. Faz match
// exacto primeiro (é o caminho normal, já que tanto Trip.quote.categoria
// como Veiculo.categoriasAtivas usam os mesmos valores do enum);
// só cai no fuzzy match para dados legacy/livres que não batam certo
// com o enum. IMPORTANTE: ao contrário da versão anterior, NÃO
// colapsa grupo6/grupo8/grupo17 numa única "GRUPO" genérica — cada
// capacidade é distinta, para não despachar um veículo de 6 lugares
// para um pedido de 17.
function categoriaCanonica(value) {
  const v = normalize(value);
  if (CATEGORIAS_VALIDAS.includes(v)) return v;

  if (v.includes("econom"))  return "economica";
  if (v.includes("confort")) return "confort";
  if (v.includes("execut"))  return "executive";
  if (v.includes("lux"))     return "luxury";
  if (v.includes("17"))      return "grupo17";
  if (v.includes("8"))       return "grupo8";
  if (v.includes("grupo") || v.includes("6")) return "grupo6";

  return v; // desconhecido — não deve acontecer com dados válidos
}

function viagemCollectionFilter(viagemId) {
  const objectId = new mongoose.Types.ObjectId(viagemId);
  return { _id: objectId };
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

function motoristaTemCoords(motorista) {
  return (
    num(motorista?.lat) !== null &&
    num(motorista?.lng) !== null
  );
}

// Verifica se o motorista está online e apto a receber despacho.
//
// CORREÇÃO: esta função lia Motorista.status (String, ex: "Disponível"),
// mas esse campo nunca é escrito por nenhuma rota — o botão "Ficar
// Online" do motorista.html chama POST /disponibilidade, que grava
// em Motorista.disponivel (Boolean). Como Motorista.status nasce
// sempre "Disponível" (valor por defeito do schema) e nunca muda,
// esta função devolvia sempre true, para QUALQUER motorista —
// online, offline, ou nunca tendo aberto a app. Com poucos
// motoristas de teste isto passou despercebido; à escala (centenas/
// milhares de motoristas), significa que o despacho considera
// candidatos que nunca ligaram o "Ficar Online".
function motoristaDisponivel(motorista) {
  return motorista?.disponivel === true;
}

function buildRankingMap(ranking = []) {
  const map = new Map();

  for (const item of ranking) {
    if (!item?.motoristaId) continue;

    map.set(
      String(item.motoristaId),
      Number(item.media || 0)
    );
  }

  return map;
}

function calcularScore({
  distanciaKm,
  mediaRating,
}) {
  const distanciaScore =
    Math.max(0, 10 - distanciaKm);

  const ratingScore =
    Number(mediaRating || 0);

  return Number(
    (
      distanciaScore * 0.7 +
      ratingScore * 0.3
    ).toFixed(4)
  );
}

export async function autoDispatch(viagemId, opts = {}) {
  const { excluirMotoristaId = null } = opts;
  if (!viagemId) {
    throw createError(
      "ID da viagem é obrigatório.",
      400
    );
  }

  if (!mongoose.Types.ObjectId.isValid(viagemId)) {
    throw createError(
      "ID de viagem inválido.",
      400
    );
  }

  const col = viagensCollection();

  const viagem = await col.findOne(
    viagemCollectionFilter(viagemId)
  );

  if (!viagem) {
    throw createError(
      "Viagem não encontrada.",
      404
    );
  }

  if (
    num(viagem.lat) === null ||
    num(viagem.lng) === null
  ) {
    throw createError(
      "Viagem sem coordenadas válidas.",
      400
    );
  }

  // Filtrado directamente na base de dados — aproveita o índice
  // composto já definido em Motorista.js ({ disponivel: 1, aprovacao: 1 }).
  // Antes trazia TODOS os motoristas para memória (Motorista.find({})),
  // incluindo offline/pendentes/rejeitados, para só depois filtrar em
  // JavaScript — desperdício crescente à medida que a frota cresce.
  const motoristas =
    await Motorista.find({
      disponivel: true,
      aprovacao:  "aprovado",
    }).lean();

  if (!motoristas.length) {
    throw createError(
      "Nenhum motorista encontrado.",
      404
    );
  }

  // Categoria pedida pela viagem, no valor canónico do enum
  // (Veiculo.js) — ex: "economica", "confort", "grupo6"...
  const categoriaPedida = categoriaCanonica(viagem?.categoria);

  // Motoristas elegíveis para ESTA categoria: têm um veículo
  // atribuído (motoristaId), aprovado, disponível, e com essa
  // categoria LIGADA em categoriasAtivas (botão de categorias no
  // motorista.html). Isto substitui o antigo `motorista.categoria`,
  // que nunca existiu no schema de Motorista — a categoria vive no
  // Veiculo, não na pessoa.
  const veiculosElegiveis = await Veiculo.find({
    motoristaId:      { $ne: null },
    disponivel:       true,
    aprovacao:        "aprovado",
    categoriasAtivas: categoriaPedida,
  }).select("motoristaId categoriasAtivas").lean();

  const motoristaIdsElegiveis = new Set(
    veiculosElegiveis.map((v) => String(v.motoristaId))
  );

  // excluirMotoristaId — usado pelo fluxo "cancelar recolha" (o
  // motorista já tinha aceite, mas cancelou antes de iniciar): ao
  // procurar um substituto, exclui explicitamente quem acabou de
  // cancelar, para o mesmo pedido não lhe voltar a aparecer.
  const motoristasElegiveis = motoristas
    .filter((m) => motoristaIdsElegiveis.has(String(m._id)))
    .filter((m) => !excluirMotoristaId || String(m._id) !== String(excluirMotoristaId));

  if (!motoristasElegiveis.length) {
    throw createError(
      `Nenhum motorista com a categoria "${categoriaPedida}" ligada disponível.`,
      404
    );
  }

  const ranking =
    await obterRankingMotoristas(200);

  const rankingMap =
    buildRankingMap(ranking);

  // motoristaDisponivel() aqui é redundante em condições normais — a
  // query acima já só traz motoristas com disponivel:true e
  // aprovacao:"aprovado". Mantido como segunda camada de defesa (ex:
  // se esta função for reutilizada no futuro com uma query diferente,
  // menos restritiva).
  const candidatos = motoristasElegiveis
    .filter(motoristaDisponivel)
    .filter(motoristaTemCoords)
    .map((motorista) => {
      const lat = num(motorista.lat);
      const lng = num(motorista.lng);

      const distanciaKm =
        getDistanceKm(
          num(viagem.lat),
          num(viagem.lng),
          lat,
          lng
        );

      const mediaRating =
        rankingMap.get(
          String(motorista._id)
        ) || 0;

      const score =
        calcularScore({
          distanciaKm,
          mediaRating,
        });

      return {
        motorista,
        distanciaKm,
        mediaRating,
        score,
      };
    })
    // Exclui quem está fora do raio de despacho — não é só uma
    // questão de ordenação, é elegibilidade: motoristas a mais de
    // RAIO_DESPACHO_KM nunca chegam a receber a oferta.
    .filter((c) => c.distanciaKm <= RAIO_DESPACHO_KM)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      if (
        a.distanciaKm !== b.distanciaKm
      ) {
        return (
          a.distanciaKm -
          b.distanciaKm
        );
      }

      return (
        b.mediaRating -
        a.mediaRating
      );
    });

  if (!candidatos.length) {
    throw createError(
      `Nenhum motorista compatível disponível dentro de ${RAIO_DESPACHO_KM}km.`,
      404
    );
  }

  await DispatchSession.findOneAndUpdate(
    {
      tripId: String(viagemId),
    },
    {
      $set: {
        tripId: String(viagemId),

        status: "SEARCHING",

        candidatos:
          candidatos.map((item) => ({
            motoristaId:
              String(item.motorista._id),

            nome:
              item.motorista.nome || "",

            distanciaKm:
              Number(
                item.distanciaKm.toFixed(2)
              ),
          })),

        currentIndex: 0,

        acceptedDriverId: null,

        lockOwner: null,

        lockedAt: null,

        expiresAt: null,

        updatedAt: new Date(),
      },
    },
    {
      upsert: true,
      new: true,
    }
  );

  return {
    ok: true,

    tripId: String(viagem._id),

    candidatosConsiderados:
      candidatos.map((item) => ({
        id:
          String(item.motorista._id),

        nome:
          item.motorista.nome || "",

        categoria:
          categoriaPedida,

        distanciaKm:
          Number(
            item.distanciaKm.toFixed(2)
          ),

        mediaRating:
          Number(
            item.mediaRating.toFixed(2)
          ),

        score:
          item.score,
      })),
  };
}