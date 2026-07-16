// src/modules/feedback/feedback.routes.js
import { Router }       from "express";
import authValidador    from "../../middlewares/authValidador.js";
import authAdmin        from "../../middlewares/authAdmin.js";
import * as ctrl        from "./feedback.controller.js";

const router = Router();

/* ════════════════════════════════════════════════════════════════
   PÚBLICAS — hóspede acede via token único (sem sessão)
════════════════════════════════════════════════════════════════ */

// GET  /api/feedback/token/:token         → carrega formulário
router.get("/token/:token", ctrl.getByToken);

// POST /api/feedback/token/:token/respond → submete avaliação
router.post("/token/:token/respond", ctrl.responder);

/* ════════════════════════════════════════════════════════════════
   PROTEGIDAS — parceiro autenticado (cookie httpOnly)
   authValidador lê o cookie de sessão do parceiro e define
   req.parceiro = { _id, empresa, email, ... }
   Cada parceiro só vê os feedbacks criados com o seu parceiroId.
════════════════════════════════════════════════════════════════ */

// GET /api/feedback/classificacoes
//   ?periodo = all | ano | mes | semana | dia   (default: all)
//   ?pagina  = 1                                (default: 1)
//   ?limite  = 15                               (default: 15, max: 50)
//   ?ordem   = recente | melhor | pior          (default: recente)
router.get("/classificacoes", authValidador, ctrl.listarClassificacoes);

/* ════════════════════════════════════════════════════════════════
   INTERNAS — admin (gestão global, vê todos os parceiros)
════════════════════════════════════════════════════════════════ */

// GET  /api/feedback/admin/classificacoes   → sem filtro de parceiro
router.get("/admin/classificacoes", authAdmin, ctrl.listarClassificacoesAdmin);

// POST /api/feedback/criar-token            → criar token após viagem
router.post("/criar-token", authAdmin, ctrl.criarToken);

export default router;