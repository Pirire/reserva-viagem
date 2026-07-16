import mongoose from "mongoose";

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

const DocumentMetaSchema = new mongoose.Schema(
  {
    nome: { type: String, default: "" },
    numeroDocumento: { type: String, default: "" },
  },
  { _id: false }
);

const SingleDocumentSchema = new mongoose.Schema(
  {
    file: { type: FileMetaSchema, default: null },
    validade: { type: Date, default: null },
    meta: { type: DocumentMetaSchema, default: () => ({}) },
  },
  { _id: false }
);

const FinalDecisionDocumentSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    decision: {
      type: String,
      enum: ["approve", "request_new_document", "reject"],
      required: true,
    },
    reasons: { type: String, default: "", trim: true },
    updatedAt: { type: Date, default: Date.now },
    label: { type: String, default: "", trim: true },
    url: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const HistorySchema = new mongoose.Schema(
  {
    action: { type: String, required: true, trim: true },
    byId: { type: String, default: "", trim: true },
    byNome: { type: String, default: "", trim: true },
    byTipo: { type: String, default: "", trim: true },
    observacoes: { type: String, default: "", trim: true },

    workflow: {
      activateEntity: { type: Boolean, default: false },
      requestNewUpload: { type: Boolean, default: false },
      notifyGestor: { type: Boolean, default: false },
      notifyOwner: { type: Boolean, default: false },
      lockForValidators: { type: Boolean, default: false },
      adminMasterOnlyRevalidation: { type: Boolean, default: false },

      activateEntityIfAllApproved: { type: Boolean, default: false },
      notifyGestorIfNeedResend: { type: Boolean, default: false },
      notifyOwnerIfNeedResend: { type: Boolean, default: false },
      lockRejectedForValidators: { type: Boolean, default: false },
    },
  },
  { _id: false, timestamps: true }
);

const ValidationSubmissionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["driver", "vehicle"],
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["pendente", "validado", "pendente_novo_envio", "recusado"],
      default: "pendente",
      index: true,
    },

    gestorId: { type: String, default: "", trim: true, index: true },
    gestorNome: { type: String, default: "", trim: true, index: true },
    gestorEmail: { type: String, default: "", trim: true, lowercase: true, index: true },

    ownerName: { type: String, default: "", trim: true, index: true },
    ownerEmail: { type: String, default: "", trim: true, lowercase: true, index: true },
    ownerContact: { type: String, default: "", trim: true },

    submittedByRole: { type: String, default: "gestor_frota", trim: true },
    submittedAt: { type: Date, default: Date.now, index: true },

    entityRefId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    payload: {
      nome: { type: String, default: "", trim: true },
      contacto: { type: String, default: "", trim: true },
      email: { type: String, default: "", trim: true, lowercase: true },

      categoria: { type: String, default: "", trim: true },
      categorias: { type: [String], default: [] },
      idiomas: { type: [String], default: [] },
      drvIdDocType: { type: String, default: "", trim: true },

      marca: { type: String, default: "", trim: true },
      modelo: { type: String, default: "", trim: true },
      matricula: { type: String, default: "", trim: true },
    },

    documents: {
      fotoRosto: { type: SingleDocumentSchema, default: null },
      cc: { type: SingleDocumentSchema, default: null },
      tResidencia: { type: SingleDocumentSchema, default: null },
      cartaConducao: { type: SingleDocumentSchema, default: null },
      tvde: { type: SingleDocumentSchema, default: null },
      registoCriminal: { type: SingleDocumentSchema, default: null },

      dua: { type: SingleDocumentSchema, default: null },
      duaVerso: { type: SingleDocumentSchema, default: null },
      cartaConducaoVerso: { type: SingleDocumentSchema, default: null },
      tvdeVerso: { type: SingleDocumentSchema, default: null },
      seguro: { type: SingleDocumentSchema, default: null },
      inspecao: { type: SingleDocumentSchema, default: null },

      fotos: { type: [FileMetaSchema], default: [] },
    },

    workflow: {
      activateEntity: { type: Boolean, default: false },
      requestNewUpload: { type: Boolean, default: false },
      notifyGestor: { type: Boolean, default: false },
      notifyOwner: { type: Boolean, default: false },
      lockForValidators: { type: Boolean, default: false },
      adminMasterOnlyRevalidation: { type: Boolean, default: false },

      activateEntityIfAllApproved: { type: Boolean, default: false },
      notifyGestorIfNeedResend: { type: Boolean, default: false },
      notifyOwnerIfNeedResend: { type: Boolean, default: false },
      lockRejectedForValidators: { type: Boolean, default: false },
    },

    decision: {
      observacoes: { type: String, default: "", trim: true },
      decidedAt: { type: Date, default: null },
      decidedById: { type: String, default: "", trim: true },
      decidedByNome: { type: String, default: "", trim: true },
      decidedByTipo: { type: String, default: "", trim: true },
    },

    finalDecision: {
      documents: { type: [FinalDecisionDocumentSchema], default: [] },
      decidedAt: { type: Date, default: null },
      decidedById: { type: String, default: "", trim: true },
      decidedByNome: { type: String, default: "", trim: true },
      decidedByTipo: { type: String, default: "", trim: true },
    },

    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true }
);

ValidationSubmissionSchema.index({ type: 1, status: 1, gestorNome: 1, createdAt: -1 });
ValidationSubmissionSchema.index({ ownerEmail: 1, type: 1 });
ValidationSubmissionSchema.index({ entityRefId: 1 });

export default mongoose.models.ValidationSubmission ||
  mongoose.model("ValidationSubmission", ValidationSubmissionSchema);