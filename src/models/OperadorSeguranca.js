// src/models/OperadorSeguranca.js
import mongoose from "mongoose";

const FileSchema = new mongoose.Schema(
  { filename:{type:String,default:""}, mimetype:{type:String,default:""}, size:{type:Number,default:0}, url:{type:String,default:""}, path:{type:String,default:""} },
  { _id: false }
);
const DocSchema = new mongoose.Schema(
  { file:{type:FileSchema,default:null}, validade:{type:Date,default:null} },
  { _id: false }
);

const OperadorSegurancaSchema = new mongoose.Schema(
  {
    // ── Credenciais ───────────────────────────────────────────
    email:        { type:String, required:true, unique:true, lowercase:true, trim:true, index:true },
    passwordHash: { type:String, default:"" },

    // ── Dados pessoais ────────────────────────────────────────
    nome:     { type:String, default:"", trim:true },
    nif:      { type:String, default:"", trim:true },
    cc:       { type:String, default:"", trim:true },
    contacto: { type:String, default:"", trim:true },
    endereco: { type:String, default:"", trim:true },

    // ── Região de actuação ────────────────────────────────────
    regiao: { type:String, default:"global", trim:true, index:true },
    pais:   { type:String, default:"pt",     trim:true },

    // ── Documentos ────────────────────────────────────────────
    documentos: {
      ccFrente: { type:DocSchema, default:null },
      ccVerso:  { type:DocSchema, default:null },
    },

    // ── Estado ────────────────────────────────────────────────
    aprovado:     { type:Boolean, default:false, index:true },
    tokenHash:    { type:String, default:null, index:true },
    tokenUsadoEm: { type:Date,   default:null },

    // ── Validação pelo admin ──────────────────────────────────
    validacao: {
      status:          { type:String, default:"pendente" },
      observacoes:     { type:String, default:"" },
      validadoEm:      { type:Date,   default:null },
      validadoPorId:   { type:String, default:"" },
      validadoPorNome: { type:String, default:"" },
    },
  },
  { timestamps: true }
);

export default mongoose.models.OperadorSeguranca ||
  mongoose.model("OperadorSeguranca", OperadorSegurancaSchema);