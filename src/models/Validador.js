// src/models/Validador.js
import mongoose from "mongoose";

const FileSchema = new mongoose.Schema(
  { filename:{type:String,default:""}, mimetype:{type:String,default:""}, size:{type:Number,default:0}, url:{type:String,default:""}, path:{type:String,default:""} },
  { _id: false }
);
const DocumentoSchema = new mongoose.Schema(
  { file:{type:FileSchema,default:null}, validade:{type:Date,default:null} },
  { _id: false }
);

const ValidadorSchema = new mongoose.Schema(
  {
    email:        { type:String, required:true, unique:true, lowercase:true, trim:true, index:true },
    passwordHash: { type:String, default:"" },
    nome:         { type:String, default:"", trim:true },
    nif:          { type:String, default:"", trim:true },
    cc:           { type:String, default:"", trim:true },
    contacto:     { type:String, default:"", trim:true },
    endereco:     { type:String, default:"", trim:true },
    scope: {
      type: String,
      enum: ["motoristas","veiculos","empresa","global"],
      required: true,
    },
    documentos: {
      ccFrente: { type:DocumentoSchema, default:null },
      ccVerso:  { type:DocumentoSchema, default:null },
      morada:   { type:DocumentoSchema, default:null },
      outro:    { type:DocumentoSchema, default:null },
    },
    aprovado:     { type:Boolean, default:false },
    tokenHash:    { type:String, default:null, index:true },
    tokenUsadoEm: { type:Date,   default:null },
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

export default mongoose.models.Validador || mongoose.model("Validador", ValidadorSchema);