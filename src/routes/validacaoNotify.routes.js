import express from "express";
import mongoose from "mongoose";
import crypto from "crypto";
import nodemailer from "nodemailer";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");
const REENVIO_DIR = path.join(UPLOADS_DIR, "reenvios");
fs.mkdirSync(REENVIO_DIR, { recursive: true });

/* ======================================================
   SMTP
====================================================== */
function createSmtp() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host, port,
    secure: port === 465,
    auth: { user, pass }
  });
}

async function sendEmail({ to, subject, html }) {
  const transporter = createSmtp();
  const from = String(process.env.SMTP_FROM || process.env.SMTP_USER || "").trim();
  if (!transporter || !from) {
    console.warn("⚠️ SMTP não configurado — email não enviado para:", to);
    return false;
  }
  try {
    await transporter.sendMail({ from, to, subject, html });
    console.log("✅ Email enviado para:", to);
    return true;
  } catch (err) {
    console.error("❌ Falha ao enviar email:", err.message);
    return false;
  }
}

/* ======================================================
   MULTER — reenvio de documentos
====================================================== */
function sanitizeFileName(name = "") {
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const storageReenvio = multer.diskStorage({
  destination: (req, file, cb) => cb(null, REENVIO_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const base = sanitizeFileName(path.basename(file.originalname || "ficheiro", ext)) || "ficheiro";
    cb(null, `${Date.now()}-${file.fieldname}-${base}${ext}`);
  }
});

const uploadReenvio = multer({
  storage: storageReenvio,
  limits: { fileSize: 20 * 1024 * 1024, files: 10 }
});

/* ======================================================
   HELPERS
====================================================== */
function getPublicBaseUrl(req) {
  const envUrl = String(process.env.FRONTEND_URL || process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (envUrl) return envUrl;
  const proto = req?.headers?.["x-forwarded-proto"]
    ? String(req.headers["x-forwarded-proto"]).split(",")[0].trim()
    : (req?.protocol || "http");
  const host = req?.headers?.["x-forwarded-host"] || req?.get?.("host") || "localhost:10000";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function fileToPublicUrl(file) {
  if (!file?.filename) return null;
  return {
    url: `/uploads/reenvios/${file.filename}`,
    fileUrl: `/uploads/reenvios/${file.filename}`,
    path: `/uploads/reenvios/${file.filename}`,
    filename: file.filename,
    nome: file.originalname || file.filename,
    mimetype: file.mimetype || ""
  };
}

/* ======================================================
   TOKEN DE ACTIVAÇÃO — para o motorista definir a senha
   Mesma lógica/campos usados em validationSubmissions.routes.js
   (gerarTokenActivacao) e lidos por motorista.routes.js
   (/definir-senha): convite.tokenHash, convite.expiresAt,
   convite.usadoEm. ANTES desta correcção, esta rota (chamada pelo
   painel de validadores) nunca gerava nenhum token — o email de
   aprovação ficava sempre sem nenhum link/botão para o motorista
   activar a conta.
====================================================== */
function gerarTokenActivacaoRaw(motoristaId, email) {
  const secret = process.env.JWT_SECRET || "";
  if (!secret) throw new Error("JWT_SECRET não definido no .env");

  const activationToken = jwt.sign(
    { typ: "motorista_setup", id: String(motoristaId), email: email || "" },
    secret,
    { expiresIn: "48h" }
  );
  const tokenHash = crypto.createHash("sha256").update(activationToken).digest("hex");
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  return { activationToken, tokenHash, expiresAt };
}

/* ======================================================
   EMAIL — APROVADO TOTAL
   Design preto/prata premium (coerente com resto da plataforma).
   Mostra data exacta de expiração do link de activação.
====================================================== */
function buildEmailAprovado({ nome, modo, base, activationLink, expiresAt }) {
  const tipo = modo === "veiculos" ? "Veículo" : "Motorista";
  const primeiroNome = String(nome || "").trim().split(/\s+/)[0] || "";

  // Formatar data de expiração: "15 de julho de 2026, às 11:47"
  let validadeTxt = "";
  if (expiresAt) {
    try {
      const d = new Date(expiresAt);
      const meses = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      validadeTxt = `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}, às ${hh}:${mm}`;
    } catch { validadeTxt = ""; }
  }

  const botaoHtml = activationLink ? `
        <div style="text-align:center;margin:28px 0 20px">
          <a href="${activationLink}" style="display:inline-block;padding:14px 34px;background:#050507;color:#c4c9d4;font-weight:800;font-size:13px;border-radius:10px;text-decoration:none;letter-spacing:.08em;border:1px solid #c4c9d4;text-transform:uppercase">ATIVAR A MINHA CONTA</a>
        </div>

        ${validadeTxt ? `
        <div style="background:#050507;border:1px solid rgba(196,201,212,.35);border-radius:12px;padding:18px 20px;margin:22px 0 8px;text-align:center">
          <div style="color:#8b95a2;font-size:10px;font-weight:800;letter-spacing:.28em;margin-bottom:8px">ATENÇÃO</div>
          <div style="color:#c4c9d4;font-size:18px;font-weight:900;letter-spacing:.01em;line-height:1.4">${validadeTxt}</div>
          <div style="color:#8b95a2;font-size:11px;margin-top:8px;letter-spacing:.02em">Após esta data o link expira e terá de solicitar novo.</div>
        </div>
        ` : ""}

        <p style="color:#8b95a2;font-size:11px;text-align:center;margin:14px 0 0;letter-spacing:.02em">
          Ou copie este link no navegador:<br>
          <a href="${activationLink}" style="color:#8b95a2;word-break:break-all;text-decoration:underline">${activationLink}</a>
        </p>
  ` : "";

  return {
    subject: `REALMETROPOLIS — ${tipo} aprovado`,
    html: `
<!DOCTYPE html>
<html><body style="margin:0;padding:20px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto">

    <!-- Cabeçalho preto -->
    <div style="background:#050507;border-radius:12px 12px 0 0;padding:26px 24px;text-align:center;border:1px solid #1a1c1f;border-bottom:none">
      <span style="color:#c4c9d4;font-weight:900;letter-spacing:.16em;font-size:16px">REALMETROPOLIS</span>
    </div>

    <!-- Corpo -->
    <div style="background:#0a0b0d;border-radius:0 0 12px 12px;padding:30px 26px 24px;border:1px solid #1a1c1f;border-top:none;color:#dfe4ec">

      <h2 style="margin:0 0 14px;color:#f3f5f8;font-size:18px;font-weight:800;letter-spacing:.01em">
        Olá ${primeiroNome || tipo.toLowerCase()},
      </h2>

      <p style="margin:0 0 12px;color:#c4c9d4;font-size:14px;line-height:1.6">
        Bem-vindo à <b style="color:#f3f5f8">REALMETROPOLIS</b>.
      </p>

      <p style="margin:0 0 12px;color:#c4c9d4;font-size:14px;line-height:1.6">
        A sua candidatura como <b style="color:#f3f5f8">${tipo}</b> foi <b style="color:#f3f5f8">aprovada</b>.
      </p>

      <p style="margin:0 0 8px;color:#c4c9d4;font-size:14px;line-height:1.6">
        Para começar a trabalhar, clique abaixo e defina a sua palavra-passe:
      </p>

      ${botaoHtml}

    </div>

    <!-- Rodapé -->
    <p style="text-align:center;color:#8b95a2;font-size:10px;margin:16px 0 0;letter-spacing:.06em">
      REALMETROPOLIS &copy; ${new Date().getFullYear()}
    </p>
  </div>
</body></html>
    `
  };
}

/* ======================================================
   EMAIL — DOCUMENTOS RECUSADOS
====================================================== */
function buildEmailRecusado({ nome, modo, documentosRecusados, reenvioLink }) {
  const tipo = modo === "veiculos" ? "Veículo" : "Motorista";

  const listaHtml = documentosRecusados.map(doc => `
    <div style="background:#1a0e0e;border:1px solid #5a2b2b;border-radius:10px;padding:14px;margin-bottom:10px">
      <p style="margin:0 0 6px;color:#ffb4b4;font-weight:bold;font-size:14px">📄 ${doc.label || doc.docKey}</p>
      ${doc.motivos?.length ? `
        <ul style="margin:0;padding-left:18px;color:#e0c4c4;font-size:13px">
          ${doc.motivos.map(m => `<li>${m}</li>`).join("")}
        </ul>
      ` : `<p style="margin:0;color:#e0c4c4;font-size:13px">Documento recusado.</p>`}
    </div>
  `).join("");

  return {
    subject: `REALMETROPOLIS — Documentos para atualizar ⚠️`,
    html: `
      <div style="font-family:Arial;max-width:640px;margin:0 auto;padding:24px;background:#050505;color:#f3f5f8;border-radius:16px">
        <h2 style="color:#dfe4ec;margin:0 0 16px">REALMETROPOLIS</h2>
        <p style="font-size:16px;margin:0 0 12px">Olá <b>${nome || tipo}</b>,</p>
        <p style="font-size:15px;margin:0 0 16px">
          A validação do seu registo como <b>${tipo}</b> foi concluída.<br/>
          Os seguintes documentos precisam de ser <b style="color:#efab51">atualizados</b>:
        </p>
        ${listaHtml}
        <div style="margin-top:24px;text-align:center">
          <a href="${reenvioLink}" style="display:inline-block;background:#dfe4ec;color:#000;font-weight:bold;padding:14px 24px;border-radius:12px;text-decoration:none;font-size:15px">
            📤 Enviar documentos corrigidos
          </a>
        </div>
        <p style="color:#a4acb7;font-size:12px;margin-top:20px">
          O link acima é exclusivo para si e expira em 7 dias.<br/>
          A sua conta ficará <b>inativa</b> até os documentos serem aprovados.
        </p>
      </div>
    `
  };
}

/* ======================================================
   POST /resultado-final
   Chamado pelo validacao.html ao clicar "Enviar resultado"
====================================================== */
router.post("/resultado-final", async (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [];

    if (!items.length) {
      return res.status(400).json({ ok: false, message: "Payload vazio." });
    }

    console.log("📩 RESULTADO FINAL RECEBIDO:", items.length, "item(s)");

    const db = mongoose.connection.db;
    const colMotoristas  = db.collection("motoristas");
    const colVeiculos    = db.collection("veiculos");
    const colHistorico   = db.collection("validacoesHistorico");
    const colReenvios    = db.collection("validacaoReenvios");
    const colSubmissoes  = db.collection("validationsubmissions");

    const results = [];

    for (const item of items) {
      const {
        entityId, modo, nome, email,
        matricula, nif, gestor,
        documentosReprovados = []
      } = item;

      const collection = modo === "veiculos" ? colVeiculos : colMotoristas;

      // --- Tenta localizar o documento no MongoDB ---
      let objectId = null;
      if (mongoose.Types.ObjectId.isValid(entityId)) {
        objectId = new mongoose.Types.ObjectId(entityId);
      }

      const filtro = objectId
        ? { _id: objectId }
        : { $or: [{ email }, { matricula }, { nif }] };

      const temRecusados = documentosReprovados.length > 0;

      if (!temRecusados) {
        // ─────────────────────────────────────────────────────────
        // ✅ TUDO APROVADO
        //
        // Para MOTORISTAS: o entityId pode ser o id de UMA SUBMISSÃO
        // (validationsubmissions) — não de um Motorista real. Nesse
        // caso, o updateOne abaixo não encontrava nada e o motorista
        // nunca era criado. Aqui verificamos primeiro se o entityId
        // é uma submissão e, se for, criamos o Motorista real com
        // os dados da submissão. Só depois seguimos com o resto.
        // ─────────────────────────────────────────────────────────
        if (modo !== "veiculos" && objectId) {
          const jaExisteMotorista = await colMotoristas.findOne({ _id: objectId });
          if (!jaExisteMotorista) {
            // Ver se é uma submissão
            const submissao = await colSubmissoes.findOne({ _id: objectId, type: "driver" });
            if (submissao) {
              // Criar Motorista real a partir da submissão
              const emailNorm = String(submissao.ownerEmail || submissao.payload?.email || email || "").toLowerCase().trim();

              // Se já existe motorista com o mesmo email (por outro meio), usar esse — não duplicar
              const existente = emailNorm ? await colMotoristas.findOne({ email: emailNorm }) : null;
              if (existente) {
                objectId = existente._id;   // redireciona operações para o existente
              } else {
                // Idiomas — garantir Português obrigatório
                const idiomasSubmit = Array.isArray(submissao.payload?.idiomas) ? submissao.payload.idiomas : [];
                const idiomasUnicos = Array.from(new Set([
                  "Portugues",
                  ...idiomasSubmit.map(x => String(x || "").trim()).filter(Boolean),
                ]));

                const novoMotorista = {
                  _id:        objectId,     // mantém o mesmo _id para links baterem
                  nome:       submissao.ownerName    || submissao.payload?.nome     || nome     || "",
                  contacto:   submissao.ownerContact || submissao.payload?.contacto || "",
                  email:      emailNorm,
                  nif:        submissao.payload?.nif      || "",
                  endereco:   submissao.payload?.endereco || "",
                  iban:       submissao.payload?.iban     || "",
                  idiomas:    idiomasUnicos,
                  gestorId:   submissao.gestorId  || null,
                  gestor: {
                    id:      submissao.gestorId    ? String(submissao.gestorId) : "",
                    nome:    submissao.gestorNome  || "",
                    email:   submissao.gestorEmail || "",
                    empresa: "",
                  },
                  aprovacao:    "aprovado",
                  disponivel:   false,
                  passwordHash: "",           // motorista define via link do email
                  status:       "Aprovado — aguarda activação",
                  validacao: {
                    status:      "aprovado",
                    estado:      "aprovado",
                    atualizadoEm: new Date(),
                    documentosReprovados: [],
                  },
                  createdAt: new Date(),
                  updatedAt: new Date(),
                };
                await colMotoristas.insertOne(novoMotorista);
                console.log(`✨ Motorista criado a partir da submissão | id: ${objectId}`);
              }

              // Marcar submissão como validada
              await colSubmissoes.updateOne(
                { _id: submissao._id },
                { $set: {
                    status:     "validado",
                    decidedAt:  new Date(),
                    entityRefId: objectId,
                }}
              );
            }
          }
        }

        // ────────────────────────────────────────────────────────
        // PARA VEÍCULOS: criar Veiculo real se ainda não existe
        //
        // Quando o gestor submete um veículo via ValidationSubmission
        // (Sistema B), o entityId aponta para a submissão — não a um
        // Veiculo real. Sem esta criação, o updateOne abaixo não
        // encontrava nada e nunca havia veículo na coleção 'veiculos'
        // para o motorista escolher.
        // ────────────────────────────────────────────────────────
        if (modo === "veiculos" && objectId) {
          const jaExisteVeiculo = await colVeiculos.findOne({ _id: objectId });
          if (!jaExisteVeiculo) {
            const submissaoV = await colSubmissoes.findOne({ _id: objectId, type: "vehicle" });
            if (submissaoV) {
              const p = submissaoV.payload || {};
              const matriculaNorm = String(p.matricula || "").trim().toUpperCase();

              // Se já existir veículo com a mesma matrícula (por outro
              // caminho), não duplicamos — usamos o existente.
              const existente = matriculaNorm
                ? await colVeiculos.findOne({ matricula: matriculaNorm })
                : null;

              if (existente) {
                objectId = existente._id;
              } else {
                // Converter gestorId para ObjectId (schema exige)
                const gestorIdObj = submissaoV.gestorId
                  ? (mongoose.Types.ObjectId.isValid(submissaoV.gestorId)
                      ? new mongoose.Types.ObjectId(submissaoV.gestorId)
                      : submissaoV.gestorId)
                  : null;

                const novoVeiculo = {
                  _id:       objectId,   // mantém o mesmo _id para links baterem
                  marca:     p.marca     || "",
                  modelo:    p.modelo    || "",
                  ano:       p.ano       || "",
                  matricula: matriculaNorm,
                  gestorId:  gestorIdObj,
                  gestor: {
                    id:      submissaoV.gestorId    ? String(submissaoV.gestorId) : "",
                    nome:    submissaoV.gestorNome  || "",
                    email:   submissaoV.gestorEmail || "",
                    empresa: "",
                  },
                  aprovacao:   "aprovado",
                  disponivel:  true,
                  motoristaId: null,   // sem motorista associado — livre
                  status:      "Aprovado — disponível para atribuição",
                  validacao: {
                    status:      "aprovado",
                    estado:      "aprovado",
                    atualizadoEm: new Date(),
                    documentosReprovados: [],
                  },
                  createdAt: new Date(),
                  updatedAt: new Date(),
                };
                await colVeiculos.insertOne(novoVeiculo);
                console.log(`✨ Veículo criado a partir da submissão | id: ${objectId} | matrícula: ${matriculaNorm}`);
              }
            }
          }
        }

        // Actualiza (novo ou existente) marcando como aprovado — para
        // veículos e para motoristas já existentes fica igual.
        await collection.updateOne({ _id: objectId }, {
          $set: {
            aprovacao: "aprovado",
            "validacao.status": "aprovado",
            "validacao.estado": "aprovado",
            "validacao.atualizadoEm": new Date(),
            "validacao.documentosReprovados": []
          }
        });

        // ────────────────────────────────────────────────────────
        // MARCAR SUBMISSÃO COMO VALIDADA (para VEÍCULOS)
        //
        // Para MOTORISTAS já era feito no bloco acima (linha ~366),
        // quando criamos o motorista real. Para VEÍCULOS faltava —
        // então a submissão ficava eternamente como "pendente" no
        // painel Docs do gestor, mesmo depois de aprovada.
        // Aqui procuramos a submissão de veículo correspondente
        // (por _id da entidade OU pelo entityRefId) e marcamos.
        // ────────────────────────────────────────────────────────
        if (modo === "veiculos" && objectId) {
          try {
            const submissaoVeiculo = await colSubmissoes.findOne({
              type: "vehicle",
              $or: [
                { _id: objectId },
                { entityRefId: objectId },
              ],
              status: { $in: ["pendente", "pendente_novo_envio"] },
            });
            if (submissaoVeiculo) {
              await colSubmissoes.updateOne(
                { _id: submissaoVeiculo._id },
                { $set: {
                    status:      "validado",
                    decidedAt:   new Date(),
                    entityRefId: objectId,
                }}
              );
              console.log(`📋 Submissão de veículo marcada como validada | subId: ${submissaoVeiculo._id}`);
            }
          } catch (errSub) {
            console.warn("⚠️ Falha ao marcar submissão de veículo como validada:", errSub?.message);
          }
        }

        console.log(`✅ ${modo} APROVADO | entityId: ${objectId}`);

        // Gerar token de activação (só motoristas precisam de
        // definir senha — veículos não têm login próprio).
        let activationLink = null;
        let activationExpiresAt = null;
        if (modo !== "veiculos" && objectId) {
          try {
            const { activationToken, tokenHash, expiresAt } = gerarTokenActivacaoRaw(objectId, email);
            activationExpiresAt = expiresAt;
            // CORRIGIDO: o schema real de Motorista.js não tem campo
            // "convite" — usa setupToken/setupTokenHash/
            // setupTokenExpires/setupTokenUsadoEm (mesmo padrão já
            // usado, correctamente, em motoristas.service.js→aprovar()).
            await collection.updateOne({ _id: objectId }, {
              $set: {
                setupToken: activationToken,
                setupTokenHash: tokenHash,
                setupTokenExpires: expiresAt,
                setupTokenUsadoEm: null,
              },
            });
            // Garantir que passwordHash existe vazio, para obrigar a
            // definir senha (sem apagar uma já existente, se o
            // motorista já tinha conta activa antes).
            await collection.updateOne(
              { _id: objectId, passwordHash: { $exists: false } },
              { $set: { passwordHash: "" } }
            );
            const base = getPublicBaseUrl(req);
            activationLink = `${base}/motorista-definir-senha.html?token=${encodeURIComponent(activationToken)}`;
          } catch (errToken) {
            console.error("❌ [validacaoNotify] falha ao gerar token de activação:", errToken?.message);
          }
        }

        // Envia email de aprovação (preto/prata + data de expiração)
        const emailDest = email || "";
        if (emailDest) {
          const base = getPublicBaseUrl(req);
          const { subject, html } = buildEmailAprovado({
            nome,
            modo,
            base,
            activationLink,
            expiresAt: activationExpiresAt,
          });
          await sendEmail({ to: emailDest, subject, html });
        }

        // ── NOTIFICAR GESTOR (email preto/prata) ─────────────
        // O gestor recebeu aprovação — importante para poder atribuir
        // viagens ao motorista. Se não conseguirmos identificar o
        // gestor pelo item, tentamos ir buscar da submissão.
        try {
          let gestorNome  = gestor?.nome  || "";
          let gestorEmail = gestor?.email || "";

          if (!gestorEmail && objectId) {
            const submissao = await colSubmissoes.findOne({ entityRefId: objectId })
                          || await colSubmissoes.findOne({ _id: objectId });
            if (submissao) {
              gestorNome  = gestorNome  || submissao.gestorNome  || "";
              gestorEmail = gestorEmail || submissao.gestorEmail || "";
            }
          }

          if (gestorEmail) {
            const base = getPublicBaseUrl(req);
            const emailGestor = buildEmailGestorAprovado({
              nomeGestor:    gestorNome,
              nomeMotorista: nome,
              modo,
              base,
            });
            await sendEmail({
              to:      gestorEmail,
              subject: emailGestor.subject,
              html:    emailGestor.html,
            });
            console.log(`📧 Gestor notificado (aprovação): ${gestorEmail}`);
          }
        } catch (errGestor) {
          console.warn("⚠️ Falha ao notificar gestor (aprovação):", errGestor?.message);
          // não bloqueia — motorista já foi aprovado
        }

        await colHistorico.insertOne({
          entityId, modo, nome, email, matricula, nif,
          resultado: "aprovado",
          documentosReprovados: [],
          criadoEm: new Date()
        });

        results.push({ entityId, modo, resultado: "aprovado" });

      } else {
        // ⚠️ TEM RECUSADOS — marca como inativo e gera link de reenvio
        const reenvioToken = crypto.randomBytes(32).toString("hex");
        const reenvioExpira = new Date();
        reenvioExpira.setDate(reenvioExpira.getDate() + 7);

        // Guarda o token de reenvio na coleção
        await colReenvios.insertOne({
          token: reenvioToken,
          entityId,
          modo,
          nome,
          email,
          matricula,
          nif,
          gestor,
          documentosParaCorrigir: documentosReprovados,
          usado: false,
          criadoEm: new Date(),
          expiraEm: reenvioExpira
        });

        // Marca o motorista/veículo como inativo/pendente atualização
        await collection.updateOne(filtro, {
          $set: {
            aprovacao: "pendente_atualizacao",
            "validacao.status": "pendente_atualizacao",
            "validacao.estado": "pendente_atualizacao",
            "validacao.atualizadoEm": new Date(),
            "validacao.documentosReprovados": documentosReprovados
          }
        });

        console.log(`⚠️ ${modo} COM RECUSADOS | entityId: ${entityId} | docs: ${documentosReprovados.length}`);

        // ── DECISÃO PROFISSIONAL: MOTORISTA NÃO RECEBE EMAIL ────
        // Se enviássemos email ao motorista com "documentos recusados",
        // corríamos o risco de o motorista desistir antes sequer de
        // trabalhar. É o GESTOR que submete e é o GESTOR que corrige.
        // Portanto notificamos APENAS o gestor.
        try {
          let gestorNome  = gestor?.nome  || "";
          let gestorEmail = gestor?.email || "";

          if (!gestorEmail && objectId) {
            const submissao = await colSubmissoes.findOne({ entityRefId: objectId })
                          || await colSubmissoes.findOne({ _id: objectId });
            if (submissao) {
              gestorNome  = gestorNome  || submissao.gestorNome  || "";
              gestorEmail = gestorEmail || submissao.gestorEmail || "";
            }
          }

          if (gestorEmail) {
            const base = getPublicBaseUrl(req);
            const emailGestor = buildEmailGestorRejeitado({
              nomeGestor:    gestorNome,
              nomeMotorista: nome,
              documentosRecusados: documentosReprovados,
              base,
            });
            await sendEmail({
              to:      gestorEmail,
              subject: emailGestor.subject,
              html:    emailGestor.html,
            });
            console.log(`📧 Gestor notificado (rejeição): ${gestorEmail}`);
          }
        } catch (errGestor) {
          console.warn("⚠️ Falha ao notificar gestor (rejeição):", errGestor?.message);
        }

        await colHistorico.insertOne({
          entityId, modo, nome, email, matricula, nif,
          resultado: "parcial",
          documentosReprovados,
          criadoEm: new Date()
        });

        results.push({ entityId, modo, resultado: "pendente_atualizacao", documentosReprovados: documentosReprovados.length });
      }
    }

    return res.status(200).json({
      ok: true,
      message: "Resultados processados com sucesso.",
      total: results.length,
      results
    });

  } catch (err) {
    console.error("❌ ERRO AO GRAVAR RESULTADO:", err);
    next(err);
  }
});

/* ======================================================
   GET /reenvio/:token
   Chamado pelo reenvio-documentos.html para saber
   quais documentos o motorista precisa de reenviar
====================================================== */
router.get("/reenvio/:token", async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const colReenvios = db.collection("validacaoReenvios");

    const doc = await colReenvios.findOne({
      token: req.params.token,
      usado: false,
      expiraEm: { $gt: new Date() }
    });

    if (!doc) {
      return res.status(404).json({ ok: false, message: "Link inválido ou expirado." });
    }

    return res.json({
      ok: true,
      entityId: doc.entityId,
      modo: doc.modo,
      nome: doc.nome,
      email: doc.email,
      matricula: doc.matricula,
      documentosParaCorrigir: doc.documentosParaCorrigir
    });

  } catch (err) {
    console.error("❌ ERRO GET reenvio:", err);
    return res.status(500).json({ ok: false, message: "Erro ao carregar dados." });
  }
});

/* ======================================================
   POST /reenvio/:token
   Recebe os documentos corrigidos e volta a colocar
   no painel de validação (global.rmSubmissoes)
====================================================== */
router.post("/reenvio/:token", (req, res, next) => {
  // Aceita qualquer campo de ficheiro dinamicamente
  uploadReenvio.any()(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ ok: false, message: err.message || "Erro no upload." });
    }

    try {
      const db = mongoose.connection.db;
      const colReenvios = db.collection("validacaoReenvios");
      const colMotoristas = db.collection("motoristas");
      const colVeiculos = db.collection("veiculos");

      const doc = await colReenvios.findOne({
        token: req.params.token,
        usado: false,
        expiraEm: { $gt: new Date() }
      });

      if (!doc) {
        return res.status(404).json({ ok: false, message: "Link inválido ou expirado." });
      }

      // Constrói os documentos enviados
      const novosDocumentos = {};
      (req.files || []).forEach(file => {
        novosDocumentos[file.fieldname] = fileToPublicUrl(file);
      });

      if (!Object.keys(novosDocumentos).length) {
        return res.status(400).json({ ok: false, message: "Nenhum ficheiro recebido." });
      }

      // Atualiza o status para "pendente" (volta ao painel de validação)
      const collection = doc.modo === "veiculos" ? colVeiculos : colMotoristas;

      let objectId = null;
      if (mongoose.Types.ObjectId.isValid(doc.entityId)) {
        objectId = new mongoose.Types.ObjectId(doc.entityId);
      }

      const filtro = objectId
        ? { _id: objectId }
        : { $or: [{ email: doc.email }, { matricula: doc.matricula }, { nif: doc.nif }] };

      // Atualiza os documentos específicos e repõe status pendente
      const setUpdate = {
        aprovacao: "pendente",
        "validacao.status": "pendente",
        "validacao.estado": "pendente",
        "validacao.atualizadoEm": new Date(),
        "validacao.documentosReprovados": []
      };

      // Atualiza cada documento corrigido no campo documentos
      Object.entries(novosDocumentos).forEach(([key, value]) => {
        setUpdate[`documentos.${key}`] = value;
      });

      await collection.updateOne(filtro, { $set: setUpdate });

      // Marca o token como usado
      await colReenvios.updateOne(
        { token: req.params.token },
        { $set: { usado: true, usadoEm: new Date() } }
      );

      // Volta a colocar no painel de validação (global.rmSubmissoes)
      if (!global.rmSubmissoes) global.rmSubmissoes = { motoristas: [], veiculos: [] };

      const entidade = {
        ...doc,
        _id: doc.entityId,
        id: doc.entityId,
        entityId: doc.entityId,
        entityType: doc.modo === "veiculos" ? "vehicle" : "driver",
        estado: "pendente",
        status: "pendente",
        aprovacao: "pendente",
        documentos: novosDocumentos,
        documents: novosDocumentos,
        docs: novosDocumentos,
        reenviadoEm: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      if (doc.modo === "veiculos") {
        global.rmSubmissoes.veiculos = global.rmSubmissoes.veiculos.filter(
          v => String(v.entityId || v._id || "") !== String(doc.entityId)
        );
        global.rmSubmissoes.veiculos.unshift(entidade);
      } else {
        global.rmSubmissoes.motoristas = global.rmSubmissoes.motoristas.filter(
          m => String(m.entityId || m._id || "") !== String(doc.entityId)
        );
        global.rmSubmissoes.motoristas.unshift(entidade);
      }

      console.log(`✅ Reenvio processado | ${doc.modo} | ${doc.nome || doc.email}`);

      return res.json({
        ok: true,
        message: "Documentos recebidos com sucesso. A sua submissão está em análise."
      });

    } catch (err) {
      console.error("❌ ERRO POST reenvio:", err);
      return res.status(500).json({ ok: false, message: "Erro ao processar reenvio." });
    }
  });
});

/* ══════════════════════════════════════════════════════════════════
   EMAILS PARA O GESTOR — aprovação e rejeição
   
   Design preto/prata premium coerente com o resto da plataforma.
   
   Motorista:
     • Aprovação  → recebe email preto/prata para activar conta
     • Rejeição   → NÃO recebe (protege confiança)
   
   Gestor:
     • Aprovação  → recebe email a informar
     • Rejeição   → recebe email com motivos por documento + link
                    para corrigir no painel
   ══════════════════════════════════════════════════════════════════ */

function buildEmailGestorAprovado({ nomeGestor, nomeMotorista, base, modo }) {
  const primeiroNomeGestor = String(nomeGestor || "").trim().split(/\s+/)[0] || "";
  const ehVeiculo = String(modo || "").toLowerCase() === "veiculos";
  const tipo   = ehVeiculo ? "Veículo" : "Motorista";
  const tipoMi = ehVeiculo ? "veículo" : "motorista";
  const proximoPasso = ehVeiculo
    ? `O veículo <b style="color:#f3f5f8">${nomeMotorista || "—"}</b> está agora ativo e disponível para fazer viagens na sua frota.`
    : `O motorista já recebeu email para activar a conta. Assim que definir a palavra-passe, poderá receber viagens da sua frota.`;

  return {
    subject: `REALMETROPOLIS — ${tipo} ${nomeMotorista || ""} aprovado`,
    html: `
<!DOCTYPE html>
<html><body style="margin:0;padding:20px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto">

    <div style="background:#050507;border-radius:12px 12px 0 0;padding:26px 24px;text-align:center;border:1px solid #1a1c1f;border-bottom:none">
      <span style="color:#c4c9d4;font-weight:900;letter-spacing:.16em;font-size:16px">REALMETROPOLIS</span>
    </div>

    <div style="background:#0a0b0d;border-radius:0 0 12px 12px;padding:30px 26px 24px;border:1px solid #1a1c1f;border-top:none;color:#dfe4ec">

      <h2 style="margin:0 0 14px;color:#f3f5f8;font-size:17px;font-weight:800;letter-spacing:.01em">
        Olá ${primeiroNomeGestor || "Gestor"},
      </h2>

      <p style="margin:0 0 12px;color:#c4c9d4;font-size:14px;line-height:1.6">
        O ${tipoMi} <b style="color:#f3f5f8">${nomeMotorista || "—"}</b> que submeteu foi <b style="color:#f3f5f8">aprovado</b> pelo nosso validador.
      </p>

      <div style="background:#050507;border:1px solid rgba(196,201,212,.2);border-radius:10px;padding:16px;margin:20px 0;color:#c4c9d4;font-size:13px;line-height:1.6">
        <div style="color:#8b95a2;font-size:10px;font-weight:800;letter-spacing:.24em;margin-bottom:8px">PRÓXIMO PASSO</div>
        ${proximoPasso}
      </div>

    </div>

    <p style="text-align:center;color:#8b95a2;font-size:10px;margin:16px 0 0;letter-spacing:.06em">
      REALMETROPOLIS &copy; ${new Date().getFullYear()}
    </p>
  </div>
</body></html>
    `
  };
}

function buildEmailGestorRejeitado({ nomeGestor, nomeMotorista, documentosRecusados, base }) {
  const primeiroNomeGestor = String(nomeGestor || "").trim().split(/\s+/)[0] || "";
  const painelUrl = `${base || ""}/gestor-frota.html`;

  const listaHtml = (Array.isArray(documentosRecusados) ? documentosRecusados : [])
    .map(doc => {
      const label   = doc.label   || doc.key || "Documento";
      const motivo  = doc.motivo  || doc.reasons || doc.reason || "—";
      return `
        <div style="padding:12px 14px;border-left:2px solid #c4c9d4;background:rgba(255,255,255,.02);margin-bottom:8px;border-radius:0 8px 8px 0">
          <div style="color:#f3f5f8;font-weight:800;font-size:13px;margin-bottom:4px">${label}</div>
          <div style="color:#8b95a2;font-size:12px;line-height:1.5">${motivo}</div>
        </div>
      `;
    }).join("");

  return {
    subject: `REALMETROPOLIS — Motorista ${nomeMotorista || ""} — documentos a corrigir`,
    html: `
<!DOCTYPE html>
<html><body style="margin:0;padding:20px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto">

    <div style="background:#050507;border-radius:12px 12px 0 0;padding:26px 24px;text-align:center;border:1px solid #1a1c1f;border-bottom:none">
      <span style="color:#c4c9d4;font-weight:900;letter-spacing:.16em;font-size:16px">REALMETROPOLIS</span>
    </div>

    <div style="background:#0a0b0d;border-radius:0 0 12px 12px;padding:30px 26px 24px;border:1px solid #1a1c1f;border-top:none;color:#dfe4ec">

      <h2 style="margin:0 0 14px;color:#f3f5f8;font-size:17px;font-weight:800;letter-spacing:.01em">
        Olá ${primeiroNomeGestor || "Gestor"},
      </h2>

      <p style="margin:0 0 12px;color:#c4c9d4;font-size:14px;line-height:1.6">
        O motorista <b style="color:#f3f5f8">${nomeMotorista || "—"}</b> foi analisado pelo nosso validador.
      </p>

      <p style="margin:0 0 16px;color:#c4c9d4;font-size:14px;line-height:1.6">
        Os seguintes documentos precisam de ser corrigidos:
      </p>

      <div style="margin:20px 0">
        ${listaHtml || `<div style="color:#8b95a2;font-size:12px">Consulte o painel para detalhes.</div>`}
      </div>

      <div style="text-align:center;margin:24px 0 8px">
        <a href="${painelUrl}" style="display:inline-block;padding:13px 30px;background:#050507;color:#c4c9d4;font-weight:800;font-size:12px;border-radius:10px;text-decoration:none;letter-spacing:.08em;border:1px solid #c4c9d4;text-transform:uppercase">Corrigir agora</a>
      </div>

      <p style="margin:16px 0 0;color:#8b95a2;font-size:11px;line-height:1.5;text-align:center">
        O motorista não foi notificado — apenas você recebeu este aviso.
      </p>

    </div>

    <p style="text-align:center;color:#8b95a2;font-size:10px;margin:16px 0 0;letter-spacing:.06em">
      REALMETROPOLIS &copy; ${new Date().getFullYear()}
    </p>
  </div>
</body></html>
    `
  };
}

export default router;