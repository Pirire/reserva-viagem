import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");
const MOTORISTAS_DIR = path.join(UPLOADS_DIR, "motoristas");
const VEICULOS_DIR = path.join(UPLOADS_DIR, "veiculos");

fs.mkdirSync(MOTORISTAS_DIR, { recursive: true });
fs.mkdirSync(VEICULOS_DIR, { recursive: true });

if (!global.rmSubmissoes) {
  global.rmSubmissoes = {
    motoristas: [],
    veiculos: []
  };
}

function sanitizeFileName(name = "") {
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildStoredName(prefix, originalName = "") {
  const ext = path.extname(originalName || "") || "";
  const base = sanitizeFileName(path.basename(originalName || "ficheiro", ext)) || "ficheiro";
  return `${Date.now()}-${prefix}-${base}${ext}`;
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    if (req.path.includes("/motoristas/")) {
      return cb(null, MOTORISTAS_DIR);
    }
    return cb(null, VEICULOS_DIR);
  },
  filename(req, file, cb) {
    cb(null, buildStoredName(file.fieldname, file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024
  }
});

const uploadMotorista = upload.fields([
  { name: "fotoRosto", maxCount: 1 },
  { name: "ibanComprovativo", maxCount: 1 },
  { name: "docIdFrente", maxCount: 1 },
  { name: "docIdVerso", maxCount: 1 },
  { name: "docObgIdFrente", maxCount: 1 },
  { name: "docObgIdVerso", maxCount: 1 },
  { name: "cartaFrente", maxCount: 1 },
  { name: "cartaVerso", maxCount: 1 },
  { name: "imttTvde", maxCount: 1 }
]);

const uploadVeiculo = upload.fields([
  { name: "duaFrente", maxCount: 1 },
  { name: "duaVerso", maxCount: 1 },
  { name: "inspecaoDoc", maxCount: 1 },
  { name: "seguroDoc", maxCount: 1 },
  { name: "autorizacaoDoc", maxCount: 1 },
  { name: "dua", maxCount: 1 },
  { name: "seguro", maxCount: 1 },
  { name: "inspecao", maxCount: 1 },
  { name: "livrete", maxCount: 1 }
]);

function fileToPublicUrl(file, folder) {
  if (!file?.filename) return "";
  return `/uploads/${folder}/${file.filename}`;
}

function getUploadedFile(req, fieldName) {
  const file = req.files?.[fieldName]?.[0];
  if (!file) return null;

  const folder = req.path.includes("/motoristas/") ? "motoristas" : "veiculos";
  const url = fileToPublicUrl(file, folder);

  return {
    nome: file.originalname || file.filename,
    filename: file.filename,
    mimetype: file.mimetype || "",
    size: file.size || 0,
    path: url,
    fileUrl: url,
    url
  };
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function buildMotoristaDocuments(req) {
  return {
    fotoRosto: getUploadedFile(req, "fotoRosto"),
    ibanComprovativo: getUploadedFile(req, "ibanComprovativo"),
    docIdFrente: getUploadedFile(req, "docIdFrente"),
    docIdVerso: getUploadedFile(req, "docIdVerso"),
    docObgIdFrente: getUploadedFile(req, "docObgIdFrente"),
    docObgIdVerso: getUploadedFile(req, "docObgIdVerso"),
    cartaFrente: getUploadedFile(req, "cartaFrente"),
    cartaVerso: getUploadedFile(req, "cartaVerso"),
    imttTvde: getUploadedFile(req, "imttTvde")
  };
}

function buildVeiculoDocuments(req) {
  const duaFrente = getUploadedFile(req, "duaFrente");
  const duaVerso = getUploadedFile(req, "duaVerso");
  const inspecaoDoc = getUploadedFile(req, "inspecaoDoc") || getUploadedFile(req, "inspecao");
  const seguroDoc = getUploadedFile(req, "seguroDoc") || getUploadedFile(req, "seguro");
  const autorizacaoDoc = getUploadedFile(req, "autorizacaoDoc");
  const livrete = getUploadedFile(req, "livrete");
  const duaSingle = getUploadedFile(req, "dua");

  return {
    duaFrente: duaFrente || duaSingle,
    duaVerso: duaVerso,
    inspecaoDoc,
    seguroDoc,
    autorizacaoDoc,
    livrete,

    // compatibilidade com painel antigo
    dua: {
      frente: duaFrente || duaSingle,
      verso: duaVerso,
      url: duaFrente?.url || duaSingle?.url || "",
      fileUrl: duaFrente?.url || duaSingle?.url || ""
    },
    inspecao: inspecaoDoc,
    seguro: seguroDoc
  };
}

function buildMotoristaRegisto(req) {
  const body = req.body || {};
  const documentos = buildMotoristaDocuments(req);

  return {
    id: Date.now().toString(),
    _id: Date.now().toString(),
    entityId: Date.now().toString(),
    entityType: "driver",
    tipo: "motorista",
    estado: "pendente",
    status: "pendente",
    criadoEm: new Date().toISOString(),
    createdAt: new Date().toISOString(),

    nome: normalizeText(body.nome),
    email: normalizeText(body.email),
    contacto: normalizeText(body.contacto || body.telefone),
    nif: normalizeText(body.nif),

    ownerName: normalizeText(body.nome),
    ownerEmail: normalizeText(body.email),
    ownerContact: normalizeText(body.contacto || body.telefone),

    empresa: normalizeText(body.empresa),
    gestorNome: normalizeText(body.gestorNome || body.gestor),
    gestor: {
      empresa: normalizeText(body.empresa) || "Sem empresa / gestor",
      gestorNome: normalizeText(body.gestorNome || body.gestor) || "Sem gestor"
    },

    validades: {
      docIdValidade: normalizeText(body.docIdValidade),
      docObgIdValidade: normalizeText(body.docObgIdValidade),
      cartaValidade: normalizeText(body.cartaValidade),
      imttTvdeValidade: normalizeText(body.imttTvdeValidade)
    },

    documentos,
    documents: documentos,
    docs: documentos
  };
}

function buildVeiculoRegisto(req) {
  const body = req.body || {};
  const documentos = buildVeiculoDocuments(req);
  const nowId = Date.now().toString();

  return {
    id: nowId,
    _id: nowId,
    entityId: nowId,
    entityType: "vehicle",
    tipo: "veiculo",
    estado: "pendente",
    status: "pendente",
    criadoEm: new Date().toISOString(),
    createdAt: new Date().toISOString(),

    marca: normalizeText(body.marca),
    modelo: normalizeText(body.modelo),
    matricula: normalizeText(body.matricula).toUpperCase(),
    cor: normalizeText(body.cor),
    ano: normalizeText(body.ano),

    nome: `${normalizeText(body.marca)} ${normalizeText(body.modelo)}`.trim() || normalizeText(body.matricula).toUpperCase() || "Veículo",
    email: normalizeText(body.email || body.ownerEmail),
    contacto: normalizeText(body.contacto || body.ownerContact),
    nif: normalizeText(body.nif || ""),
    ownerName: normalizeText(body.ownerName || ""),
    ownerEmail: normalizeText(body.ownerEmail || body.email),
    ownerContact: normalizeText(body.ownerContact || body.contacto),

    empresa: normalizeText(body.empresa),
    gestorNome: normalizeText(body.gestorNome || body.gestor),
    gestor: {
      empresa: normalizeText(body.empresa) || "Sem empresa / gestor",
      gestorNome: normalizeText(body.gestorNome || body.gestor) || "Sem gestor"
    },

    validades: {
      duaValidade: normalizeText(body.duaValidade),
      inspecaoValidade: normalizeText(body.inspecaoValidade),
      seguroValidade: normalizeText(body.seguroValidade),
      autorizacaoValidade: normalizeText(body.autorizacaoValidade)
    },

    documentos,
    documents: documentos,
    docs: documentos
  };
}

router.post("/motoristas/registo", uploadMotorista, (req, res) => {
  try {
    const registo = buildMotoristaRegisto(req);

    global.rmSubmissoes.motoristas.unshift(registo);

    console.log("✅ Motorista guardado:", registo.nome || "(sem nome)");
    console.log("📦 Pendentes motoristas:", global.rmSubmissoes.motoristas.length);

    return res.status(201).json({
      ok: true,
      message: "Motorista registado com sucesso.",
      registo,
      motorista: registo
    });
  } catch (err) {
    console.error("❌ Erro ao guardar motorista:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro ao registar motorista."
    });
  }
});

router.post("/veiculos/registo", uploadVeiculo, (req, res) => {
  try {
    const registo = buildVeiculoRegisto(req);

    global.rmSubmissoes.veiculos.unshift(registo);

    console.log("✅ Veículo guardado:", registo.matricula || "(sem matrícula)");
    console.log("📦 Pendentes veículos:", global.rmSubmissoes.veiculos.length);

    return res.status(201).json({
      ok: true,
      message: "Veículo registado com sucesso.",
      registo,
      veiculo: registo
    });
  } catch (err) {
    console.error("❌ Erro ao guardar veículo:", err);
    return res.status(500).json({
      ok: false,
      message: "Erro ao registar veículo."
    });
  }
});

router.get("/admin/validacoes/motoristas", (req, res) => {
  return res.json(global.rmSubmissoes?.motoristas || []);
});

router.get("/admin/validacoes/veiculos", (req, res) => {
  return res.json(global.rmSubmissoes?.veiculos || []);
});

export default router;