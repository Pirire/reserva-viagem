// src/routes/shortlink.js
// ══════════════════════════════════════════════════════════════
// Encurtador de links próprio:  BASE/v/A7K9F  →  link longo real.
// Contém o MODELO (ShortLink) e a ROTA/HELPER num só ficheiro,
// para evitar dois ficheiros com nomes parecidos.
// ══════════════════════════════════════════════════════════════
import express from "express";
import mongoose from "mongoose";

/* ── MODELO ─────────────────────────────────────────────────── */
const ShortLinkSchema = new mongoose.Schema(
  {
    codigo:   { type: String, required: true, unique: true, index: true },
    destino:  { type: String, required: true },
    shareId:  { type: String, default: "" },
    inviteId: { type: String, default: "" },
    hits:     { type: Number, default: 0 },
    expiraEm: { type: Date,   default: null },
  },
  { timestamps: true }
);
// TTL: o Mongo apaga o documento quando expiraEm é ultrapassado.
ShortLinkSchema.index({ expiraEm: 1 }, { expireAfterSeconds: 0 });

// Evita "OverwriteModelError" se o ficheiro for importado mais que uma vez.
const ShortLink =
  mongoose.models.ShortLink || mongoose.model("ShortLink", ShortLinkSchema);

/* ── HELPER: criar short link ───────────────────────────────── */
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sem O/0/I/1/l
const TAMANHO = 5;

function gerarCodigo() {
  let s = "";
  for (let i = 0; i < TAMANHO; i++) {
    s += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  }
  return s;
}

/**
 * Cria um short link para um destino.
 * @returns {Promise<{codigo:string, url:string}>}
 */
export async function criarShortLink({ destino, shareId = "", inviteId = "", expiraEm = null, baseUrl }) {
  if (!destino) throw new Error("criarShortLink: destino em falta");
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const exp = expiraEm ? new Date(expiraEm) : null;

  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const codigo = gerarCodigo();
    try {
      await ShortLink.create({ codigo, destino, shareId, inviteId, expiraEm: exp });
      return { codigo, url: `${base}/v/${codigo}` };
    } catch (err) {
      if (err && err.code === 11000) continue; // código repetido → tenta outro
      throw err;
    }
  }
  throw new Error("criarShortLink: não foi possível gerar código único");
}

/* ── ROTA: redirecionamento ─────────────────────────────────── */
const router = express.Router();

router.get("/v/:codigo", async (req, res) => {
  try {
    const codigo = String(req.params.codigo || "").trim();
    if (!codigo) return res.status(404).send("Link inválido.");

    const link = await ShortLink.findOne({ codigo });
    if (!link) {
      return res.status(404).send("Este link não é válido ou já expirou. Contacte o hotel.");
    }
    if (link.expiraEm && Date.now() > new Date(link.expiraEm).getTime()) {
      return res.status(410).send("Este link expirou. Contacte o hotel para um novo.");
    }

    ShortLink.updateOne({ _id: link._id }, { $inc: { hits: 1 } }).catch(() => {});
    return res.redirect(302, link.destino);
  } catch (err) {
    console.error("❌ /v/:codigo:", err);
    return res.status(500).send("Erro ao abrir o link.");
  }
});

export default router;
