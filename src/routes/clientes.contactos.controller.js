// src/controllers/clientes.contactos.controller.js
// ── SaaS-level — validação, sanitização, normalização, erros ──

import Cliente from "../models/Cliente.js";
import mongoose from "mongoose";

/* ══════════════════════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════════════════════ */

function createError(message, statusCode = 400, code = "BAD_REQUEST") {
  const e = new Error(message);
  e.statusCode = statusCode;
  e.code = code;
  return e;
}

/** Remove tags HTML e caracteres de controlo — sem dependências externas */
function sanitizeStr(value, maxLen = 80) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")          // strip HTML tags
    .replace(/[\x00-\x1F\x7F]/g, "") // strip control characters
    .trim()
    .slice(0, maxLen);
}

/**
 * Normaliza número de telefone:
 * - Remove espaços, hífenes, parênteses
 * - Permite + no início (internacional)
 * - Devolve string limpa ou null se inválida
 */
function normalizePhone(raw) {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/[\s\-().]/g, "");

  // Aceita: +351912345678 | 912345678 | +1 (800) 555-0100
  if (!/^\+?\d{6,20}$/.test(cleaned)) return null;
  return cleaned;
}

/** Verifica duplicado ignorando formatação */
function isDuplicate(lista, telNorm) {
  return lista.some(c => normalizePhone(c.tel) === telNorm);
}

/* ══════════════════════════════════════════════════════════════
   GET /api/clientes/me/contactos
   Query params: ?q=texto&page=1&limit=20
══════════════════════════════════════════════════════════════ */
export async function listarContactos(req, res, next) {
  try {
    const q     = sanitizeStr(req.query?.q || "", 60).toLowerCase();
    const page  = Math.max(1, parseInt(req.query?.page  || "1",  10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query?.limit || "20", 10)));

    const cliente = await Cliente.findById(req.cliente._id)
      .select("contactos")
      .lean();

    if (!cliente) return next(createError("Cliente não encontrado.", 404, "NOT_FOUND"));

    let contactos = cliente.contactos || [];

    // Pesquisa por nome ou número
    if (q) {
      contactos = contactos.filter(c =>
        c.nome.toLowerCase().includes(q) || c.tel.includes(q)
      );
    }

    // Ordenar por nome (A→Z)
    contactos.sort((a, b) => a.nome.localeCompare(b.nome, "pt"));

    // Paginação
    const total  = contactos.length;
    const pages  = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const data   = contactos.slice(offset, offset + limit);

    return res.json({
      ok: true,
      contactos: data,
      pagination: { page, limit, total, pages },
    });
  } catch (e) { next(e); }
}

/* ══════════════════════════════════════════════════════════════
   POST /api/clientes/me/contactos
   Body: { nome, tel }
══════════════════════════════════════════════════════════════ */
export async function adicionarContacto(req, res, next) {
  try {
    const nome = sanitizeStr(req.body?.nome, 80);
    const tel  = sanitizeStr(req.body?.tel,  30);

    // Validação de presença
    if (!nome) return next(createError("O campo 'nome' é obrigatório.", 400, "MISSING_NOME"));
    if (!tel)  return next(createError("O campo 'tel' é obrigatório.",  400, "MISSING_TEL"));

    // Validação mínima de tamanho
    if (nome.length < 2) return next(createError("Nome demasiado curto (mínimo 2 caracteres).", 400, "NOME_TOO_SHORT"));

    // Normalização e validação de formato
    const telNorm = normalizePhone(tel);
    if (!telNorm) {
      return next(createError(
        "Formato de contacto inválido. Use apenas dígitos, +, espaços ou hífenes (ex: +351 912 345 678).",
        400, "INVALID_TEL"
      ));
    }

    const cliente = await Cliente.findById(req.cliente._id);
    if (!cliente) return next(createError("Cliente não encontrado.", 404, "NOT_FOUND"));

    // Duplicado (insensível a formatação)
    if (isDuplicate(cliente.contactos || [], telNorm)) {
      return next(createError("Este número já existe na sua lista de contactos.", 409, "DUPLICATE_TEL"));
    }

    // Limite de segurança
    if ((cliente.contactos || []).length >= 50) {
      return next(createError("Limite máximo de 50 contactos atingido.", 400, "LIMIT_REACHED"));
    }

    cliente.contactos = cliente.contactos || [];
    cliente.contactos.push({ nome, tel: telNorm });
    await cliente.save();

    return res.status(201).json({
      ok: true,
      message: "Contacto adicionado com sucesso.",
      contactos: cliente.contactos,
    });
  } catch (e) { next(e); }
}

/* ══════════════════════════════════════════════════════════════
   DELETE /api/clientes/me/contactos/:id
══════════════════════════════════════════════════════════════ */
export async function removerContacto(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(createError("ID de contacto inválido.", 400, "INVALID_ID"));
    }

    const cliente = await Cliente.findById(req.cliente._id);
    if (!cliente) return next(createError("Cliente não encontrado.", 404, "NOT_FOUND"));

    const antes = (cliente.contactos || []).length;
    cliente.contactos = (cliente.contactos || []).filter(
      c => String(c._id) !== String(id)
    );

    if (cliente.contactos.length === antes) {
      return next(createError("Contacto não encontrado.", 404, "CONTACT_NOT_FOUND"));
    }

    await cliente.save();

    return res.json({
      ok: true,
      message: "Contacto removido com sucesso.",
      contactos: cliente.contactos,
    });
  } catch (e) { next(e); }
}