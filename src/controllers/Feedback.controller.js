// src/modules/feedback/feedback.controller.js
import * as svc from "./feedback.service.js";

/* ─────────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────────── */

/** Extrai parceiroId do objeto colocado pelo authValidador.
 *  O middleware pode definir req.parceiro OU req.parceiroId
 *  consoante a versão do middleware instalada.                    */
function getParceiroId(req) {
  return req.parceiro?._id
    ?? req.parceiro?.id
    ?? req.parceiroId
    ?? null;
}

function parseQuery(query) {
  const { periodo = "all", pagina = "1", limite = "15", ordem = "recente" } = query;
  return {
    periodo,
    pagina:  Math.max(1,  parseInt(pagina,  10) || 1),
    limite:  Math.min(50, parseInt(limite,  10) || 15),
    ordem,
  };
}

/* ─────────────────────────────────────────────────────────────────
   HÓSPEDE — acesso via token único
───────────────────────────────────────────────────────────────── */

export async function getByToken(req, res) {
  try {
    const feedback = await svc.getByToken(req.params.token);
    res.json({ success: true, feedback });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

export async function responder(req, res) {
  try {
    const { ratings, comentario } = req.body;
    if (!ratings || typeof ratings !== "object")
      return res.status(400).json({ success: false, message: "Ratings obrigatórios." });

    await svc.responderFeedback(req.params.token, { ratings, comentario });
    res.json({ success: true, message: "Avaliação submetida com sucesso." });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
}

/* ─────────────────────────────────────────────────────────────────
   PARCEIRO — cada hotel vê APENAS os seus próprios feedbacks
   parceiroId vem obrigatoriamente do middleware authValidador.
   Se por algum motivo não existir → 403 (nunca expõe dados alheios)
───────────────────────────────────────────────────────────────── */

export async function listarClassificacoes(req, res, next) {
  try {
    const parceiroId = getParceiroId(req);

    if (!parceiroId) {
      // authValidador falhou silenciosamente — recusar sempre
      return res.status(403).json({
        ok: false,
        message: "Sessão de parceiro inválida. Faça login novamente.",
      });
    }

    const data = await svc.listarClassificacoes({
      parceiroId,           // ← SEMPRE presente — filtra só os deste hotel
      ...parseQuery(req.query),
    });

    res.json({ ok: true, ...data });
  } catch (err) {
    next(err);
  }
}

/* ─────────────────────────────────────────────────────────────────
   ADMIN — visão global (sem filtro de parceiro)
   Protegido por authAdmin — só backoffice acede
───────────────────────────────────────────────────────────────── */

export async function listarClassificacoesAdmin(req, res, next) {
  try {
    const data = await svc.listarClassificacoes({
      parceiroId: null,     // ← null = sem filtro, vê tudo
      ...parseQuery(req.query),
    });
    res.json({ ok: true, ...data });
  } catch (err) {
    next(err);
  }
}

/* ─────────────────────────────────────────────────────────────────
   INTERNO — criar token após viagem finalizada
───────────────────────────────────────────────────────────────── */

export async function criarToken(req, res, next) {
  try {
    const result = await svc.criarFeedbackToken(req.body);
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
}