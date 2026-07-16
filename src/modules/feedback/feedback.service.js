// src/modules/feedback/feedback.service.js
// ══════════════════════════════════════════════════════════════
// SERVIÇO CANÓNICO DE FEEDBACK — versão única e definitiva.
//
// CONFLITO RESOLVIDO:
//   Era: dois ficheiros com o mesmo nome importavam o modelo
//   de caminhos diferentes:
//     — src/services/Feedback.service.js → "../../models/Feedback.model.js"
//     — src/modules/feedback/feedback.service.js → "./feedback.model.js"
//
// SOLUÇÃO:
//   Ficheiro único aqui. src/services/Feedback.service.js
//   deve ser APAGADO e substituído por um re-export:
//     export * from "../modules/feedback/feedback.service.js";
//
// MODELO: src/modules/feedback/feedback.model.js  (canónico)
// ══════════════════════════════════════════════════════════════

import crypto   from "crypto";
import Feedback from "./feedback.model.js";

const SCORE_MAP = { Excelente: 5, Boa: 4, Regular: 2, Fraca: 1 };

/* ── helpers ──────────────────────────────────────────────────── */
function periodoParaFiltro(periodo) {
  const now = new Date();
  const from = new Date(now);
  switch (periodo) {
    case "dia":    from.setHours(0, 0, 0, 0); break;
    case "semana": from.setDate(now.getDate() - now.getDay() + 1); from.setHours(0, 0, 0, 0); break;
    case "mes":    from.setDate(1); from.setHours(0, 0, 0, 0); break;
    case "ano":    from.setMonth(0, 1); from.setHours(0, 0, 0, 0); break;
    default:       return {};
  }
  return { respondidoEm: { $gte: from, $lte: now } };
}

function calcScore(ratings = {}) {
  const campos = ["pontualidade", "conducao", "simpatia", "limpeza", "qualidadeGeral"];
  const vals   = campos.map(c => SCORE_MAP[ratings[c]] || 0).filter(Boolean);
  if (!vals.length) return 0;
  return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
}

/* ════════════════════════════════════════════════════════════════
   CRIAR TOKEN
════════════════════════════════════════════════════════════════ */
export async function criarFeedbackToken(params) {
  const { reservaId, parceiroId, partnerName, partnerType, guestName, guestEmail, motoristaNome, motoristaId, categoria, partida, destino, datahora } = params;
  const token     = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const fb = await Feedback.create({ token, expiresAt, reservaId, parceiroId, partnerName, partnerType, guestName, guestEmail, motoristaNome, motoristaId, categoria, partida, destino, datahora });
  return { token: fb.token, id: fb._id };
}

/* ════════════════════════════════════════════════════════════════
   CARREGAR POR TOKEN
════════════════════════════════════════════════════════════════ */
export async function getByToken(token) {
  if (!token) throw Object.assign(new Error("Token obrigatório."), { status: 400 });
  const fb = await Feedback.findOne({ token }).lean();
  if (!fb)                                                     throw Object.assign(new Error("Token inválido ou expirado."),  { status: 404 });
  if (fb.status === "respondido")                              throw Object.assign(new Error("Feedback já submetido."),       { status: 409 });
  if (fb.status === "expirado" || fb.expiresAt < new Date())  throw Object.assign(new Error("Link de feedback expirado."),   { status: 410 });
  return { partnerName: fb.partnerName, partnerType: fb.partnerType, guestName: fb.guestName, categoria: fb.categoria, partida: fb.partida, destino: fb.destino, datahora: fb.datahora, motoristaNome: fb.motoristaNome };
}

/* ════════════════════════════════════════════════════════════════
   SUBMETER RESPOSTA
════════════════════════════════════════════════════════════════ */
export async function responderFeedback(token, { ratings, comentario }) {
  if (!token)   throw Object.assign(new Error("Token obrigatório."), { status: 400 });
  if (!ratings) throw Object.assign(new Error("Ratings obrigatórios."), { status: 400 });

  const fb = await Feedback.findOne({ token });
  if (!fb)                          throw Object.assign(new Error("Token inválido."),     { status: 404 });
  if (fb.status === "respondido")   throw Object.assign(new Error("Já submetido."),       { status: 409 });
  if (fb.expiresAt < new Date())    throw Object.assign(new Error("Link expirado."),      { status: 410 });

  fb.ratings      = ratings;
  fb.comentario   = comentario || "";
  fb.scoreGeral   = calcScore(ratings);
  fb.status       = "respondido";
  fb.respondidoEm = new Date();
  await fb.save();
  return { ok: true };
}

/* ════════════════════════════════════════════════════════════════
   LISTAR CLASSIFICAÇÕES
════════════════════════════════════════════════════════════════ */
export async function listarClassificacoes({ parceiroId, periodo, pagina = 1, limite = 15, ordem = "recente" }) {
  const filtro = { status: "respondido", ...(parceiroId ? { parceiroId } : {}), ...periodoParaFiltro(periodo) };
  const sortMap = { recente: { respondidoEm: -1 }, melhor: { scoreGeral: -1, respondidoEm: -1 }, pior: { scoreGeral: 1, respondidoEm: -1 } };
  const sort  = sortMap[ordem] || sortMap.recente;
  const skip  = (pagina - 1) * limite;
  const total = await Feedback.countDocuments(filtro);
  const items = await Feedback.find(filtro).sort(sort).skip(skip).limit(limite)
    .select("guestName partnerName partida destino respondidoEm scoreGeral ratings comentario categoria motoristaNome").lean();

  const agg   = await Feedback.aggregate([
    { $match: filtro },
    { $group: { _id: null, totalRespostas: { $sum: 1 }, mediaGeral: { $avg: "$scoreGeral" }, recomendaSim: { $sum: { $cond: [{ $eq: ["$ratings.recomendaria", "Sim"] }, 1, 0] } } } }
  ]);
  const stats = agg[0] || {};

  return {
    total, pagina, totalPaginas: Math.ceil(total / limite), temMais: pagina * limite < total,
    media: {
      geral:        stats.mediaGeral ? Number(stats.mediaGeral.toFixed(2)) : 0,
      recomendaria: stats.totalRespostas ? Math.round((stats.recomendaSim / stats.totalRespostas) * 100) : 0,
    },
    items: items.map(fb => ({
      _id: fb._id, guestName: fb.guestName || "Hóspede", partnerName: fb.partnerName || "—",
      partida: fb.partida || "—", destino: fb.destino || "—", categoria: fb.categoria || "",
      motoristaNome: fb.motoristaNome || "", respondidoEm: fb.respondidoEm,
      scoreGeral: fb.scoreGeral || 0, ratings: fb.ratings || {}, comentario: fb.comentario || "",
    })),
  };
}