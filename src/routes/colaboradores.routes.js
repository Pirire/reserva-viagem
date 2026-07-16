// src/routes/colaboradores.routes.js  (SUBSTITUIR INTEIRO)
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import fs from "fs";
import Colaborador from "../models/colaboradores.js";

const router = Router();
console.log("✅ colaboradores.routes.js carregado");

/* =========================
   Uploads (colaboradores)
========================= */
const uploadsRoot = path.join(process.cwd(), "public", "uploads", "colaboradores");
if (!fs.existsSync(uploadsRoot)) fs.mkdirSync(uploadsRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsRoot),
  filename: (req, file, cb) => {
    const safe = String(file.originalname || "file").replace(/[^\w.\-]+/g, "_");
    const stamp = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${stamp}-${safe}`);
  },
});

const upload = multer({ storage });

function fileMeta(file) {
  if (!file) return null;
  return {
    filename: file.filename,
    mimetype: file.mimetype,
    size: file.size,
    url: `/uploads/colaboradores/${file.filename}`,
    path: `public/uploads/colaboradores/${file.filename}`,
  };
}

/* =========================
   Helpers
========================= */
function pickBody(req, keys, fallback = "") {
  for (const k of keys) {
    const v = req.body?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return fallback;
}

function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase().replace(/\s+/g, "");
}

function isEmailValid(v) {
  const s = normalizeEmail(v);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return false;
  if (/\.\@/.test(s)) return false;
  return true;
}

function getJwtSecret() {
  // Para convites/setup tokens e login
  return String(process.env.JWT_SECRET || process.env.COLAB_JWT_SECRET || "").trim();
}

function normalizeTipo(v) {
  const t = String(v || "").trim().toLowerCase();
  if (["frota", "hotel", "alojamento"].includes(t)) return t;
  return "";
}

/* =========================================================
   1) DEFINIR SENHA por TOKEN (Convite / Primeiro acesso)
   POST /api/colaboradores/definir-senha
   body: { token, email, senha }
   token: JWT com typ="colaborador_setup" (como no teu link)
========================================================= */
router.post("/definir-senha", async (req, res) => {
  try {
    const token = String(req.body?.token || "");
    const senha = String(req.body?.senha || "");

    if (!token) return res.status(400).json({ ok: false, message: "Token ausente." });
    if (senha.length < 6) return res.status(400).json({ ok: false, message: "Senha deve ter pelo menos 6 caracteres." });

    const secret = getJwtSecret();
    if (!secret) return res.status(500).json({ ok: false, message: "JWT_SECRET não definido no .env" });

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch {
      return res.status(400).json({ ok: false, message: "Token inválido/expirado." });
    }
const email = normalizeEmail(payload?.email);

if (!email || !isEmailValid(email)) {
  return res.status(400).json({
    ok: false,
    message: "Token sem email válido."
  });
}
    if (String(payload?.typ || "") !== "colaborador_setup") {
      return res.status(400).json({ ok: false, message: "Token inválido." });
    }

    const id = String(payload?.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, message: "Token sem id." });

    const doc = await Colaborador.findById(id);
    if (!doc) return res.status(404).json({ ok: false, message: "Colaborador não encontrado." });

    doc.email = email;
    doc.passwordHash = await bcrypt.hash(senha, 10);

    // IMPORTANTE:
    // - Não aprova automaticamente (mantém aprovado=false)
    // - A validação/admin master é quem aprova depois
    doc.validacao = doc.validacao || {};
    if (!doc.validacao.status) doc.validacao.status = "pendente";

    await doc.save();

    return res.json({ ok: true, message: "Senha definida com sucesso. Aguarda aprovação." });
  } catch (err) {
    console.error("❌ POST /api/colaboradores/definir-senha:", err);
    return res.status(500).json({ ok: false, message: "Erro ao definir senha." });
  }
});

/* =========================================================
   3) LOGIN — Gestor de Frota / Colaborador
   POST /api/colaboradores/login
   body: { email, senha }

   Retorna cookie httpOnly com JWT do colaborador; o middleware
   authColaborador (a criar/usar noutras rotas) verifica esta
   cookie para autorizar operações no painel do gestor.

   Rejeita se: credenciais erradas, aprovado=false, ou passwordHash
   ainda não definida (colaborador criado por convite mas ainda
   não passou pelo passo de definir-senha).
========================================================= */
router.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const senha = String(req.body?.senha || req.body?.password || "");

    if (!email || !senha) {
      return res.status(400).json({ ok: false, message: "Email e senha obrigatórios." });
    }
    if (!isEmailValid(email)) {
      return res.status(400).json({ ok: false, message: "Email inválido." });
    }

    const colab = await Colaborador.findOne({ email });
    // Mensagem única para "não existe" e "senha errada" — evita
    // enumeração de contas (padrão de segurança). O log interno
    // regista o motivo real para diagnóstico.
    if (!colab) {
      console.warn(`[colab/login] ${email} — não encontrado`);
      return res.status(401).json({ ok: false, message: "Credenciais inválidas." });
    }

    if (!colab.passwordHash) {
      // Colaborador criado pelo admin/convite mas ainda não definiu senha.
      // Mensagem clara — não é "senha errada", é fluxo em falta.
      return res.status(403).json({
        ok: false,
        message: "A sua conta ainda não tem senha definida. Verifique o email de convite."
      });
    }

    const ok = await bcrypt.compare(senha, colab.passwordHash);
    if (!ok) {
      console.warn(`[colab/login] ${email} — senha errada`);
      return res.status(401).json({ ok: false, message: "Credenciais inválidas." });
    }

    if (!colab.aprovado) {
      return res.status(403).json({
        ok: false,
        message: "A sua conta ainda não foi aprovada. Aguarde validação."
      });
    }

    const secret = getJwtSecret();
    if (!secret) {
      console.error("[colab/login] JWT_SECRET não configurado!");
      return res.status(500).json({ ok: false, message: "Configuração inválida (contacte suporte)." });
    }

    const token = jwt.sign(
      {
        typ:   "colaborador_session",
        id:    String(colab._id),
        email: colab.email,
        tipo:  colab.tipo || "",
      },
      secret,
      { expiresIn: "12h" }
    );

    // Cookie httpOnly — inacessível a JS do browser (proteção XSS).
    // sameSite=lax para funcionar em navegação normal mas bloquear CSRF cross-site.
    res.cookie("colab_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure:   process.env.NODE_ENV === "production",
      maxAge:   12 * 60 * 60 * 1000,   // 12h — igual à expiração do JWT
      path:     "/",
    });

    console.log(`✅ [colab/login] ${email} entrou (tipo=${colab.tipo})`);

    return res.json({
      ok: true,
      message: "Login efectuado.",
      colaborador: {
        id:      String(colab._id),
        nome:    colab.nome,
        email:   colab.email,
        empresa: colab.empresa,
        tipo:    colab.tipo,
      },
    });
  } catch (err) {
    console.error("❌ POST /api/colaboradores/login:", err);
    return res.status(500).json({ ok: false, message: "Erro ao autenticar." });
  }
});

/* =========================================================
   4) LOGOUT — Colaborador
   POST /api/colaboradores/logout
========================================================= */
router.post("/logout", (req, res) => {
  res.clearCookie("colab_token", { path: "/" });
  return res.json({ ok: true, message: "Sessão terminada." });
});

/* =========================================================
   5) ME — Dados do colaborador autenticado (sessão actual)
   GET /api/colaboradores/me
========================================================= */
router.get("/me", async (req, res) => {
  try {
    const token = req.cookies?.colab_token;
    if (!token) return res.status(401).json({ ok: false, message: "Não autenticado." });

    const secret = getJwtSecret();
    let payload;
    try { payload = jwt.verify(token, secret); }
    catch { return res.status(401).json({ ok: false, message: "Sessão expirada." }); }

    if (payload?.typ !== "colaborador_session") {
      return res.status(401).json({ ok: false, message: "Token inválido." });
    }

    const colab = await Colaborador.findById(payload.id).lean();
    if (!colab) return res.status(404).json({ ok: false, message: "Colaborador não encontrado." });

    return res.json({
      ok: true,
      colaborador: {
        id:       String(colab._id),
        nome:     colab.nome,
        email:    colab.email,
        empresa:  colab.empresa,
        tipo:     colab.tipo,
        aprovado: colab.aprovado,
      },
    });
  } catch (err) {
    console.error("❌ GET /api/colaboradores/me:", err);
    return res.status(500).json({ ok: false, message: "Erro interno." });
  }
});

/* =========================================================
   6) REGISTER (mantém o teu)
========================================================= */
router.post(
  "/register",
  upload.fields([
  { name: "certidaoPermanente", maxCount: 1 },
  { name: "seguroResponsabilidadeCivil", maxCount: 1 },
  { name: "seguroAcidenteTrabalho", maxCount: 1 },
  { name: "autorizacaoImtt", maxCount: 1 },
  { name: "ibanComprovativo", maxCount: 1 }
]),
  async (req, res) => {
    try {
      const empresaRaw = pickBody(req, ["empresa", "nomeEmpresa", "company", "nome"]);
      const nomeRaw = pickBody(req, ["nomeColaborador", "nome"]);
      const emailRaw = pickBody(req, ["email", "e-mail", "e_mail", "mail"]);
      const contactoRaw = pickBody(req, ["contacto", "contato", "telefone", "phone"]);
      const senhaRaw = pickBody(req, ["senha", "password", "pass", "pwd"]);
      const tipoRaw = pickBody(req, ["tipo", "colabTipo", "colabTipoEmpresa", "tipoEmpresa"]);

      const concelhoRaw = pickBody(req, ["concelho"]);
      const cidadeRaw   = pickBody(req, ["cidade"]);
      const nifRaw      = pickBody(req, ["nif"]);

      const empresa  = String(empresaRaw  || "").trim();
      const nome     = String(nomeRaw     || "").trim();
      const email    = normalizeEmail(emailRaw);
      const contacto = String(contactoRaw || "").trim();
      const senha    = String(senhaRaw    || "").trim();
      const tipo     = normalizeTipo(tipoRaw);
      const concelho = String(concelhoRaw || "").trim();
      const cidade   = String(cidadeRaw   || "").trim();
      const nif      = String(nifRaw      || "").trim();

      if (!empresa || !email || !contacto || !senha || !tipo) {
        return res.status(400).json({
          ok: false,
          message: "Campos obrigatórios: empresa, email, contacto, senha, tipo.",
        });
      }

      if (!isEmailValid(email)) {
        return res.status(400).json({ ok: false, message: "Email inválido." });
      }

      if (senha.length < 4) {
        return res.status(400).json({ ok: false, message: "Senha muito curta." });
      }

      if (tipo === "frota" && (!concelho || !cidade)) {
        return res.status(400).json({
          ok: false,
          message: "Para tipo 'frota', concelho e cidade são obrigatórios.",
        });
      }

      const files = req.files || {};
      const certidao  = files.certidaoPermanente?.[0]          || null;
      const respCivil = files.seguroResponsabilidadeCivil?.[0] || null;
      const acidente  = files.seguroAcidenteTrabalho?.[0]      || null;
      const imtt      = files.autorizacaoImtt?.[0]             || null;

      if (tipo === "frota") {
        if (!certidao || !respCivil || !acidente) {
          return res.status(400).json({
            ok: false,
            message: "Operador de Frota: é obrigatório enviar Certidão Permanente, Seguro RC e Seguro de Acidente de Trabalho.",
          });
        }
      }

      const passwordHash = await bcrypt.hash(senha, 10);

      const documentos = {
        certidaoPermanente:          certidao  ? { file: fileMeta(certidao),  validade: req.body.validadeCertidao || null } : undefined,
        seguroResponsabilidadeCivil: respCivil ? { file: fileMeta(respCivil), validade: req.body.validadeSeguroRC  || null } : undefined,
        seguroAcidenteTrabalho:      acidente  ? { file: fileMeta(acidente),  validade: req.body.validadeSeguroAT  || null } : undefined,
        autorizacaoImtt:             imtt      ? { file: fileMeta(imtt),      validade: req.body.validadeImtt       || null } : undefined,
      };
      Object.keys(documentos).forEach(k => documentos[k] === undefined && delete documentos[k]);

      // Se o colaborador já existe (criado pelo admin) E não tem senha → actualizar com documentos
      const exists = await Colaborador.findOne({ email });
      if (exists) {
        if (!exists.passwordHash || exists.passwordHash === "") {
          exists.empresa   = empresa   || exists.empresa;
          exists.nome      = nome      || exists.nome;
          exists.nif       = nif       || exists.nif;
          exists.contacto  = contacto  || exists.contacto;
          exists.concelho  = concelho  || exists.concelho;
          exists.cidade    = cidade    || exists.cidade;
          exists.documentos = documentos;
          exists.validacao  = { status: "pendente", observacoes: "" };
          await exists.save();
          return res.json({
            ok: true,
            message: "Documentos submetidos com sucesso! Aguarda aprovação.",
            user: { id: String(exists._id), empresa: exists.empresa, email: exists.email, tipo: exists.tipo }
          });
        }
        return res.status(409).json({ ok: false, message: "Email já registado." });
      }

      const doc = await Colaborador.create({
        empresa,
        nome,
        nif,
        email,
        contacto,
        tipo,
        concelho: tipo === "frota" ? concelho : "",
        cidade:   tipo === "frota" ? cidade   : "",
        aprovado: false,
        passwordHash,
        documentos,
        validacao: { status: "pendente", observacoes: "" },
      });

      return res.json({
        ok: true,
        message: "Registo efetuado com sucesso! Aguarda aprovação.",
        user: {
          id: String(doc._id),
          empresa: doc.empresa,
          nome: doc.nome,
          nif: doc.nif,
          email: doc.email,
          contacto: doc.contacto,
          tipo: doc.tipo,
          aprovado: doc.aprovado,
          concelho: doc.concelho,
          cidade: doc.cidade,
        },
      });
    } catch (err) {
  console.error("====================================");
  console.error("ERRO EM /api/colaboradores/register");
  console.error(err);
  console.error(err.stack);

  if (err?.code === 11000) {
    return res.status(409).json({
      ok: false,
      message: "Email já registado."
    });
  }

  return res.status(500).json({
    ok: false,
    message: err.message,
    name: err.name,
    stack: err.stack
  });
}
});

export default router;