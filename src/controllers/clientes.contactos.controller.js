// src/controllers/clientes.contactos.controller.js
import Cliente from "../models/Cliente.js";
import mongoose from "mongoose";

function err(msg, code = 400) {
  const e = new Error(msg);
  e.statusCode = code;
  return e;
}

/* ─── GET /api/clientes/me/contactos ────────────────────────── */
export async function listarContactos(req, res, next) {
  try {
    const cliente = await Cliente.findById(req.cliente._id)
      .select("contactos")
      .lean();

    if (!cliente) return next(err("Cliente não encontrado.", 404));

    return res.json({
      ok: true,
      contactos: cliente.contactos || [],
    });
  } catch (e) { next(e); }
}

/* ─── POST /api/clientes/me/contactos ───────────────────────── */
export async function adicionarContacto(req, res, next) {
  try {
    const nome = String(req.body?.nome || "").trim();
    const tel  = String(req.body?.tel  || "").trim();

    if (!nome) return next(err("Nome é obrigatório."));
    if (!tel)  return next(err("Contacto (tel) é obrigatório."));

    // Valida formato básico (+ opcional, dígitos, espaços, hífenes)
    if (!/^[+\d\s\-().]{6,20}$/.test(tel)) {
      return next(err("Formato de contacto inválido."));
    }

    const cliente = await Cliente.findById(req.cliente._id);
    if (!cliente) return next(err("Cliente não encontrado.", 404));

    // Evitar duplicados pelo número
    const telNorm = tel.replace(/\s/g, "");
    if ((cliente.contactos || []).some(c => c.tel.replace(/\s/g, "") === telNorm)) {
      return next(err("Este contacto já existe."));
    }

    // Limite de segurança
    if ((cliente.contactos || []).length >= 50) {
      return next(err("Limite de 50 contactos atingido."));
    }

    cliente.contactos = cliente.contactos || [];
    cliente.contactos.push({ nome, tel });
    await cliente.save();

    return res.status(201).json({
      ok: true,
      message: "Contacto adicionado.",
      contactos: cliente.contactos,
    });
  } catch (e) { next(e); }
}

/* ─── DELETE /api/clientes/me/contactos/:id ─────────────────── */
export async function removerContacto(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(err("ID inválido."));
    }

    const cliente = await Cliente.findById(req.cliente._id);
    if (!cliente) return next(err("Cliente não encontrado.", 404));

    const antes = (cliente.contactos || []).length;
    cliente.contactos = (cliente.contactos || []).filter(
      c => String(c._id) !== String(id)
    );

    if (cliente.contactos.length === antes) {
      return next(err("Contacto não encontrado.", 404));
    }

    await cliente.save();

    return res.json({
      ok: true,
      message: "Contacto removido.",
      contactos: cliente.contactos,
    });
  } catch (e) { next(e); }
}