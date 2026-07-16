// src/middlewares/upload.middleware.js
// ══════════════════════════════════════════════════════════════
// Middleware de upload unificado — substitui upload.js e
// upload_middleware.js (eram duplicados com lógica diferente).
//
// Exports:
//   uploadRegisto  — uploads de registo de motorista/parceiro
//                    organizado por pasta única (req.registoId)
//   upload         — upload genérico para casos simples
//                    (ex: documentos avulso, fotos de perfil)
// ══════════════════════════════════════════════════════════════

import multer from "multer";
import path   from "path";
import fs     from "fs";
import logger from "../config/logger.js";

const UPLOAD_ROOT = path.join(process.cwd(), "public", "uploads");

/* ── Helpers ─────────────────────────────────────────────────── */

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** Tipos de ficheiro permitidos */
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function fileFilter(_req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(
      Object.assign(
        new Error("Formato inválido. Apenas PDF, JPG, PNG ou WEBP são aceites."),
        { statusCode: 415, code: "INVALID_MIME" }
      )
    );
  }
  cb(null, true);
}

/* ── Storage: por registo (motorista / parceiro) ─────────────
   req.registoId deve ser injetado pela rota antes do multer.
   Cria uma pasta isolada por registo — fácil de limpar/mover.
─────────────────────────────────────────────────────────────── */
const storageRegisto = multer.diskStorage({
  destination: (req, file, cb) => {
    const registoId = req.registoId || "sem-id";
    const dest = path.join(UPLOAD_ROOT, "registos", registoId);
    ensureDir(dest);
    cb(null, dest);
  },
  filename: (_req, file, cb) => {
    const ext      = path.extname(file.originalname || "").toLowerCase();
    const safeField = String(file.fieldname || "file").replace(/[^\w-]/g, "_");
    const unique   = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    cb(null, `${safeField}_${unique}${ext}`);
  },
});

/* ── Storage: genérico (pasta raiz de uploads) ───────────────── */
const storageGenerico = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureDir(UPLOAD_ROOT);
    cb(null, UPLOAD_ROOT);
  },
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname || "").toLowerCase();
    const base = path.basename(file.originalname || "file", ext)
      .replace(/\s+/g, "_")
      .replace(/[^\w-]/g, "");
    cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}-${base}${ext}`);
  },
});

/* ── Exports ─────────────────────────────────────────────────── */

/** Upload estruturado por registo — com validação e limites */
export const uploadRegisto = multer({
  storage:    storageRegisto,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB por ficheiro
    files:    15,               // máximo 15 ficheiros por request
  },
});

/** Upload genérico — com validação, sem organização por pasta */
export const upload = multer({
  storage:    storageGenerico,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files:    10,
  },
});