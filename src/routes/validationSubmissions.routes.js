import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import nodemailer from "nodemailer";

import ValidationSubmission from "../models/ValidationSubmission.js";
import Motorista from "../models/Motorista.js";
import Veiculo from "../models/Veiculo.js";
import VehicleCategoryRule from "../models/VehicleCategoryRule.js";
import authPartnerApi from "../middlewares/authPartnerApi.js";
import authGestorOrPartner from "../middlewares/authGestorOrPartner.js";
import authValidador from "../middlewares/authValidador.js";

const router = Router();
console.log("✅ validationSubmissions.routes.js carregado");

/* =========================================================
   RECONHECIMENTO AUTOMÁTICO DE CATEGORIA (marca/modelo)
   Usa a mesma tabela e lógica de match do
   vehicleCategory.routes.js (/lookup), aqui chamada
   directamente ao model para não depender de um pedido HTTP
   interno. Devolve null se não houver regra para o veículo —
   nesse caso o veículo fica sem categoria automática e tem de
   ser classificado manualmente no admin-gestao.html (secção
   "Categorias por Marca/Modelo").
========================================================= */
async function resolverCategoriaVeiculo(marcaRaw, modeloRaw) {
  const marca  = String(marcaRaw  || "").trim().toLowerCase();
  const modelo = String(modeloRaw || "").trim().toLowerCase();
  if (!marca || !modelo) return null;

  try {
    let regra = await VehicleCategoryRule.findOne({ marca, modelo, activo: true }).lean();

    if (!regra) {
      // Match parcial (ex: "e-class" encontra "eclass"), igual ao /lookup
      const modeloClean = modelo.replace(/[-\s]/g, "");
      const regras = await VehicleCategoryRule.find({ marca, activo: true }).lean();
      regra = regras.find(r => r.modelo.replace(/[-\s]/g, "") === modeloClean) || null;
    }

    if (!regra) return null;

    return {
      categoria:  regra.categoriaDefault, // enum no Veiculo.js — nunca null
      capacidade: regra.capacidade,
    };
  } catch (err) {
    console.warn("⚠️ resolverCategoriaVeiculo falhou:", err?.message);
    return null;
  }
}

/* =========================================================
   MULTER
========================================================= */
const uploadsRoot = path.join(process.cwd(), "public", "uploads", "validation-submissions");
if (!fs.existsSync(uploadsRoot)) fs.mkdirSync(uploadsRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsRoot),
  filename: (_req, file, cb) => {
    const safe = String(file.originalname || "file").replace(/[^\w.\-]+/g, "_");
    const stamp = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${stamp}-${safe}`);
  },
});

const upload = multer({ storage });

/* =========================================================
   HELPERS
========================================================= */
function fileMeta(file) {
  if (!file) return null;
  return {
    filename: file.filename,
    mimetype: file.mimetype,
    size: file.size,
    url: `/uploads/validation-submissions/${file.filename}`,
    path: `public/uploads/validation-submissions/${file.filename}`,
  };
}

function parseJsonArray(value) {
  try {
    const arr = JSON.parse(String(value || "[]"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function actorFromRequest(req) {
  const bearer =
    req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim()
      : "";

  const token =
    bearer ||
    String(req.cookies?.admin_token || "").trim() ||
    String(req.cookies?.token || "").trim();

  if (!token) {
    return { id: "", nome: "Sistema", tipo: "system" };
  }

  try {
    const secret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;
    const payload = jwt.verify(token, secret);
    return {
      id:   String(payload?._id || payload?.id || payload?.sub || ""),
      nome: String(payload?.nome || payload?.name || payload?.user || "Operador"),
      tipo: String(payload?.tipo || payload?.typ || "operador"),
    };
  } catch {
    return { id: "", nome: "Sistema", tipo: "system" };
  }
}

function normalizeDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeDecision(value) {
  const d = String(value || "").trim().toLowerCase();
  if (d === "approve")               return "approve";
  if (d === "request_new_document")  return "request_new_document";
  if (d === "reject")                return "reject";
  return "";
}

function isSingleDocumentObject(doc) {
  return !!doc && typeof doc === "object" && !Array.isArray(doc) &&
    ("file" in doc || "meta" in doc || "validade" in doc);
}

function getSubmissionRequiredDocumentEntries(submission) {
  const docs = submission?.documents || {};
  const out = [];

  if (submission?.type === "driver") {
    const possible = [
      { key: "fotoRosto",       label: "Foto rosto",        value: docs.fotoRosto },
      { key: "cc",              label: "CC",                 value: docs.cc },
      { key: "tResidencia",     label: "T. residência",      value: docs.tResidencia },
      { key: "cartaConducao",   label: "Carta condução",     value: docs.cartaConducao },
      { key: "tvde",            label: "TVDE",               value: docs.tvde },
      { key: "registoCriminal", label: "Registo criminal",   value: docs.registoCriminal },
    ];
    for (const item of possible) {
      if (isSingleDocumentObject(item.value) && item.value?.file?.url) {
        out.push({ key: item.key, label: item.label, url: item.value.file.url });
      }
    }
  }

  if (submission?.type === "vehicle") {
    const possible = [
      { key: "dua",     label: "DUA",               value: docs.dua },
      { key: "seguro",  label: "Seguro / Carta Verde", value: docs.seguro },
      { key: "inspecao",label: "Inspeção",            value: docs.inspecao },
    ];
    for (const item of possible) {
      if (isSingleDocumentObject(item.value) && item.value?.file?.url) {
        out.push({ key: item.key, label: item.label, url: item.value.file.url });
      }
    }
    if (Array.isArray(docs.fotos)) {
      docs.fotos.forEach((foto, i) => {
        if (foto?.url) out.push({ key: `fotos_${i}`, label: `Foto veículo #${i + 1}`, url: foto.url });
      });
    }
  }

  return out;
}

function computeSubmissionStatusFromDocuments(requiredDocs, decisions) {
  const map = new Map(
    (Array.isArray(decisions) ? decisions : []).map((d) => [
      String(d?.key || "").trim(),
      normalizeDecision(d?.decision),
    ])
  );

  if (!requiredDocs.length) return "pendente";

  for (const doc of requiredDocs) {
    if (map.get(doc.key) === "reject") return "recusado";
  }
  for (const doc of requiredDocs) {
    if (map.get(doc.key) === "request_new_document") return "pendente_novo_envio";
  }

  const allApproved = requiredDocs.every((doc) => map.get(doc.key) === "approve");
  if (allApproved) return "validado";

  return "pendente";
}

function buildDecisionSummary(finalDocuments) {
  return {
    approved: finalDocuments.filter((d) => d.decision === "approve"),
    resend:   finalDocuments.filter((d) => d.decision === "request_new_document"),
    rejected: finalDocuments.filter((d) => d.decision === "reject"),
  };
}

/* =========================================================
   EMAIL — TRANSPORTER
========================================================= */
async function sendEmail({ to, subject, html }) {
  if (!to) {
    console.warn("⚠️ [sendEmail] sem destinatário — email não enviado.");
    return;
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn(`⚠️ [sendEmail] SMTP não configurado (SMTP_HOST/SMTP_USER/SMTP_PASS em falta no .env) — email para ${to} NÃO foi enviado.`);
    return;
  }
  try {
    const transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || "false") === "true",
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
    });
    console.log(`✅ [sendEmail] enviado para ${to} — "${subject}"`);
  } catch (err) {
    // ANTES: este erro era engolido em silêncio (chamado sempre via
    // Promise.allSettled), por isso nunca havia nenhum sinal no
    // terminal de que o email de activação do motorista (ou
    // qualquer outro) tinha falhado a enviar.
    console.error(`❌ [sendEmail] falhou para ${to}:`, err?.message);
  }
}

/* =========================================================
   EMAIL — RESULTADO DE VALIDAÇÃO (documentos recusados / reenvio)
========================================================= */
function buildEmailHtmlResultado({ submission, status, finalDocuments, observacoesGerais }) {
  const { approved, resend, rejected } = buildDecisionSummary(finalDocuments);

  const list = (items) => {
    if (!items.length) return "<li>Nenhum</li>";
    return items.map((item) => `<li><b>${item.label || item.key}</b>${item.reasons ? ` — ${item.reasons}` : ""}</li>`).join("");
  };

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.6;max-width:600px">
      <h2 style="margin:0 0 16px">Resultado da Validação — REALMETROPOLIS</h2>
      <p><b>Estado:</b> ${status}</p>
      <p><b>Motorista/Veículo:</b> ${submission.ownerName || "—"}</p>
      <p><b>Gestor:</b> ${submission.gestorNome || "—"}</p>
      <h3>✅ Documentos aprovados</h3><ul>${list(approved)}</ul>
      <h3>🔄 Documentos para novo envio</h3><ul>${list(resend)}</ul>
      <h3>❌ Documentos recusados</h3><ul>${list(rejected)}</ul>
      <h3>Observações</h3><p>${observacoesGerais || "Sem observações."}</p>
    </div>
  `;
}

/* =========================================================
   ✅ EMAIL — ACTIVAÇÃO DE CONTA (enviado apenas quando VALIDADO)
   Este é o email que faltava — inclui o botão "Activar Conta"
========================================================= */
function buildEmailHtmlActivacao({ nome, activationLink }) {
  return `
  <!DOCTYPE html>
  <html lang="pt">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#050507;font-family:'Segoe UI',Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#050507;padding:40px 16px;">
      <tr><td align="center">
        <table width="100%" style="max-width:520px;background:#0a0b0e;border:1px solid rgba(255,255,255,.1);border-radius:18px;overflow:hidden;">

          <!-- Cabeçalho -->
          <tr>
            <td style="background:linear-gradient(135deg,#0d0e11,#07080a);padding:28px 32px 22px;border-bottom:1px solid rgba(255,255,255,.07);">
              <table width="100%" cellpadding="0" cellspacing="0"><tr>
                <td style="vertical-align:middle;">
                  <div style="width:40px;height:40px;border-radius:50%;border:1.5px solid rgba(212,216,223,.35);background:rgba(212,216,223,.06);display:inline-block;text-align:center;line-height:40px;font-size:11px;font-weight:700;color:#c4c9d4;letter-spacing:.1em;">RM</div>
                  <span style="margin-left:12px;font-size:12px;font-weight:700;color:#c4c9d4;letter-spacing:.2em;text-transform:uppercase;vertical-align:middle;">REALMETROPOLIS</span>
                </td>
              </tr></table>
            </td>
          </tr>

          <!-- Corpo -->
          <tr>
            <td style="padding:32px 32px 28px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#fff;">
                🚗 Documentos Aprovados!
              </h1>
              <p style="margin:0 0 20px;font-size:14px;color:#8b93a0;line-height:1.6;">
                Olá <b style="color:#c4c9d4">${nome || "Motorista"}</b>,<br><br>
                Os seus documentos foram <b style="color:#19d68b">validados com sucesso</b>. 
                Já pode activar a sua conta e começar a receber viagens.
              </p>

              <!-- Badge de sucesso -->
              <div style="background:rgba(25,214,139,.06);border:1px solid rgba(25,214,139,.2);border-radius:12px;padding:16px 20px;margin-bottom:28px;">
                <p style="margin:0;font-size:13px;color:rgba(25,214,139,.9);line-height:1.7;">
                  ✅ Identidade verificada<br>
                  ✅ Carta de condução válida<br>
                  ✅ Documentação completa<br>
                  ✅ Conta aprovada para operar
                </p>
              </div>

              <!-- BOTÃO PRINCIPAL — o que faltava -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td align="center">
                    <a href="${activationLink}"
                       style="display:inline-block;padding:16px 40px;border-radius:14px;
                              background:linear-gradient(180deg,#dde2e8,#adb4be);
                              color:#060708;font-weight:700;font-size:15px;
                              text-decoration:none;letter-spacing:.06em;">
                      🔐 ACTIVAR CONTA E ENTRAR
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Instruções -->
              <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px 20px;margin-bottom:20px;">
                <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#c4c9d4;">Como activar:</p>
                <p style="margin:0;font-size:12px;color:#5b6370;line-height:1.8;">
                  1. Clique no botão acima<br>
                  2. Defina a sua palavra-passe<br>
                  3. Aceda à área do motorista<br>
                  4. Comece a receber viagens
                </p>
              </div>

              <!-- Link alternativo -->
              <p style="margin:0 0 6px;font-size:11px;color:#434a55;">Ou copie este link no browser:</p>
              <p style="margin:0;font-size:11px;color:#5b6370;word-break:break-all;background:rgba(255,255,255,.04);border-radius:8px;padding:10px 12px;">${activationLink}</p>
            </td>
          </tr>

          <!-- Rodapé -->
          <tr>
            <td style="padding:18px 32px;border-top:1px solid rgba(255,255,255,.06);">
              <p style="margin:0;font-size:11px;color:#434a55;text-align:center;">
                Este link é de uso único e expira em 48 horas.<br>
                REALMETROPOLIS · Serviço premium de transporte
              </p>
            </td>
          </tr>

        </table>
      </td></tr>
    </table>
  </body>
  </html>
  `;
}

/* =========================================================
   ✅ GERAR TOKEN DE ACTIVAÇÃO E GUARDAR NO MOTORISTA
   Chamado após todos os documentos serem aprovados.
========================================================= */
async function gerarTokenActivacao(motorista) {
  const secret = process.env.JWT_SECRET || "";
  if (!secret) throw new Error("JWT_SECRET não definido no .env");

  // Token JWT com 48h de validade
  const activationToken = jwt.sign(
    {
      typ:   "motorista_setup",
      id:    String(motorista._id),
      email: motorista.email,
    },
    secret,
    { expiresIn: "48h" }
  );

  // Guardar hash seguro no motorista (nunca o token em claro)
  const tokenHash = crypto.createHash("sha256").update(activationToken).digest("hex");
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  // CORRIGIDO: o schema real de Motorista.js não tem campo "convite"
  // — usa setupToken/setupTokenHash/setupTokenExpires/
  // setupTokenUsadoEm. Esta atribuição a "motorista.convite" nunca
  // persistia (Mongoose, em modo strict por defeito, ignora campos
  // não declarados no schema ao guardar), por isso o token nunca
  // ficava de facto gravado — o link no email parecia válido mas a
  // verificação em /definir-senha nunca encontrava o motorista.
  motorista.setupToken = activationToken;
  motorista.setupTokenHash = tokenHash;
  motorista.setupTokenExpires = expiresAt;
  motorista.setupTokenUsadoEm = null;
  // Garantir que a senha está vazia (obriga a definir)
  if (!motorista.passwordHash) motorista.passwordHash = "";

  await motorista.save();

  return activationToken;
}

/* =========================================================
   ✅ NOTIFICAR RESULTADO — VERSÃO CORRIGIDA
   - Se aprovado: envia email com botão de activação
   - Se recusado/reenvio: envia email com resumo de documentos
========================================================= */
async function notifyValidationResult({ submission, finalDocuments, observacoesGerais, activationLink }) {
  const status = String(submission.status || "").toUpperCase();
  const isApproved = submission.status === "validado";
  const jobs = [];

  if (isApproved && submission.type === "driver" && activationLink) {
    // ✅ Email de activação ao motorista — com botão "Activar Conta"
    if (submission.ownerEmail) {
      const html = buildEmailHtmlActivacao({
        nome:           submission.ownerName || "Motorista",
        activationLink,
      });
      jobs.push(
        sendEmail({
          to:      submission.ownerEmail,
          subject: "✅ Documentos aprovados — Active a sua conta REALMETROPOLIS",
          html,
        })
      );
    }

    // Notificar gestor com o resultado (sem link de activação)
    if (submission.gestorEmail) {
      const htmlGestor = buildEmailHtmlResultado({ submission, status, finalDocuments, observacoesGerais });
      jobs.push(
        sendEmail({
          to:      submission.gestorEmail,
          subject: `Motorista ${submission.ownerName || ""} — Documentos validados`,
          html:    htmlGestor,
        })
      );
    }
  } else {
    // Email de resultado (recusado ou reenvio) para gestor e motorista
    const html = buildEmailHtmlResultado({ submission, status, finalDocuments, observacoesGerais });
    const subject = `Resultado da validação — ${status}`;

    if (submission.gestorEmail) {
      jobs.push(sendEmail({ to: submission.gestorEmail, subject, html }));
    }
    if (submission.ownerEmail) {
      jobs.push(sendEmail({ to: submission.ownerEmail, subject, html }));
    }
  }

  await Promise.allSettled(jobs);
}

/* =========================================================
   ACTIVAR ENTIDADE REAL APÓS APROVAÇÃO
========================================================= */
async function activateRealEntityIfApproved(submission, actor, observacoes) {
  if (submission.status !== "validado") return null;

  if (submission.type === "driver") {
    let motorista = null;

    if (submission.entityRefId) {
      motorista = await Motorista.findById(submission.entityRefId);
    }

    const payload = submission.payload || {};
    const docs    = submission.documents || {};

    if (!motorista) {
      motorista = await Motorista.create({
        nome:      String(payload.nome     || submission.ownerName    || "").trim(),
        contacto:  String(payload.contacto || submission.ownerContact || "").trim(),
        email:     String(payload.email    || submission.ownerEmail   || "").trim().toLowerCase(),
        categoria: String(payload.categoria || payload.categorias?.[0] || "ECONOMICA").trim(),
        idiomas:   Array.isArray(payload.idiomas) ? payload.idiomas : [],
        documentos: docs,
        aprovacao: "aprovado",
        passwordHash: "",
        validacao: {
          status:          "aprovado",
          observacoes,
          validadoPorId:   actor.id,
          validadoPorNome: actor.nome,
          validadoEm:      new Date(),
          checklist:       {},
        },
        status: "Disponível",
        ativo:  true,
      });
    } else {
      motorista.nome      = String(payload.nome     || motorista.nome     || "").trim();
      motorista.contacto  = String(payload.contacto || motorista.contacto || "").trim();
      motorista.email     = String(payload.email    || motorista.email    || "").trim().toLowerCase();
      motorista.categoria = String(payload.categoria || payload.categorias?.[0] || motorista.categoria || "ECONOMICA").trim();
      motorista.idiomas   = Array.isArray(payload.idiomas) ? payload.idiomas : motorista.idiomas || [];
      motorista.documentos = docs;
      motorista.aprovacao  = "aprovado";
      motorista.validacao  = {
        ...(motorista.validacao || {}),
        status:          "aprovado",
        observacoes,
        validadoPorId:   actor.id,
        validadoPorNome: actor.nome,
        validadoEm:      new Date(),
      };
      motorista.ativo   = true;
      motorista.status  = motorista.status || "Disponível";
      await motorista.save();
    }

    submission.entityRefId = motorista._id;

    // ✅ Gerar token de activação e devolver o link
    const baseUrl         = String(process.env.FRONTEND_BASE_URL || process.env.FRONTEND_URL || "http://localhost:10000").replace(/\/$/, "");
    const activationToken = await gerarTokenActivacao(motorista);
    const activationLink  = `${baseUrl}/motorista-definir-senha.html?token=${encodeURIComponent(activationToken)}`;

    return activationLink;
  }

  if (submission.type === "vehicle") {
    let veiculo = null;

    if (submission.entityRefId) {
      veiculo = await Veiculo.findById(submission.entityRefId);
    }

    const payload = submission.payload || {};
    const docs    = submission.documents || {};

    const marcaFinal  = String(payload.marca  || veiculo?.marca  || "").trim();
    const modeloFinal = String(payload.modelo || veiculo?.modelo || "").trim();
    const categoriaResolvida = await resolverCategoriaVeiculo(marcaFinal, modeloFinal);

    if (!categoriaResolvida) {
      console.warn(`⚠️ Sem regra de categoria para "${marcaFinal} ${modeloFinal}" — veículo aprovado sem categoria automática. Classifique manualmente em admin-gestao.html.`);
    }

    if (!veiculo) {
      veiculo = await Veiculo.create({
        marca:     marcaFinal,
        modelo:    modeloFinal,
        matricula: String(payload.matricula || "").trim().toUpperCase(),
        // Só define categoria/capacidade se houve regra correspondente —
        // caso contrário deixa o schema aplicar o default ("economica"),
        // já que o campo é enum e não aceita null.
        ...(categoriaResolvida ? {
          categoria:  categoriaResolvida.categoria,
          capacidade: categoriaResolvida.capacidade,
        } : {}),
        documentos: {
          dua:      docs.dua?.file     || null,
          seguro:   docs.seguro?.file  || null,
          inspecao: docs.inspecao?.file|| null,
        },
        fotos:     Array.isArray(docs.fotos) ? docs.fotos : [],
        estado:    "aprovado",
        aprovacao: "aprovado",
        validacao: {
          status:          "aprovado",
          observacoes,
          validadoPorId:   actor.id,
          validadoPorNome: actor.nome,
          validadoEm:      new Date(),
          checklist:       {},
        },
      });
    } else {
      veiculo.marca      = marcaFinal;
      veiculo.modelo     = modeloFinal;
      veiculo.matricula  = String(payload.matricula || veiculo.matricula || "").trim().toUpperCase();
      // Só substitui a categoria se houve uma regra correspondente —
      // não apaga uma categoria já definida manualmente caso a regra
      // não exista (evita regressão silenciosa).
      if (categoriaResolvida) {
        veiculo.categoria  = categoriaResolvida.categoria;
        veiculo.capacidade = categoriaResolvida.capacidade;
      }
      veiculo.documentos = {
        dua:      docs.dua?.file      || veiculo.documentos?.dua      || null,
        seguro:   docs.seguro?.file   || veiculo.documentos?.seguro   || null,
        inspecao: docs.inspecao?.file || veiculo.documentos?.inspecao || null,
      };
      veiculo.fotos     = Array.isArray(docs.fotos) ? docs.fotos : veiculo.fotos || [];
      veiculo.estado    = "aprovado";
      veiculo.aprovacao = "aprovado";
      veiculo.validacao = {
        ...(veiculo.validacao || {}),
        status:          "aprovado",
        observacoes,
        validadoPorId:   actor.id,
        validadoPorNome: actor.nome,
        validadoEm:      new Date(),
      };
      await veiculo.save();
    }

    submission.entityRefId = veiculo._id;
  }

  return null; // veículos não têm link de activação
}

/* =========================================================
   BUILD DRIVER DOCUMENTS
========================================================= */
function buildDriverDocuments(req) {
  const files = req.files || {};
  const b     = req.body  || {};

  const docIdType = String(b.drvIdDocType || "").trim().toUpperCase();

  return {
    fotoRosto: {
      file: fileMeta(files.fotoRosto?.[0] || null),
      validade: null,
      meta: {},
    },
    cc: {
      file:    fileMeta(files.cc?.[0] || null),
      validade: normalizeDate(b.ccValidade),
      meta: {
        nome:            String(b.ccNome || "").trim(),
        numeroDocumento: String(b.ccNumero || "").trim(),
        tipo:            docIdType || "CC",
      },
    },
    tResidencia: {
      file:    fileMeta(files.tResidencia?.[0] || null),
      validade: normalizeDate(b.tResidenciaValidade),
      meta: {
        nome:            String(b.tResidenciaNome || "").trim(),
        numeroDocumento: String(b.tResidenciaNumero || "").trim(),
      },
    },
    cartaConducao: {
      file:    fileMeta(files.cartaConducao?.[0] || null),
      validade: normalizeDate(b.cartaConducaoValidade),
      meta: {
        nome:            String(b.cartaConducaoNome || "").trim(),
        numeroDocumento: String(b.cartaConducaoNumero || "").trim(),
      },
    },
    cartaConducaoVerso: {
      file:    fileMeta(files.cartaConducaoVerso?.[0] || null),
      validade: null,
      meta: {
        nome: String(b.cartaConducaoNome || "").trim(),
        numeroDocumento: String(b.cartaConducaoNumero || "").trim(),
      },
    },
    tvde: {
      file:    fileMeta(files.tvde?.[0] || null),
      validade: normalizeDate(b.tvdeValidade),
      meta: {
        nome:            String(b.tvdeNome || "").trim(),
        numeroDocumento: String(b.tvdeNumero || "").trim(),
      },
    },
    tvdeVerso: {
      file:    fileMeta(files.tvdeVerso?.[0] || null),
      validade: null,
      meta: {
        nome: String(b.tvdeNome || "").trim(),
        numeroDocumento: String(b.tvdeNumero || "").trim(),
      },
    },
    registoCriminal: {
      file:    fileMeta(files.registoCriminal?.[0] || null),
      validade: normalizeDate(b.registoCriminalValidade),
      meta: {},
    },
  };
}

/* =========================================================
   BUILD VEHICLE DOCUMENTS
========================================================= */
function buildVehicleDocuments(req) {
  const files = req.files || {};
  const b     = req.body  || {};

  return {
    dua: {
      file:    fileMeta(files.dua?.[0] || null),
      validade: normalizeDate(b.duaValidade),
      meta: {
        nome:            String(b.duaNome || "").trim(),
        numeroDocumento: String(b.duaNumero || "").trim(),
        tipo:            String(b.duaTipo || "DUA").trim(),
      },
    },
    duaVerso: {
      file:    fileMeta(files.duaVerso?.[0] || null),
      validade: null,
      meta: {
        tipo: String(b.duaTipo || "DUA").trim(),
      },
    },
    seguro: {
      file:    fileMeta(files.seguro?.[0] || null),
      validade: normalizeDate(b.seguroValidade),
      meta: {
        nome:            String(b.seguroNome || "").trim(),
        numeroDocumento: String(b.seguroNumero || "").trim(),
      },
    },
    inspecao: {
      file:    fileMeta(files.inspecao?.[0] || null),
      validade: normalizeDate(b.inspecaoValidade),
      meta: {
        nome:            String(b.inspecaoNome || "").trim(),
        numeroDocumento: String(b.inspecaoNumero || "").trim(),
      },
    },
    fotos: Array.isArray(files.fotos) ? files.fotos.map(fileMeta).filter(Boolean) : [],
  };
}

/* =========================================================
   CREATE DRIVER SUBMISSION
   POST /api/validation/submissions/driver
========================================================= */
router.post(
  "/submissions/driver",
  authGestorOrPartner,   // ← aceita cookie de gestor autenticado OU X-Api-Key
  upload.fields([
    { name: "fotoRosto",           maxCount: 1 },
    { name: "cc",                  maxCount: 1 },
    { name: "tResidencia",         maxCount: 1 },
    { name: "cartaConducao",       maxCount: 1 },
    { name: "cartaConducaoVerso",  maxCount: 1 },
    { name: "tvde",                maxCount: 1 },
    { name: "tvdeVerso",           maxCount: 1 },
    { name: "registoCriminal",     maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const b = req.body || {};

      const nome     = String(b.nome     || "").trim();
      const contacto = String(b.contacto || "").trim();
      const email    = String(b.email    || "").trim().toLowerCase();

      if (!nome || !contacto || !email) {
        return res.status(400).json({ ok: false, message: "nome, contacto e email são obrigatórios." });
      }

      // req.partner vem do authPartnerApi — identifica a empresa que fez o pedido
      const submission = await ValidationSubmission.create({
        type:   "driver",
        status: "pendente",

        gestorId:    req.partner.id,
        gestorNome:  String(b.gestorNome  || req.partner.empresa).trim(),
        gestorEmail: String(b.gestorEmail || req.partner.email).trim(),

        ownerName:    nome,
        ownerEmail:   email,
        ownerContact: contacto,

        submittedByRole: String(b.submittedByRole || "gestor_frota").trim(),
        submittedAt:     normalizeDate(b.submittedAt) || new Date(),

        payload: {
          nome,
          contacto,
          email,
          nif:         String(b.nif      || "").trim(),
          endereco:    String(b.endereco || "").trim(),
          iban:        String(b.iban     || "").trim(),
          categoria:   String(b.categoria || "").trim(),
          categorias:  parseJsonArray(b.categorias),
          idiomas:     parseJsonArray(b.idiomas),
          drvIdDocType: String(b.drvIdDocType || "").trim(),
        },

        documents: buildDriverDocuments(req),

        history: [{
          action:      "SUBMITTED",
          byNome:      String(b.gestorNome || "Gestor"),
          byTipo:      String(b.submittedByRole || "gestor_frota"),
          observacoes: "Submissão inicial",
        }],
      });

      return res.json({ ok: true, message: "Motorista enviado para validação.", item: submission });
    } catch (err) {
      console.error("❌ POST /submissions/driver:", err);
      return res.status(500).json({ ok: false, message: "Erro ao criar submissão de motorista." });
    }
  }
);

/* =========================================================
   CREATE VEHICLE SUBMISSION
   POST /api/validation/submissions/vehicle
========================================================= */
router.post(
  "/submissions/vehicle",
  authGestorOrPartner,   // ← aceita cookie de gestor autenticado OU X-Api-Key
  upload.fields([
    { name: "dua",      maxCount: 1 },
    { name: "duaVerso", maxCount: 1 },
    { name: "seguro",   maxCount: 1 },
    { name: "inspecao", maxCount: 1 },
    { name: "fotos",    maxCount: 12 },
  ]),
  async (req, res) => {
    try {
      const b = req.body || {};

      const marca     = String(b.marca     || "").trim();
      const modelo    = String(b.modelo    || "").trim();
      const ano       = String(b.ano       || "").trim();
      const matricula = String(b.matricula || "").trim().toUpperCase();
      const duaTipo   = String(b.duaTipo   || "DUA").trim();

      if (!marca || !modelo || !matricula) {
        return res.status(400).json({ ok: false, message: "marca, modelo e matrícula são obrigatórios." });
      }

      // req.partner vem do authPartnerApi — identifica a empresa que fez o pedido
      const submission = await ValidationSubmission.create({
        type:   "vehicle",
        status: "pendente",

        gestorId:    req.partner.id,
        gestorNome:  String(b.gestorNome  || req.partner.empresa).trim(),
        gestorEmail: String(b.gestorEmail || req.partner.email).trim(),

        ownerName:    `${marca} ${modelo}`.trim(),
        ownerEmail:   "",
        ownerContact: "",

        submittedByRole: String(b.submittedByRole || "gestor_frota").trim(),
        submittedAt:     normalizeDate(b.submittedAt) || new Date(),

        payload: { marca, modelo, ano, matricula, duaTipo },

        documents: buildVehicleDocuments(req),

        history: [{
          action:      "SUBMITTED",
          byNome:      String(b.gestorNome || "Gestor"),
          byTipo:      String(b.submittedByRole || "gestor_frota"),
          observacoes: "Submissão inicial",
        }],
      });

      return res.json({ ok: true, message: "Veículo enviado para validação.", item: submission });
    } catch (err) {
      console.error("❌ POST /submissions/vehicle:", err);
      return res.status(500).json({ ok: false, message: "Erro ao criar submissão de veículo." });
    }
  }
);

/* =========================================================
   LIST SUBMISSIONS
   GET /api/validation/submissions
========================================================= */
router.get("/submissions", authValidador, async (req, res) => {
  try {
    const type   = String(req.query.type   || "").trim().toLowerCase();
    const status = String(req.query.status || "").trim().toLowerCase();

    const filter = {};

    // FILTRAGEM POR SCOPE DO VALIDADOR:
    // Validador só vê o que o seu scope permite. "global" vê tudo.
    // Isto garante que o validador de motoristas nunca acede a
    // submissões de veículos (defesa em profundidade).
    const scope = String(req.validador?.scope || "").toLowerCase();
    if (scope === "motoristas") {
      filter.type = "driver";
    } else if (scope === "veiculos") {
      filter.type = "vehicle";
    }
    // Se o type foi pedido explicitamente, aplica só se coincidir com o scope
    if ((type === "driver" || type === "vehicle") && (!filter.type || filter.type === type)) {
      filter.type = type;
    }

    if (["pendente","validado","pendente_novo_envio","recusado"].includes(status)) filter.status = status;

    const items = await ValidationSubmission.find(filter)
      .sort({ gestorNome: 1, createdAt: -1 })
      .lean();

    return res.json({ ok: true, items });
  } catch (err) {
    console.error("❌ GET /submissions:", err);
    return res.status(500).json({ ok: false, message: "Erro ao listar submissões." });
  }
});

/* =========================================================
   GET SINGLE SUBMISSION
   GET /api/validation/submissions/:id
========================================================= */
router.get("/submissions/:id", authValidador, async (req, res) => {
  try {
    const item = await ValidationSubmission.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ ok: false, message: "Submissão não encontrada." });

    // Defesa em profundidade: validador só pode ver submissões do seu scope
    const scope = String(req.validador?.scope || "").toLowerCase();
    if (scope === "motoristas" && item.type !== "driver") {
      return res.status(403).json({ ok: false, message: "Sem permissão para esta submissão." });
    }
    if (scope === "veiculos" && item.type !== "vehicle") {
      return res.status(403).json({ ok: false, message: "Sem permissão para esta submissão." });
    }

    return res.json({ ok: true, item });
  } catch (err) {
    console.error("❌ GET /submissions/:id:", err);
    return res.status(500).json({ ok: false, message: "Erro ao carregar submissão." });
  }
});

/* =========================================================
   ✅ FINAL DECISION — VERSÃO CORRIGIDA
   POST /api/validation/submissions/:id/decision
   Agora gera token de activação e envia email correcto
========================================================= */
router.post("/submissions/:id/decision", authValidador, async (req, res) => {
  try {
    const actor      = actorFromRequest(req);
    const submission = await ValidationSubmission.findById(req.params.id);

    if (!submission) {
      return res.status(404).json({ ok: false, message: "Submissão não encontrada." });
    }

    const documents         = Array.isArray(req.body?.documents) ? req.body.documents : [];
    const observacoesGerais = String(req.body?.observacoes || "").trim();
    const workflow          = req.body?.workflow && typeof req.body.workflow === "object" ? req.body.workflow : {};

    const requiredDocs = getSubmissionRequiredDocumentEntries(submission);

    if (!requiredDocs.length) {
      return res.status(400).json({ ok: false, message: "Esta submissão não contém documentos para validar." });
    }
    if (!documents.length) {
      return res.status(400).json({ ok: false, message: "Envie a lista de documentos com a decisão final." });
    }

    const requiredKeys = new Set(requiredDocs.map((d) => d.key));
    const receivedMap  = new Map();

    for (const raw of documents) {
      const key      = String(raw?.key      || "").trim();
      const decision = normalizeDecision(raw?.decision);
      const reasons  = String(raw?.reasons  || "").trim();
      const label    = String(raw?.label    || "").trim();
      const url      = String(raw?.url      || "").trim();

      if (!key || !requiredKeys.has(key)) {
        return res.status(400).json({ ok: false, message: `Documento inválido: ${key || "sem-chave"}.` });
      }
      if (!decision) {
        return res.status(400).json({ ok: false, message: `Decisão inválida para: ${key}.` });
      }
      if ((decision === "request_new_document" || decision === "reject") && !reasons) {
        return res.status(400).json({ ok: false, message: `O documento ${key} precisa de motivo.` });
      }

      receivedMap.set(key, { key, decision, reasons, label, url, updatedAt: new Date() });
    }

    const missing = requiredDocs.filter((doc) => !receivedMap.has(doc.key));
    if (missing.length) {
      return res.status(400).json({ ok: false, message: `Faltam decisões para: ${missing.map((d) => d.label || d.key).join(", ")}.` });
    }

    const finalDocuments = requiredDocs.map((doc) => {
      const incoming = receivedMap.get(doc.key);
      return {
        key:      doc.key,
        label:    incoming?.label || doc.label || "",
        url:      incoming?.url   || doc.url   || "",
        decision: incoming.decision,
        reasons:  incoming.reasons || "",
        updatedAt: new Date(),
      };
    });

    const finalStatus = computeSubmissionStatusFromDocuments(requiredDocs, finalDocuments);

    submission.finalDecision = {
      documents:     finalDocuments,
      decidedAt:     new Date(),
      decidedById:   actor.id,
      decidedByNome: actor.nome,
      decidedByTipo: actor.tipo,
    };

    submission.status = finalStatus;

    submission.workflow = {
      activateEntity:              finalStatus === "validado",
      requestNewUpload:            finalStatus === "pendente_novo_envio",
      notifyGestor:                Boolean(workflow.notifyGestor ?? true),
      notifyOwner:                 Boolean(workflow.notifyOwner  ?? true),
      lockForValidators:           finalStatus === "recusado",
      adminMasterOnlyRevalidation: finalStatus === "recusado",
      activateEntityIfAllApproved: finalStatus === "validado",
      notifyGestorIfNeedResend:    finalStatus === "pendente_novo_envio",
      notifyOwnerIfNeedResend:     finalStatus === "pendente_novo_envio",
      lockRejectedForValidators:   finalStatus === "recusado",
    };

    submission.decision = {
      observacoes:   observacoesGerais,
      decidedAt:     new Date(),
      decidedById:   actor.id,
      decidedByNome: actor.nome,
      decidedByTipo: actor.tipo,
    };

    submission.history.push({
      action:      `FINAL_DECISION_${finalStatus.toUpperCase()}`,
      byId:        actor.id,
      byNome:      actor.nome,
      byTipo:      actor.tipo,
      observacoes: observacoesGerais,
      workflow:    submission.workflow,
    });

    // ✅ Activar entidade e obter link de activação (se for motorista aprovado)
    const activationLink = await activateRealEntityIfApproved(submission, actor, observacoesGerais);

    await submission.save();

    // ✅ Enviar email correcto — com link de activação se foi aprovado
    await notifyValidationResult({
      submission,
      finalDocuments,
      observacoesGerais,
      activationLink,
    });

    // ✅ Notificar empresa parceira via webhook (se configurado)
    notifyPartnerWebhook(submission, finalDocuments, observacoesGerais).catch(() => {});

    return res.json({
      ok:      true,
      message: "Decisão final registada com sucesso.",
      item:    submission,
      // útil para debug/teste
      activationLink: activationLink || undefined,
    });
  } catch (err) {
    console.error("❌ POST /submissions/:id/decision:", err);
    return res.status(500).json({ ok: false, message: "Erro ao registar decisão final." });
  }
});

/* =========================================================
   ✅ WEBHOOK — notificar empresa parceira quando decisão muda
   Chamado após notifyValidationResult. Não bloqueante.
========================================================= */
async function notifyPartnerWebhook(submission, finalDocuments, observacoesGerais) {
  try {
    const { default: PartnerApiKey } = await import("../models/PartnerApiKey.js");
    const partner = await PartnerApiKey.findById(submission.gestorId).lean();
    if (!partner?.webhookUrl || !partner?.ativo) return;

    const payload = {
      event:       "submission.decision",
      submissionId: String(submission._id),
      type:        submission.type,
      status:      submission.status,
      ownerName:   submission.ownerName,
      ownerEmail:  submission.ownerEmail,
      decidedAt:   new Date().toISOString(),
      documents:   finalDocuments.map(d => ({
        key:      d.key,
        label:    d.label,
        decision: d.decision,
        reasons:  d.reasons || "",
      })),
      observacoes: observacoesGerais || "",
    };

    const body      = JSON.stringify(payload);
    const timestamp = Date.now();
    const secret    = partner.webhookSecret || "";
    // Assinar com HMAC-SHA256 para a empresa verificar autenticidade
    const signature = secret
      ? "sha256=" + crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")
      : "";

    const response = await fetch(partner.webhookUrl, {
      method:  "POST",
      headers: {
        "Content-Type":           "application/json",
        "X-Realmetropolis-Event": "submission.decision",
        "X-Realmetropolis-Ts":    String(timestamp),
        ...(signature ? { "X-Realmetropolis-Signature": signature } : {}),
      },
      body,
      signal: AbortSignal.timeout(8000), // timeout de 8 segundos
    });

    if (!response.ok) {
      console.warn(`⚠️ Webhook parceiro ${partner.empresa} respondeu ${response.status}`);
    } else {
      console.log(`✅ Webhook enviado a ${partner.empresa}: ${submission.status}`);
    }
  } catch (err) {
    // webhook nunca bloqueia o fluxo principal
    console.warn("⚠️ Webhook parceiro falhou:", err?.message);
  }
}


/* =========================================================
   GET /api/validation/minhas-submissions
   Rota DEDICADA ao gestor: devolve APENAS as submissões
   que ele próprio fez, filtradas por gestorId.

   Segurança:
     • Protegida por authGestorOrPartner
     • gestorId FORÇADO no backend a partir do cookie/api-key
       — gestor nunca consegue ver submissões de outro gestor,
       mesmo tentando manipular query params.

   Query params opcionais:
     • ?type=driver|vehicle    filtra por tipo
     • ?status=pendente|validado|pendente_novo_envio|recusado
========================================================= */
router.get("/minhas-submissions", authGestorOrPartner, async (req, res) => {
  try {
    const gestorId = req.partner?.id
                  || req.partner?.gestorId
                  || req.partner?._id
                  || req.gestor?.id
                  || null;

    if (!gestorId) {
      return res.status(401).json({
        ok:      false,
        message: "Não foi possível identificar o gestor.",
      });
    }

    // Filtro FIXO: gestor só vê os seus. Nunca de outros.
    const gid = String(gestorId);
    const filter = {};
    try {
      const mongoose = (await import("mongoose")).default;
      if (mongoose.Types.ObjectId.isValid(gid)) {
        filter.$or = [
          { gestorId: gid },
          { gestorId: new mongoose.Types.ObjectId(gid) },
        ];
      } else {
        filter.gestorId = gid;
      }
    } catch (_) {
      filter.gestorId = gid;
    }

    const type   = String(req.query.type   || "").trim().toLowerCase();
    const status = String(req.query.status || "").trim().toLowerCase();

    if (type === "driver" || type === "vehicle") filter.type = type;
    if (["pendente","validado","pendente_novo_envio","recusado"].includes(status)) filter.status = status;

    const items = await ValidationSubmission.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ ok: true, items });
  } catch (err) {
    console.error("❌ GET /minhas-submissions:", err);
    return res.status(500).json({ ok: false, message: "Erro ao listar submissões." });
  }
});

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  ROTAS DEDICADAS AO PAINEL DO VALIDADOR (Fase 2 — Sistema B)           ║
// ║                                                                        ║
// ║  Estas rotas complementam /submissions e /submissions/:id/decision.    ║
// ║  Foram criadas com foco na simplicidade de consumo pelo frontend       ║
// ║  do validador (validacao-motoristas.html) e para separar cleanly       ║
// ║  responsabilidades: gestão externa via /submissions, painel humano     ║
// ║  via /painel-motoristas.                                               ║
// ║                                                                        ║
// ║  SEGURANÇA:                                                            ║
// ║    • Todas protegidas por authValidador                                ║
// ║    • Verificação de scope (motoristas apenas vê motoristas)            ║
// ║    • Aprovação cria Motorista real com setupToken (72h)                ║
// ║    • Email enviado ao motorista com link de activação                  ║
// ╚══════════════════════════════════════════════════════════════════════╝

const MOTIVOS_REJEICAO_VALIDOS = [
  "POUCO VISIVEL",
  "DOCUMENTO INCORRETO",
  "DOCUMENTO CADUCADO",
  "FOTO POUCO VISIVEL",
  "DOCUMENTO ALTERADO",
];

/* =========================================================
   GET /api/validation/painel-motoristas
   Lista TODOS os motoristas pendentes de validação, agregando:
     • Sistema B (ValidationSubmission com type=driver, status=pendente)
     • Sistema A (Motorista com aprovacao=pendente) — compatibilidade

   Cada item é normalizado num formato ÚNICO que o painel consome:
     { id, source, nome, contacto, email, gestorNome, submittedAt, ... }

   'source' distingue a origem para o painel saber que endpoint
   chamar ao aprovar/rejeitar (embora abaixo tenhamos rotas
   unificadas que tratam ambos os casos automaticamente).
========================================================= */
router.get("/painel-motoristas", authValidador, async (req, res) => {
  try {
    // Guarda de scope: só validador de motoristas ou global entra aqui
    const scope = String(req.validador?.scope || "").toLowerCase();
    if (scope !== "motoristas" && scope !== "global") {
      return res.status(403).json({
        ok:      false,
        message: "Sem permissão para validar motoristas.",
      });
    }

    // ── SISTEMA B ────────────────────────────────────────
    const submissoesB = await ValidationSubmission.find({
      type: "driver",
      status: "pendente",
    }).sort({ createdAt: -1 }).lean();

    // ── SISTEMA A (motoristas criados directamente, ainda pendentes) ─
    const motoristasA = await Motorista.find({
      aprovacao: "pendente",
    }).sort({ createdAt: -1 }).lean();

    // ── Normalizar ambos os formatos ──────────────────────
    const itemsB = submissoesB.map(s => ({
      id:            String(s._id),
      source:        "B",           // ValidationSubmission
      submissionId:  String(s._id),
      nome:          s.ownerName    || s.payload?.nome     || "",
      contacto:      s.ownerContact || s.payload?.contacto || "",
      email:         s.ownerEmail   || s.payload?.email    || "",
      gestorId:      s.gestorId     || null,
      gestorNome:    s.gestorNome   || "",
      gestorEmail:   s.gestorEmail  || "",
      submittedAt:   s.submittedAt  || s.createdAt,
      status:        s.status,
      documentos:    s.documents    || [],
      payload:       s.payload      || {},
    }));

    const itemsA = motoristasA.map(m => ({
      id:            String(m._id),
      source:        "A",           // Motorista directo
      motoristaId:   String(m._id),
      nome:          m.nome        || "",
      contacto:      m.contacto    || "",
      email:         m.email       || "",
      gestorId:      m.gestorId    || null,
      gestorNome:    m.gestor?.nome  || "",
      gestorEmail:   m.gestor?.email || "",
      submittedAt:   m.createdAt,
      status:        "pendente",
      documentos:    [],
      payload:       {
        nif:       m.nif       || "",
        idiomas:   m.idiomas   || [],
      },
    }));

    // Merge, mais recente primeiro
    const items = [...itemsB, ...itemsA].sort(
      (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)
    );

    return res.json({ ok: true, items, totals: {
      pendentes:     items.length,
      sistemaB:      itemsB.length,
      sistemaA:      itemsA.length,
    }});
  } catch (err) {
    console.error("❌ GET /painel-motoristas:", err);
    return res.status(500).json({ ok: false, message: "Erro ao listar motoristas." });
  }
});

/* =========================================================
   POST /api/validation/aprovar-motorista/:id

   Aprova o motorista. Detecta se é Sistema A ou B pela existência
   do documento em cada coleção.

   Sistema B (fluxo principal):
     1) Marca ValidationSubmission como "validado"
     2) Cria Motorista real em `motoristas` com dados da submissão
        - passwordHash: ""  (motorista define via link no email)
        - aprovacao:   "aprovado"
        - disponivel:  false (só true quando ficar online no motorista.html)
        - gestorId:    herdado da submissão
        - veiculoId:   null (motorista escolhe veículo depois)
        - idiomas:     inclui "Portugues" sempre (obrigatório)
        - NÃO grava categoria (categoria vem do veículo, não do motorista)
     3) Gera token de setup único, guarda hash + expira em 72h
     4) Envia email de aprovação com link de activação

   Sistema A (compatibilidade):
     - Motorista já existe. Só marca aprovacao=aprovado.
     - Também gera setup token e envia email.
========================================================= */
router.post("/aprovar-motorista/:id", authValidador, async (req, res) => {
  try {
    const scope = String(req.validador?.scope || "").toLowerCase();
    if (scope !== "motoristas" && scope !== "global") {
      return res.status(403).json({ ok: false, message: "Sem permissão." });
    }

    const idParam = String(req.params.id || "").trim();
    if (!idParam) return res.status(400).json({ ok: false, message: "ID em falta." });

    // Tentar Sistema B primeiro
    let submission = null;
    try { submission = await ValidationSubmission.findById(idParam); } catch (_) {}

    let motorista = null;
    let origem    = null;

    if (submission && submission.type === "driver" && submission.status === "pendente") {
      // ── SISTEMA B ───────────────────────────────────
      origem = "B";

      const p = submission.payload || {};

      // Idiomas — Português é sempre obrigatório
      const idiomasSubmit = Array.isArray(p.idiomas) ? p.idiomas : [];
      const idiomasUnicos = Array.from(new Set([
        "Portugues",
        ...idiomasSubmit.map(x => String(x || "").trim()).filter(Boolean),
      ]));

      // Verificar se já existe motorista com o mesmo email
      const emailNorm = String(submission.ownerEmail || p.email || "").toLowerCase().trim();
      let existente = null;
      if (emailNorm) {
        existente = await Motorista.findOne({ email: emailNorm });
      }
      if (existente) {
        return res.status(409).json({
          ok: false,
          message: "Já existe um motorista com este email.",
        });
      }

      motorista = new Motorista({
        nome:       submission.ownerName    || p.nome     || "",
        contacto:   submission.ownerContact || p.contacto || "",
        email:      emailNorm,
        nif:        p.nif || "",
        // ⚠️ NÃO grava 'categoria' nem 'categorias' — vêm do veículo
        idiomas:    idiomasUnicos,
        gestorId:   submission.gestorId  || null,
        gestor: {
          id:      submission.gestorId    ? String(submission.gestorId) : "",
          nome:    submission.gestorNome  || "",
          email:   submission.gestorEmail || "",
          empresa: "",
        },
        aprovacao:  "aprovado",
        disponivel: false,   // só true quando motorista ficar online
        passwordHash: "",    // definida depois via link no email
        status: "Aprovado — aguarda activação",
        validacao: {
          status:          "aprovado",
          observacoes:     "Aprovado pelo validador.",
          checklist:       req.body?.checklist || {},
          validadoEm:      new Date(),
          validadoPorId:   req.validador.id || "",
          validadoPorNome: req.validador.email || "",
        },
      });

      await motorista.save();

      // Marcar submissão como validada
      submission.status = "validado";
      submission.decidedAt = new Date();
      submission.decision = {
        by:     req.validador.email || req.validador.id,
        at:     new Date(),
        result: "aprovado",
      };
      submission.entityRefId = motorista._id;
      await submission.save();

    } else {
      // ── SISTEMA A (motorista já existe, é só aprovar) ─
      motorista = await Motorista.findById(idParam);
      if (!motorista) {
        return res.status(404).json({ ok: false, message: "Não encontrado." });
      }
      if (motorista.aprovacao !== "pendente") {
        return res.status(400).json({
          ok: false,
          message: `Motorista já está com estado "${motorista.aprovacao}".`,
        });
      }
      origem = "A";

      // Garantir Português nos idiomas
      const atuais = Array.isArray(motorista.idiomas) ? motorista.idiomas : [];
      motorista.idiomas = Array.from(new Set(["Portugues", ...atuais]));
      // Categoria — remove se estava ali por engano (categoria pertence ao veículo)
      motorista.categoria  = "";
      motorista.categorias = [];

      motorista.aprovacao = "aprovado";
      motorista.disponivel = false;
      motorista.status = "Aprovado — aguarda activação";
      motorista.validacao = {
        status:          "aprovado",
        observacoes:     "Aprovado pelo validador (Sistema A).",
        checklist:       req.body?.checklist || {},
        validadoEm:      new Date(),
        validadoPorId:   req.validador.id || "",
        validadoPorNome: req.validador.email || "",
      };
      await motorista.save();
    }

    // ── GERAR TOKEN DE SETUP (72h) ──────────────────────
    const tokenRaw   = crypto.randomBytes(32).toString("hex");
    const tokenHash  = crypto.createHash("sha256").update(tokenRaw).digest("hex");
    const expiresAt  = new Date(Date.now() + 72 * 60 * 60 * 1000);

    motorista.setupToken        = null;   // não guardamos raw
    motorista.setupTokenHash    = tokenHash;
    motorista.setupTokenExpires = expiresAt;
    motorista.setupTokenUsadoEm = null;
    motorista.passwordHash      = "";
    await motorista.save();

    // ── ENVIAR EMAIL ────────────────────────────────────
    if (motorista.email) {
      const baseUrl = process.env.APP_BASE_URL
        || process.env.BASE_URL
        || `http://localhost:${process.env.PORT || 10000}`;
      const link = `${baseUrl}/motorista-definir-senha.html?token=${tokenRaw}`;

      try {
        await enviarEmailAprovacaoMotorista({
          para:  motorista.email,
          nome:  motorista.nome,
          link,
        });
      } catch (emailErr) {
        console.warn("⚠️ Aprovação OK mas email falhou:", emailErr?.message);
        // Não bloqueamos aprovação — gestor pode reenviar email depois
      }
    }

    return res.json({
      ok: true,
      message: "Motorista aprovado. Email de activação enviado.",
      motoristaId: String(motorista._id),
      origem,
    });

  } catch (err) {
    console.error("❌ /aprovar-motorista:", err);
    return res.status(500).json({ ok: false, message: "Erro ao aprovar motorista." });
  }
});

/* =========================================================
   POST /api/validation/rejeitar-motorista/:id
   Body: { motivos: [...], comentario: "..." }

   Regras:
     • Pelo menos 1 motivo OU comentário livre preenchido
     • Motivos têm de estar na lista predefinida
     • Comentário é opcional mas complementa
========================================================= */
router.post("/rejeitar-motorista/:id", authValidador, async (req, res) => {
  try {
    const scope = String(req.validador?.scope || "").toLowerCase();
    if (scope !== "motoristas" && scope !== "global") {
      return res.status(403).json({ ok: false, message: "Sem permissão." });
    }

    const motivos    = Array.isArray(req.body?.motivos) ? req.body.motivos : [];
    const comentario = String(req.body?.comentario || "").trim();

    // Validar motivos
    const motivosNormalizados = motivos
      .map(m => String(m || "").trim().toUpperCase())
      .filter(m => MOTIVOS_REJEICAO_VALIDOS.includes(m));

    if (motivosNormalizados.length === 0 && !comentario) {
      return res.status(400).json({
        ok:      false,
        message: "Selecione pelo menos um motivo ou escreva uma observação.",
      });
    }

    const idParam = String(req.params.id || "").trim();
    if (!idParam) return res.status(400).json({ ok: false, message: "ID em falta." });

    // Tentar Sistema B primeiro
    let submission = null;
    try { submission = await ValidationSubmission.findById(idParam); } catch (_) {}

    let observacoesTexto = "";
    if (motivosNormalizados.length > 0) observacoesTexto += motivosNormalizados.join(" · ");
    if (comentario) {
      if (observacoesTexto) observacoesTexto += "  ";
      observacoesTexto += `Observação: ${comentario}`;
    }

    if (submission && submission.type === "driver" && submission.status === "pendente") {
      // ── SISTEMA B ───────────────────────────────────
      submission.status = "recusado";
      submission.decidedAt = new Date();
      submission.decision = {
        by:      req.validador.email || req.validador.id,
        at:      new Date(),
        result:  "recusado",
        motivos: motivosNormalizados,
        comentario,
      };
      await submission.save();

      // Notificar gestor por email (best-effort)
      if (submission.gestorEmail) {
        enviarEmailRejeicaoGestor({
          para:      submission.gestorEmail,
          nomeGestor: submission.gestorNome,
          nomeMotorista: submission.ownerName || submission.payload?.nome || "",
          motivos:   motivosNormalizados,
          comentario,
        }).catch(err => console.warn("⚠️ Email rejeição falhou:", err?.message));
      }

      return res.json({ ok: true, message: "Submissão rejeitada. Gestor notificado." });

    } else {
      // ── SISTEMA A ────────────────────────────────────
      const motorista = await Motorista.findById(idParam);
      if (!motorista) return res.status(404).json({ ok: false, message: "Não encontrado." });
      if (motorista.aprovacao !== "pendente") {
        return res.status(400).json({
          ok: false,
          message: `Motorista já está com estado "${motorista.aprovacao}".`,
        });
      }

      motorista.aprovacao = "rejeitado";
      motorista.validacao = {
        status:          "rejeitado",
        observacoes:     observacoesTexto,
        checklist:       {},
        validadoEm:      new Date(),
        validadoPorId:   req.validador.id || "",
        validadoPorNome: req.validador.email || "",
      };
      await motorista.save();

      return res.json({ ok: true, message: "Motorista rejeitado. Motivos guardados." });
    }
  } catch (err) {
    console.error("❌ /rejeitar-motorista:", err);
    return res.status(500).json({ ok: false, message: "Erro ao rejeitar motorista." });
  }
});

/* =========================================================
   GET /api/validation/painel-veiculos
   Lista TODOS os veículos pendentes de validação, agregando:
     • Sistema B (ValidationSubmission com type=vehicle, status=pendente)
     • Sistema A (Veiculo com aprovacao=pendente) — compatibilidade
========================================================= */
router.get("/painel-veiculos", authValidador, async (req, res) => {
  try {
    const scope = String(req.validador?.scope || "").toLowerCase();
    if (scope !== "veiculos" && scope !== "global") {
      return res.status(403).json({ ok: false, message: "Sem permissão para validar veículos." });
    }

    // Sistema B
    const submissoesB = await ValidationSubmission.find({
      type: "vehicle",
      status: "pendente",
    }).sort({ createdAt: -1 }).lean();

    // Sistema A (Veículos criados diretamente pendentes)
    const veiculosA = await Veiculo.find({
      aprovacao: "pendente",
    }).sort({ createdAt: -1 }).lean();

    const itemsB = submissoesB.map(s => ({
      id:            String(s._id),
      source:        "B",
      submissionId:  String(s._id),
      nome:          s.ownerName || `${s.payload?.marca || ""} ${s.payload?.modelo || ""}`.trim(),
      marca:         s.payload?.marca     || "",
      modelo:        s.payload?.modelo    || "",
      ano:           s.payload?.ano       || "",
      matricula:     s.payload?.matricula || "",
      duaTipo:       s.payload?.duaTipo   || "DUA",
      gestorId:      s.gestorId     || null,
      gestorNome:    s.gestorNome   || "",
      gestorEmail:   s.gestorEmail  || "",
      submittedAt:   s.submittedAt  || s.createdAt,
      status:        s.status,
      documentos:    s.documents    || [],
      payload:       s.payload      || {},
    }));

    const itemsA = veiculosA.map(v => ({
      id:            String(v._id),
      source:        "A",
      veiculoId:     String(v._id),
      nome:          `${v.marca || ""} ${v.modelo || ""}`.trim(),
      marca:         v.marca     || "",
      modelo:        v.modelo    || "",
      ano:           v.ano       || "",
      matricula:     v.matricula || "",
      gestorId:      v.gestorId  || null,
      gestorNome:    v.gestor?.nome  || "",
      gestorEmail:   v.gestor?.email || "",
      submittedAt:   v.createdAt,
      status:        "pendente",
      documentos:    [],
      payload:       {},
    }));

    const items = [...itemsB, ...itemsA].sort(
      (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)
    );

    return res.json({
      ok: true,
      items,
      totals: {
        pendentes: items.length,
        sistemaB:  itemsB.length,
        sistemaA:  itemsA.length,
      },
    });
  } catch (err) {
    console.error("❌ GET /painel-veiculos:", err);
    return res.status(500).json({ ok: false, message: "Erro ao listar veículos." });
  }
});

/* =========================================================
   POST /api/validation/aprovar-veiculo/:id
   Aprovar veículo: cria Veiculo real na coleção 'veiculos',
   marca submissão como validada, notifica gestor por email.
   NÃO envia email ao "veículo" (não existe login para veículo).
========================================================= */
router.post("/aprovar-veiculo/:id", authValidador, async (req, res) => {
  try {
    const scope = String(req.validador?.scope || "").toLowerCase();
    if (scope !== "veiculos" && scope !== "global") {
      return res.status(403).json({ ok: false, message: "Sem permissão." });
    }

    const idParam = String(req.params.id || "").trim();
    if (!idParam) return res.status(400).json({ ok: false, message: "ID em falta." });

    let submission = null;
    try { submission = await ValidationSubmission.findById(idParam); } catch (_) {}

    let veiculo = null;
    let origem  = null;

    if (submission && submission.type === "vehicle" && submission.status === "pendente") {
      origem = "B";
      const p = submission.payload || {};

      const matriculaNorm = String(p.matricula || "").trim().toUpperCase();
      // Verificar duplicado por matrícula
      if (matriculaNorm) {
        const existente = await Veiculo.findOne({ matricula: matriculaNorm });
        if (existente) {
          return res.status(409).json({
            ok: false,
            message: `Já existe um veículo com a matrícula ${matriculaNorm}.`,
          });
        }
      }

      veiculo = new Veiculo({
        marca:      p.marca     || "",
        modelo:     p.modelo    || "",
        ano:        p.ano       || "",
        matricula:  matriculaNorm,
        gestorId:   submission.gestorId || null,
        gestor: {
          id:      submission.gestorId    ? String(submission.gestorId) : "",
          nome:    submission.gestorNome  || "",
          email:   submission.gestorEmail || "",
          empresa: "",
        },
        aprovacao:    "aprovado",
        disponivel:   true,
        motoristaId:  null,   // motorista associa depois
        status:       "Aprovado — disponível para atribuição",
        validacao: {
          status:          "aprovado",
          observacoes:     "Aprovado pelo validador.",
          checklist:       req.body?.checklist || {},
          validadoEm:      new Date(),
          validadoPorId:   req.validador.id || "",
          validadoPorNome: req.validador.email || "",
        },
      });
      await veiculo.save();

      submission.status = "validado";
      submission.decidedAt = new Date();
      submission.decision = {
        by:     req.validador.email || req.validador.id,
        at:     new Date(),
        result: "aprovado",
      };
      submission.entityRefId = veiculo._id;
      await submission.save();

    } else {
      // Sistema A — só aprovar veículo existente
      veiculo = await Veiculo.findById(idParam);
      if (!veiculo) {
        return res.status(404).json({ ok: false, message: "Não encontrado." });
      }
      if (veiculo.aprovacao !== "pendente") {
        return res.status(400).json({
          ok: false,
          message: `Veículo já está com estado "${veiculo.aprovacao}".`,
        });
      }
      origem = "A";
      veiculo.aprovacao = "aprovado";
      veiculo.disponivel = true;
      veiculo.status = "Aprovado — disponível para atribuição";
      veiculo.validacao = {
        status:          "aprovado",
        observacoes:     "Aprovado pelo validador (Sistema A).",
        checklist:       req.body?.checklist || {},
        validadoEm:      new Date(),
        validadoPorId:   req.validador.id || "",
        validadoPorNome: req.validador.email || "",
      };
      await veiculo.save();
    }

    // ── NOTIFICAR GESTOR ─────────────────────────
    const gestorEmail = submission?.gestorEmail || veiculo?.gestor?.email;
    if (gestorEmail) {
      enviarEmailAprovacaoVeiculoGestor({
        para:       gestorEmail,
        nomeGestor: submission?.gestorNome || veiculo?.gestor?.nome || "",
        marca:      veiculo.marca,
        modelo:     veiculo.modelo,
        matricula:  veiculo.matricula,
      }).catch(err => console.warn("⚠️ Email gestor (aprovação veículo) falhou:", err?.message));
    }

    return res.json({
      ok: true,
      message: "Veículo aprovado. Gestor notificado por email.",
      veiculoId: String(veiculo._id),
      origem,
    });
  } catch (err) {
    console.error("❌ /aprovar-veiculo:", err);
    return res.status(500).json({ ok: false, message: "Erro ao aprovar veículo." });
  }
});

/* =========================================================
   POST /api/validation/rejeitar-veiculo/:id
   Body: { motivos: [...], comentario: "..." }
========================================================= */
router.post("/rejeitar-veiculo/:id", authValidador, async (req, res) => {
  try {
    const scope = String(req.validador?.scope || "").toLowerCase();
    if (scope !== "veiculos" && scope !== "global") {
      return res.status(403).json({ ok: false, message: "Sem permissão." });
    }

    const motivos    = Array.isArray(req.body?.motivos) ? req.body.motivos : [];
    const comentario = String(req.body?.comentario || "").trim();

    const motivosNormalizados = motivos
      .map(m => String(m || "").trim().toUpperCase())
      .filter(m => MOTIVOS_REJEICAO_VALIDOS.includes(m));

    if (motivosNormalizados.length === 0 && !comentario) {
      return res.status(400).json({
        ok: false,
        message: "Selecione pelo menos um motivo ou escreva uma observação.",
      });
    }

    const idParam = String(req.params.id || "").trim();
    if (!idParam) return res.status(400).json({ ok: false, message: "ID em falta." });

    let submission = null;
    try { submission = await ValidationSubmission.findById(idParam); } catch (_) {}

    if (submission && submission.type === "vehicle" && submission.status === "pendente") {
      submission.status = "recusado";
      submission.decidedAt = new Date();
      submission.decision = {
        by:      req.validador.email || req.validador.id,
        at:      new Date(),
        result:  "recusado",
        motivos: motivosNormalizados,
        comentario,
      };
      await submission.save();

      if (submission.gestorEmail) {
        enviarEmailRejeicaoVeiculoGestor({
          para:       submission.gestorEmail,
          nomeGestor: submission.gestorNome,
          marca:      submission.payload?.marca     || "",
          modelo:     submission.payload?.modelo    || "",
          matricula:  submission.payload?.matricula || "",
          motivos:    motivosNormalizados,
          comentario,
        }).catch(err => console.warn("⚠️ Email rejeição veículo falhou:", err?.message));
      }

      return res.json({ ok: true, message: "Veículo rejeitado. Gestor notificado." });
    } else {
      const veiculo = await Veiculo.findById(idParam);
      if (!veiculo) return res.status(404).json({ ok: false, message: "Não encontrado." });
      if (veiculo.aprovacao !== "pendente") {
        return res.status(400).json({
          ok: false,
          message: `Veículo já está com estado "${veiculo.aprovacao}".`,
        });
      }

      veiculo.aprovacao = "rejeitado";
      veiculo.validacao = {
        status:          "rejeitado",
        observacoes:     motivosNormalizados.join(" · ") + (comentario ? `  Observação: ${comentario}` : ""),
        checklist:       {},
        validadoEm:      new Date(),
        validadoPorId:   req.validador.id || "",
        validadoPorNome: req.validador.email || "",
      };
      await veiculo.save();

      return res.json({ ok: true, message: "Veículo rejeitado." });
    }
  } catch (err) {
    console.error("❌ /rejeitar-veiculo:", err);
    return res.status(500).json({ ok: false, message: "Erro ao rejeitar veículo." });
  }
});

// ── HELPERS DE EMAIL ────────────────────────────────────
function _mailerTransporter() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host, port,
    secure: port === 465,
    auth: { user, pass },
  });
}

async function enviarEmailAprovacaoMotorista({ para, nome, link }) {
  const tx = _mailerTransporter();
  if (!tx) {
    console.warn("⚠️ SMTP não configurado — email de aprovação não enviado.");
    return;
  }

  const nomePrimeiro = String(nome || "").trim().split(/\s+/)[0] || "";
  const from = process.env.MAIL_FROM || `"REALMETROPOLIS" <${process.env.SMTP_USER}>`;

  const html = `
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;background:#f5f5f5;color:#222">
  <div style="background:#050507;border-radius:12px;padding:24px;margin-bottom:16px;text-align:center">
    <span style="color:#c4c9d4;font-weight:900;letter-spacing:.12em;font-size:18px">REALMETROPOLIS</span>
  </div>
  <div style="background:#fff;border-radius:12px;padding:28px;box-shadow:0 2px 8px rgba(0,0,0,.06)">
    <h2 style="margin:0 0 12px;font-size:20px;color:#050507">Olá ${nomePrimeiro} ✅</h2>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#222">
      Bem-vindo à <b>REALMETROPOLIS</b>.
    </p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#222">
      A sua candidatura como motorista foi <b>aprovada</b>.
    </p>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#222">
      Para começar a trabalhar, clique abaixo e defina a sua palavra-passe:
    </p>
    <div style="text-align:center;margin:28px 0">
      <a href="${link}" style="display:inline-block;padding:14px 32px;background:#050507;color:#c4c9d4;font-weight:800;font-size:14px;border-radius:10px;text-decoration:none;letter-spacing:.06em;border:1px solid #c4c9d4">ATIVAR A MINHA CONTA</a>
    </div>
    <p style="margin:16px 0 4px;font-size:11px;color:#888;text-align:center">
      Ou copie este link no navegador:<br>
      <a href="${link}" style="color:#8b95a2;word-break:break-all">${link}</a>
    </p>
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;font-size:11.5px;color:#8b95a2;line-height:1.55;text-align:center">
      Este link é válido durante 72 horas.
    </div>
  </div>
  <p style="text-align:center;color:#888;font-size:11px;margin-top:20px">
    REALMETROPOLIS &copy; ${new Date().getFullYear()}
  </p>
</body></html>`;

  await tx.sendMail({
    from,
    to: para,
    subject: "REALMETROPOLIS — A sua candidatura foi aprovada",
    html,
  });
}

async function enviarEmailRejeicaoGestor({ para, nomeGestor, nomeMotorista, motivos, comentario }) {
  const tx = _mailerTransporter();
  if (!tx) return;

  const from = process.env.MAIL_FROM || `"REALMETROPOLIS" <${process.env.SMTP_USER}>`;
  const motivosList = motivos.length > 0
    ? motivos.map(m => `<li style="margin:4px 0">${m}</li>`).join("")
    : "";
  const comentarioBlock = comentario
    ? `<p style="margin:14px 0 0;font-size:13px;color:#333">
        <b>Observação do validador:</b><br>${comentario}
      </p>`
    : "";

  const html = `
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;background:#f5f5f5;color:#222">
  <div style="background:#050507;border-radius:12px;padding:24px;margin-bottom:16px;text-align:center">
    <span style="color:#c4c9d4;font-weight:900;letter-spacing:.12em;font-size:18px">REALMETROPOLIS</span>
  </div>
  <div style="background:#fff;border-radius:12px;padding:28px;box-shadow:0 2px 8px rgba(0,0,0,.06)">
    <h2 style="margin:0 0 12px;font-size:18px;color:#050507">Submissão de motorista rejeitada</h2>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#222">
      Olá ${nomeGestor || "Gestor"},
    </p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#222">
      A submissão do motorista <b>${nomeMotorista || "—"}</b> foi rejeitada pelo validador.
    </p>
    ${motivos.length > 0 ? `
    <p style="margin:14px 0 6px;font-size:13px;color:#222"><b>Motivos:</b></p>
    <ul style="margin:0;padding-left:20px;font-size:13px;color:#333">${motivosList}</ul>
    ` : ""}
    ${comentarioBlock}
    <p style="margin:20px 0 0;font-size:13px;color:#8b95a2;line-height:1.5">
      Pode corrigir os pontos indicados e reenviar o motorista para nova validação através do painel de gestão da frota.
    </p>
  </div>
  <p style="text-align:center;color:#888;font-size:11px;margin-top:20px">
    REALMETROPOLIS &copy; ${new Date().getFullYear()}
  </p>
</body></html>`;

  await tx.sendMail({
    from,
    to: para,
    subject: "REALMETROPOLIS — Submissão de motorista rejeitada",
    html,
  });
}


// ── EMAILS AO GESTOR (VEÍCULO) ──────────────────────────

async function enviarEmailAprovacaoVeiculoGestor({ para, nomeGestor, marca, modelo, matricula }) {
  const tx = _mailerTransporter();
  if (!tx) return;

  const from = process.env.MAIL_FROM || `"REALMETROPOLIS" <${process.env.SMTP_USER}>`;
  const nomePrimeiro = String(nomeGestor || "").trim().split(/\s+/)[0] || "";
  const veiculoDesc = [marca, modelo, matricula ? `(${matricula})` : ""].filter(Boolean).join(" ");

  const html = `
<!DOCTYPE html>
<html><body style="margin:0;padding:20px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto">
    <div style="background:#050507;border-radius:12px 12px 0 0;padding:26px 24px;text-align:center;border:1px solid #1a1c1f;border-bottom:none">
      <span style="color:#c4c9d4;font-weight:900;letter-spacing:.16em;font-size:16px">REALMETROPOLIS</span>
    </div>
    <div style="background:#0a0b0d;border-radius:0 0 12px 12px;padding:30px 26px 24px;border:1px solid #1a1c1f;border-top:none;color:#dfe4ec">
      <h2 style="margin:0 0 14px;color:#f3f5f8;font-size:17px;font-weight:800;letter-spacing:.01em">
        Olá ${nomePrimeiro || "Gestor"},
      </h2>
      <p style="margin:0 0 12px;color:#c4c9d4;font-size:14px;line-height:1.6">
        O veículo <b style="color:#f3f5f8">${veiculoDesc || "—"}</b> foi <b style="color:#f3f5f8">aprovado</b> pelo nosso validador.
      </p>
      <div style="background:#050507;border:1px solid rgba(196,201,212,.2);border-radius:10px;padding:16px;margin:20px 0;color:#c4c9d4;font-size:13px;line-height:1.6">
        <div style="color:#8b95a2;font-size:10px;font-weight:800;letter-spacing:.24em;margin-bottom:8px">PRÓXIMO PASSO</div>
        O veículo está agora disponível para atribuição a motoristas na sua frota.
      </div>
    </div>
    <p style="text-align:center;color:#8b95a2;font-size:10px;margin:16px 0 0;letter-spacing:.06em">
      REALMETROPOLIS &copy; ${new Date().getFullYear()}
    </p>
  </div>
</body></html>`;

  await tx.sendMail({
    from,
    to: para,
    subject: `REALMETROPOLIS — Veículo ${matricula || ""} aprovado`,
    html,
  });
}

async function enviarEmailRejeicaoVeiculoGestor({ para, nomeGestor, marca, modelo, matricula, motivos, comentario }) {
  const tx = _mailerTransporter();
  if (!tx) return;

  const from = process.env.MAIL_FROM || `"REALMETROPOLIS" <${process.env.SMTP_USER}>`;
  const nomePrimeiro = String(nomeGestor || "").trim().split(/\s+/)[0] || "";
  const veiculoDesc = [marca, modelo, matricula ? `(${matricula})` : ""].filter(Boolean).join(" ");

  const listaHtml = (Array.isArray(motivos) ? motivos : [])
    .map(m => `<li style="margin:4px 0;color:#c4c9d4">${m}</li>`).join("");
  const comentarioBlock = comentario ? `
    <div style="background:rgba(255,255,255,.02);border-left:2px solid #c4c9d4;padding:12px 14px;border-radius:0 8px 8px 0;margin-top:16px">
      <div style="color:#8b95a2;font-size:10px;font-weight:800;letter-spacing:.24em;margin-bottom:6px">OBSERVAÇÃO DO VALIDADOR</div>
      <div style="color:#dfe4ec;font-size:13px;line-height:1.5">${comentario}</div>
    </div>` : "";

  const html = `
<!DOCTYPE html>
<html><body style="margin:0;padding:20px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto">
    <div style="background:#050507;border-radius:12px 12px 0 0;padding:26px 24px;text-align:center;border:1px solid #1a1c1f;border-bottom:none">
      <span style="color:#c4c9d4;font-weight:900;letter-spacing:.16em;font-size:16px">REALMETROPOLIS</span>
    </div>
    <div style="background:#0a0b0d;border-radius:0 0 12px 12px;padding:30px 26px 24px;border:1px solid #1a1c1f;border-top:none;color:#dfe4ec">
      <h2 style="margin:0 0 14px;color:#f3f5f8;font-size:17px;font-weight:800;letter-spacing:.01em">
        Olá ${nomePrimeiro || "Gestor"},
      </h2>
      <p style="margin:0 0 12px;color:#c4c9d4;font-size:14px;line-height:1.6">
        O veículo <b style="color:#f3f5f8">${veiculoDesc || "—"}</b> foi analisado pelo nosso validador.
      </p>
      <p style="margin:0 0 8px;color:#c4c9d4;font-size:14px;line-height:1.6">
        Documentos que precisam de ser corrigidos:
      </p>
      ${listaHtml ? `<ul style="margin:0;padding-left:20px;font-size:13px">${listaHtml}</ul>` : ""}
      ${comentarioBlock}
    </div>
    <p style="text-align:center;color:#8b95a2;font-size:10px;margin:16px 0 0;letter-spacing:.06em">
      REALMETROPOLIS &copy; ${new Date().getFullYear()}
    </p>
  </div>
</body></html>`;

  await tx.sendMail({
    from,
    to: para,
    subject: `REALMETROPOLIS — Veículo ${matricula || ""} rejeitado`,
    html,
  });
}


export default router;