// src/routes/veiculos.routes.js
import express from "express";
import multer  from "multer";
import path    from "path";
import fs      from "fs";
import jwt     from "jsonwebtoken";
import Veiculo from "../models/Veiculo.js";
import VehicleCategoryRule, { normalizarMarcaModelo } from "../models/VehicleCategoryRule.js";

const router = express.Router();

// ── Upload ───────────────────────────────────────────────────
const uploadsDir = path.join(process.cwd(), "public", "uploads", "veiculos");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename:    (_req, file, cb) => {
    const safe  = file.originalname.replace(/[^\w.\-]+/g, "_");
    const stamp = Date.now() + "-" + Math.round(Math.random() * 1e6);
    cb(null, `${stamp}-${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// ── Auth helper — lê cookie do gestor/colaborador OU admin ───
// O modal "+ VEÍCULO" do admin-gestao.html é usado por admins,
// que têm cookie admin_token (ou Bearer), não rm_colaborador_token/
// rm_parceiro_token. Sem isto, requireGestor rejeitava sempre o
// pedido com 401 e o veículo nunca era criado (marca/modelo
// "não ficavam guardados" porque o registo inteiro falhava).
function extrairGestor(req) {
  // 1) Gestor de frota / parceiro (fluxo original)
  try {
    const token = req.cookies?.rm_colaborador_token || req.cookies?.rm_parceiro_token || "";
    if (token) {
      const secret = process.env.JWT_SECRET || "";
      const p = jwt.verify(token, secret);
      return { id: String(p.id || ""), nome: String(p.nome || p.empresa || ""), email: String(p.email || ""), empresa: String(p.empresa || "") };
    }
  } catch { /* tenta admin a seguir */ }

  // 2) Admin (admin_token cookie ou Bearer)
  try {
    const bearer = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim()
      : "";
    const adminToken = bearer || req.cookies?.admin_token || req.cookies?.token || "";
    if (!adminToken) return null;
    const secret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || "";
    const p = jwt.verify(adminToken, secret);
    return {
      id:      String(p._id || p.id || p.sub || ""),
      nome:    String(p.nome || p.name || "Admin"),
      email:   String(p.email || ""),
      empresa: "REALMETROPOLIS (admin)",
    };
  } catch { return null; }
}

function requireGestor(req, res, next) {
  const g = extrairGestor(req);
  if (!g) return res.status(401).json({ ok: false, message: "Sessão de gestor necessária." });
  req.gestor = g;
  next();
}

function toDoc(file) {
  if (!file) return null;
  const rawPath = String(file.path || "").replace(/\\/g, "/");
  const idx     = rawPath.indexOf("uploads/");
  const relPath = idx !== -1 ? "/" + rawPath.slice(idx) : "/uploads/veiculos/" + file.filename;
  return {
    file: { filename: file.filename, mimetype: file.mimetype, size: file.size, url: relPath, path: relPath },
    validade: null,
    meta: { nome: file.originalname, numeroDocumento: "", validade: "", tipo: "" },
  };
}

/* ============================================================
   POST /api/veiculos/registo
   Operador de frota regista um veículo
============================================================ */
router.post("/registo",
  requireGestor,
  upload.fields([
    { name: "duaFrente",       maxCount: 1 },
    { name: "duaVerso",        maxCount: 1 },
    { name: "inspecaoDoc",     maxCount: 1 },
    { name: "seguroDoc",       maxCount: 1 },
    { name: "autorizacaoDoc",  maxCount: 1 },
    { name: "fotos",           maxCount: 8  },
  ]),
  async (req, res) => {
    try {
      const b = req.body || {};
      const f = req.files || {};

      const marca     = String(b.marca     || "").trim();
      const modelo    = String(b.modelo    || "").trim();
      const matricula = String(b.matricula || "").trim().toUpperCase();

      if (!marca)     return res.status(400).json({ ok: false, message: "Marca obrigatória." });
      if (!modelo)    return res.status(400).json({ ok: false, message: "Modelo obrigatório." });
      if (!matricula) return res.status(400).json({ ok: false, message: "Matrícula obrigatória." });

      const existe = await Veiculo.findOne({ matricula }).lean();
      if (existe) return res.status(409).json({ ok: false, message: "Matrícula já registada." });

      // ── Categoria derivada AUTOMATICAMENTE da regra Marca/Modelo ──
      // Deixou de ser uma escolha manual no formulário (fonte de
      // erros: categorias inválidas, inconsistentes entre veículos
      // do mesmo modelo). Se o admin ainda não configurou esta
      // combinação Marca+Modelo no painel "Categorias Veículos",
      // o registo é bloqueado — não há fallback silencioso.
      const regraCategoria = await VehicleCategoryRule.findOne({
        marca:  normalizarMarcaModelo(marca),
        modelo: normalizarMarcaModelo(modelo),
      }).lean();

      if (!regraCategoria || !regraCategoria.categorias?.length) {
        return res.status(400).json({
          ok: false,
          message: `Modelo "${marca} ${modelo}" ainda não tem categorias configuradas. Contacte o administrador para as adicionar em "Categorias Veículos" antes de registar este veículo.`,
        });
      }

      const dua = toDoc(f.duaFrente?.[0]);
      if (dua && b.duaValidade) dua.validade = new Date(b.duaValidade);

      const inspecao = toDoc(f.inspecaoDoc?.[0]);
      if (inspecao && b.inspecaoValidade) inspecao.validade = new Date(b.inspecaoValidade);

      const seguro = toDoc(f.seguroDoc?.[0]);
      if (seguro && b.seguroValidade) seguro.validade = new Date(b.seguroValidade);

      const fotos = (f.fotos || []).map(fi => ({ file: toDoc(fi)?.file, meta: { nome: fi.originalname, tipo: "foto" } }));

      const veiculo = await Veiculo.create({
        marca, modelo, matricula,
        cor:       String(b.cor  || "").trim(),
        ano:       b.ano ? Number(b.ano) : null,
        // Categoria PRINCIPAL = primeira da regra (convenção: a
        // primeira categoria assinalada pelo admin é a "principal",
        // usada pelo motor de preços/reserva do hotel).
        categoria:            regraCategoria.categorias[0],
        // Teto fixo — só o admin muda isto, editando a regra.
        categoriasPermitidas: regraCategoria.categorias,
        // Por defeito, tudo o que está autorizado começa ligado; o
        // motorista pode desligar (nunca ligar fora do permitido).
        categoriasAtivas:     regraCategoria.categorias,
        gestorId:  req.gestor.id || null,
        gestor:    { nome: req.gestor.nome, email: req.gestor.email, empresa: req.gestor.empresa },
        documentos: { dua, inspecao, seguro },
        fotos,
        aprovacao: "pendente",
        estado:    "pendente",
        validacao: { status: "pendente" },
      });

      console.log(`✅ Veículo registado: ${matricula} por ${req.gestor.email}`);
      return res.status(201).json({ ok: true, success: true, message: "Veículo enviado para validação.", veiculo: { _id: veiculo._id, matricula, marca, modelo } });
    } catch (err) {
      console.error("❌ POST /veiculos/registo:", err);
      return res.status(500).json({ ok: false, message: err.message || "Erro interno." });
    }
  }
);

/* ============================================================
   GET /api/veiculos/categorias-disponiveis
   Lista o catálogo Marca/Modelo → categorias, para os SELECTS do
   formulário de registo (veiculo-registo.html). Só leitura — criar/
   editar/apagar regras continua exclusivo ao admin, em
   /api/admin/vehicle-categories. Esta rota existe porque
   requireAdmin não aceita sessão de gestor, e o gestor também
   precisa de ver o catálogo para poder escolher dele, não só o
   admin.
============================================================ */
router.get("/categorias-disponiveis", requireGestor, async (_req, res) => {
  try {
    const regras = await VehicleCategoryRule.find({})
      .sort({ marcaLabel: 1, modeloLabel: 1 })
      .lean();

    const porMarca = new Map();
    for (const r of regras) {
      if (!porMarca.has(r.marcaLabel)) {
        porMarca.set(r.marcaLabel, { label: r.marcaLabel, modelos: [] });
      }
      porMarca.get(r.marcaLabel).modelos.push({ label: r.modeloLabel, categorias: r.categorias || [] });
    }

    return res.json({ ok: true, marcas: [...porMarca.values()] });
  } catch (err) {
    console.error("❌ GET /veiculos/categorias-disponiveis:", err);
    return res.status(500).json({ ok: false, message: "Erro ao listar catálogo de categorias." });
  }
});

/* ============================================================
   GET /api/veiculos/meus
   Lista os veículos do próprio gestor
============================================================ */
router.get("/meus", requireGestor, async (req, res) => {
  try {
    const veiculos = await Veiculo.find({ gestorId: req.gestor.id })
      .sort({ createdAt: -1 })
      .select("marca modelo matricula cor ano categoria aprovacao validacao createdAt documentos.dua")
      .lean();
    return res.json({ ok: true, veiculos });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Erro ao listar veículos." });
  }
});

/* ============================================================
   GET /api/veiculos/todos  (admin)
   Lista todos os veículos
============================================================ */
router.get("/todos", async (req, res) => {
  try {
    const status = String(req.query.status || "all");
    const filtro = {};
    if (status !== "all") filtro.aprovacao = status;
    const veiculos = await Veiculo.find(filtro).sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, veiculos });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Erro ao listar veículos." });
  }
});

export default router;