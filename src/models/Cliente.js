// src/models/cliente.js
// ── SaaS-level — campo contactos com índice e validação ───────

import mongoose from "mongoose";

const normalizeEmail = (v) =>
  String(v || "").trim().toLowerCase().replace(/\s+/g, "");

/* ── Sub-schema: Contacto ─────────────────────────────────────
   Cada entrada tem _id automático do Mongoose (ObjectId),
   usado para remoção segura sem depender de índice de array.
─────────────────────────────────────────────────────────────── */
const ContactoSchema = new mongoose.Schema(
  {
    nome: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    tel: {
      type: String,
      required: true,
      trim: true,
      maxlength: 30,
      // Guardado já normalizado pelo controller (apenas dígitos + +)
    },
  },
  {
    timestamps: true, // criadoEm / atualizadoEm por contacto
    _id: true,        // _id explícito — necessário para DELETE por ID
  }
);

/* ── Schema principal: Cliente ───────────────────────────────── */
const ClienteSchema = new mongoose.Schema(
  {
    nome: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      set: normalizeEmail,
      maxlength: 254, // RFC 5321
    },

    contacto: {
      type: String,
      required: true,
      trim: true,
      maxlength: 30,
    },

    passwordHash: {
      type: String,
      required: true,
    },

    // ── Contactos guardados pelo cliente ──────────────────────
    contactos: {
      type: [ContactoSchema],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 50,
        message: "Limite máximo de 50 contactos atingido.",
      },
    },

    createdAt: {
      type: Number,
      default: () => Date.now(),
    },
  },
  { versionKey: false }
);

/* ── Índice para pesquisa rápida por número ───────────────────
   Permite encontrar rapidamente todos os clientes que têm
   um determinado contacto (útil para admin/analytics).
─────────────────────────────────────────────────────────────── */
ClienteSchema.index({ "contactos.tel": 1 }, { sparse: true });

export default mongoose.models.Cliente ||
  mongoose.model("Cliente", ClienteSchema);