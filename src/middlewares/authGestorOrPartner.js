// src/middlewares/authGestorOrPartner.js
// ══════════════════════════════════════════════════════════════
// Middleware híbrido: aceita X-Api-Key OU cookie de gestor.
//
// USO:
//   • Parceiros externos (integração API): enviam X-Api-Key
//   • Gestor logado no painel gestor-frota.html: cookie colab_token
//
// EM AMBOS OS CASOS preenche req.partner com o formato compatível
// com o middleware original (authPartnerApi) para que as rotas
// que fazem req.partner.id / req.partner.empresa / etc. funcionem
// SEM ALTERAÇÕES ao código existente.
//
// SEGURANÇA:
//   • Verifica sempre pelo menos um dos dois métodos
//   • Rejeita se ambos ausentes ou inválidos
//   • Cookie de gestor exige aprovado=true (bloqueia contas pendentes)
//   • X-Api-Key delega ao authPartnerApi original (inclusive
//     verificação de permissões submit:driver / submit:vehicle)
//   • Gestor logado tem permissões IMPLÍCITAS submit:driver e
//     submit:vehicle — é dono da sua própria frota, não faz sentido
//     ter de configurar permissões para si próprio.
// ══════════════════════════════════════════════════════════════

import jwt from "jsonwebtoken";
import Colaborador from "../models/colaboradores.js";
import { authPartnerApi } from "./authPartnerApi.js";

function getJwtSecret() {
  return String(process.env.JWT_SECRET || process.env.COLAB_JWT_SECRET || "").trim();
}

export async function authGestorOrPartner(req, res, next) {
  // ── Caminho 1: X-Api-Key (parceiros externos) ─────────────
  // Se o cliente enviou X-Api-Key OU Authorization Bearer, é
  // integração de API — delegamos ao middleware original que
  // já valida chave + permissões + preenche req.partner.
  const hasApiKey =
    req.headers["x-api-key"] ||
    req.headers["x-apikey"] ||
    (req.headers["authorization"] || "").toLowerCase().startsWith("bearer ");

  if (hasApiKey) {
    return authPartnerApi(req, res, next);
  }

  // ── Caminho 2: Cookie de gestor autenticado ───────────────
  const token = req.cookies?.colab_token;
  if (!token) {
    return res.status(401).json({
      ok:      false,
      code:    "AUTH_MISSING",
      message: 'Autenticação em falta. Faça login como gestor ou envie X-Api-Key.',
    });
  }

  const secret = getJwtSecret();
  if (!secret) {
    console.error("[authGestorOrPartner] JWT_SECRET não configurado!");
    return res.status(500).json({ ok: false, message: "Configuração inválida." });
  }

  let payload;
  try { payload = jwt.verify(token, secret); }
  catch {
    return res.status(401).json({
      ok:      false,
      code:    "SESSION_EXPIRED",
      message: "Sessão expirada. Faça login de novo.",
    });
  }

  if (payload?.typ !== "colaborador_session") {
    return res.status(401).json({ ok: false, code: "TOKEN_INVALID", message: "Token inválido." });
  }

  const colab = await Colaborador.findById(payload.id).lean();
  if (!colab) {
    return res.status(401).json({ ok: false, message: "Colaborador não encontrado." });
  }
  if (!colab.aprovado) {
    return res.status(403).json({
      ok:      false,
      code:    "ACCOUNT_PENDING",
      message: "A sua conta ainda não foi aprovada. Aguarde validação.",
    });
  }

  // Preencher req.partner no MESMO formato que authPartnerApi.
  // Assim as rotas existentes (validationSubmissions.routes.js) usam
  // req.partner.id/empresa/email sem qualquer alteração.
  //
  // O gestor logado tem permissões IMPLÍCITAS submit:driver + submit:vehicle
  // (é dono da sua frota — não faz sentido pedir-lhe permissões para
  // submeter os seus próprios motoristas/veículos). Um gestor que só
  // deveria submeter motoristas mas não veículos é caso empresarial
  // muito improvável — se surgir, criamos uma flag no Colaborador.
  req.partner = {
    id:         String(colab._id),
    empresa:    colab.empresa || colab.nome || "",
    email:      colab.email,
    ambiente:   process.env.NODE_ENV === "production" ? "producao" : "desenvolvimento",
    permissoes: ["submit:driver", "submit:vehicle"],
    webhookUrl: null,
    // Marcador para logs — permite distinguir tráfego API vs painel gestor
    source:     "gestor_cookie",
  };

  next();
}

export default authGestorOrPartner;
