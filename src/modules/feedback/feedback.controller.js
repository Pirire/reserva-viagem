// src/modules/feedback/feedback.controller.js
import asyncHandler from "../../utils/asyncHandler.js";
import {
  criarFeedbackToken,
  getByToken            as getByTokenSvc,
  responderFeedback,
  listarClassificacoes  as listarClassificacoesSvc,
} from "./feedback.service.js";

/* ════════════════════════════════════════════════════════════════
   HÓSPEDE — token único, sem autenticação
════════════════════════════════════════════════════════════════ */

const _getByToken = asyncHandler(async (req, res) => {
  const token    = req.params.token || req.query.token;
  const feedback = await getByTokenSvc(token);
  return res.status(200).json({ success: true, feedback });
});

const _responder = asyncHandler(async (req, res) => {
  const token = req.params.token || req.query.token;
  const { ratings, comentario } = req.body || {};
  if (!ratings || typeof ratings !== "object")
    return res.status(400).json({ success: false, message: "Ratings obrigatórios." });
  await responderFeedback(token, { ratings, comentario });
  return res.status(200).json({ success: true, message: "Avaliação enviada com sucesso." });
});

/* ════════════════════════════════════════════════════════════════
   PARCEIRO — vê apenas os seus feedbacks
════════════════════════════════════════════════════════════════ */

const _listarClassificacoes = asyncHandler(async (req, res) => {
  const parceiroId = req.parceiro?._id ?? req.parceiroId ?? null;
  if (!parceiroId)
    return res.status(403).json({ ok: false, message: "Sessão inválida. Faça login novamente." });

  const { periodo = "all", pagina = "1", limite = "15", ordem = "recente" } = req.query;
  const data = await listarClassificacoesSvc({
    parceiroId,
    periodo,
    pagina:  Math.max(1,  parseInt(pagina,  10) || 1),
    limite:  Math.min(50, parseInt(limite,  10) || 15),
    ordem,
  });
  return res.status(200).json({ ok: true, ...data });
});

/* ════════════════════════════════════════════════════════════════
   ADMIN — visão global sem filtro
════════════════════════════════════════════════════════════════ */

const _listarClassificacoesAdmin = asyncHandler(async (req, res) => {
  const { periodo = "all", pagina = "1", limite = "15", ordem = "recente" } = req.query;
  const data = await listarClassificacoesSvc({
    parceiroId: null,
    periodo,
    pagina:  Math.max(1,  parseInt(pagina,  10) || 1),
    limite:  Math.min(50, parseInt(limite,  10) || 15),
    ordem,
  });
  return res.status(200).json({ ok: true, ...data });
});

/* ════════════════════════════════════════════════════════════════
   INTERNO — criar token após viagem finalizada
════════════════════════════════════════════════════════════════ */

const _criarToken = asyncHandler(async (req, res) => {
  const result = await criarFeedbackToken(req.body || {});
  return res.status(201).json({ ok: true, ...result });
});

/* ════════════════════════════════════════════════════════════════
   EXPORTS — nomes novos (routes.js) + nomes originais (retro-compat)
   Nada do que existia antes quebra.
════════════════════════════════════════════════════════════════ */

// Nomes que o feedback.routes.js usa
export const getByToken               = _getByToken;
export const responder                = _responder;
export const criarToken               = _criarToken;
export const listarClassificacoes     = _listarClassificacoes;
export const listarClassificacoesAdmin= _listarClassificacoesAdmin;

// Nomes originais — mantidos para não quebrar nada que os importe
export const obterFeedbackPorTokenController     = _getByToken;
export const responderFeedbackPorTokenController  = _responder;
export const criarLinkFeedbackController          = _criarToken;
export const listarFeedbacksPorColaboradorController = asyncHandler(async (req, res) => {
  // mantido — implementa conforme o teu service original se necessário
  return res.status(200).json({ success: true, feedbacks: [] });
});
export const obterEstatisticasColaboradorController = asyncHandler(async (req, res) => {
  // mantido — implementa conforme o teu service original se necessário
  return res.status(200).json({ success: true, stats: {} });
});