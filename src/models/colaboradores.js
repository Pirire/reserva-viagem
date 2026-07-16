// src/models/colaboradores.js
import mongoose from "mongoose";

const ValidacaoSchema = new mongoose.Schema(
  {
    status: { type: String, default: "pendente" }, // pendente | aprovado | rejeitado
    observacoes: { type: String, default: "" },
    validadoPorId: { type: String, default: null },
    validadoPorNome: { type: String, default: null },
    validadoEm: { type: Date, default: null },
    checklist: { type: Object, default: {} },
  },
  { _id: false }
);

const FileMetaSchema = new mongoose.Schema(
  {
    filename: { type: String, default: "" },
    mimetype: { type: String, default: "" },
    size: { type: Number, default: 0 },
    url: { type: String, default: "" },
    path: { type: String, default: "" },
  },
  { _id: false }
);

const DocumentoSchema = new mongoose.Schema(
  {
    file: { type: FileMetaSchema, default: null },
    validade: { type: Date, default: null },
  },
  { _id: false }
);

const ColaboradorSchema = new mongoose.Schema(
  {
    // ✅ dados base
    empresa: { type: String, default: "", trim: true },
    nome: { type: String, default: "", trim: true },
    nif: { type: String, default: "", trim: true, index: true },
    contacto: { type: String, default: "", trim: true },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
      index: true,
    },

    // frota | hotel | alojamento
    tipo: { type: String, default: "", trim: true, index: true },

    endereco: { type: String, default: "", trim: true },
    responsavelNome: { type: String, default: "", trim: true },

    concelho: { type: String, default: "", trim: true },
    cidade: { type: String, default: "", trim: true },

    aprovado: { type: Boolean, default: false, index: true },

    // ✅ PROFISSIONAL: senha pode ainda não existir no registo por convite
    passwordHash: { type: String, default: "" },

    // ✅ documentos (agora completos)
    documentos: {
      // Operador de Frota (convite-registo-gestor.html)
      certidaoPermanente:         { type: DocumentoSchema, default: null },
      seguroResponsabilidadeCivil:{ type: DocumentoSchema, default: null },
      seguroAcidenteTrabalho:     { type: DocumentoSchema, default: null },
      autorizacaoImtt:            { type: DocumentoSchema, default: null }, // opcional
      // Legacy / Hotel / Alojamento
      certidaoComercial:          { type: DocumentoSchema, default: null },
      identificacaoResponsavel:   { type: DocumentoSchema, default: null }
    },

    validacao: { type: ValidacaoSchema, default: () => ({}) },
  },
  { timestamps: true }
);

const Colaborador =
  mongoose.models.Colaborador || mongoose.model("Colaborador", ColaboradorSchema);

export default Colaborador;