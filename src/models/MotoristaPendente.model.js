import mongoose from "mongoose";

const FileSchema = new mongoose.Schema(
  { filename: String, mimetype: String, size: Number, url: String, path: String },
  { _id: false }
);

const DocumentoSchema = new mongoose.Schema(
  { file: { type: FileSchema, default: null }, validade: { type: Date, default: null } },
  { _id: false }
);

const ValidacaoSchema = new mongoose.Schema(
  {
    status: { type: String, default: "pendente" }, // pendente | aprovado | rejeitado
    validadoPorId: { type: String, default: null },
    validadoPorNome: { type: String, default: null },
    validadoEm: { type: Date, default: null },
    checklist: { type: Object, default: {} },
    observacoes: { type: String, default: "" },
  },
  { _id: false }
);

const MotoristaPendenteSchema = new mongoose.Schema(
  {
    frotaId: { type: mongoose.Schema.Types.ObjectId, ref: "Colaborador", required: true },
    inviteId: { type: mongoose.Schema.Types.ObjectId, ref: "InviteMotorista", required: true },

    nome: { type: String, required: true, trim: true },
    sobrenome: { type: String, required: true, trim: true },
    dataNascimento: { type: Date, required: true },

    contacto: { type: String, required: true, trim: true },
    morada: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },

    tipoMotorista: {
      type: String,
      required: true,
      enum: ["executivo", "tvde"],
    },

    documentos: {
      fotoRosto: { type: DocumentoSchema, default: () => ({}) },

      cartaConducaoFrente: { type: DocumentoSchema, default: () => ({}) },
      cartaConducaoVerso: { type: DocumentoSchema, default: () => ({}) },

      ccFrente: { type: DocumentoSchema, default: () => ({}) },
      ccVerso: { type: DocumentoSchema, default: () => ({}) },

      tvdeFrente: { type: DocumentoSchema, default: () => ({}) }, // opcional (se tvde)
      tvdeVerso: { type: DocumentoSchema, default: () => ({}) },  // opcional (se tvde)

      registoCriminal: { type: DocumentoSchema, default: () => ({}) }, // obrigatório
    },

    aprovacao: { type: String, default: "pendente" }, // pendente | aprovado | rejeitado
    validacao: { type: ValidacaoSchema, default: () => ({}) },

    // rastreio
    submittedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

MotoristaPendenteSchema.index({ frotaId: 1, aprovacao: 1, createdAt: -1 });
MotoristaPendenteSchema.index({ inviteId: 1 }, { unique: true });

export default mongoose.model("MotoristaPendente", MotoristaPendenteSchema);
