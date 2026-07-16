// src/models/Motorista.js
// ══════════════════════════════════════════════════════════════
// SUBSTITUIR o Motorista.js existente — retrocompatível com todos
// os campos já existentes. Apenas ADICIONA campos novos.
// ══════════════════════════════════════════════════════════════
import mongoose from "mongoose";
import crypto   from "crypto";

const { Schema, model, models } = mongoose;

const FileSchema = new Schema(
  { filename: String, mimetype: String, size: Number, url: String, path: String },
  { _id: false }
);

const MetaDocumentoSchema = new Schema(
  { nome: { type: String, default: "" }, numeroDocumento: { type: String, default: "" },
    validade: { type: String, default: "" }, tipo: { type: String, default: "" } },
  { _id: false }
);

const DocumentoSchema = new Schema(
  { file:     { type: FileSchema,          default: null },
    validade: { type: Date,                default: null },
    meta:     { type: MetaDocumentoSchema, default: () => ({}) },
    status:   { type: String,              default: "pendente" },
    motivos:  { type: [String],            default: [] } },
  { _id: false }
);

const MotoristaSchema = new Schema(
  {
    // ── Campos existentes (inalterados) ───────────────────────
    nome:          { type: String, required: true, trim: true },
    contacto:      { type: String, required: true, trim: true },
    email:         { type: String, required: true, trim: true, lowercase: true, unique: true },
    nif:           { type: String, default: "" },
    iban:          { type: String, default: "" },
    endereco:      { type: String, default: "" },
    documentoTipo: { type: String, default: "" },

    categoria:  { type: String,   default: "ECONOMICA" },
    categorias: { type: [String], default: [] },
    status:     { type: String,   default: "Disponível" },
    idiomas:    { type: [String], default: [] },

    // Gestor que registou — mantém String para retrocompatibilidade
    // mas agora também indexamos gestorId como ObjectId
    gestor: {
      id:      { type: String, default: "" },
      nome:    { type: String, default: "" },
      email:   { type: String, default: "" },
      empresa: { type: String, default: "" },
    },

    documentos: {
      fotoRosto:          { type: DocumentoSchema, default: () => ({}) },
      cc:                 { type: DocumentoSchema, default: () => ({}) },
      ccVerso:            { type: DocumentoSchema, default: () => ({}) },
      tResidencia:        { type: DocumentoSchema, default: () => ({}) },
      tResidenciaVerso:   { type: DocumentoSchema, default: () => ({}) },
      cartaConducao:      { type: DocumentoSchema, default: () => ({}) },
      cartaConducaoVerso: { type: DocumentoSchema, default: () => ({}) },
      tvde:               { type: DocumentoSchema, default: () => ({}) },
      ibanComprovativo:   { type: DocumentoSchema, default: () => ({}) },
      registoCriminal:    { type: DocumentoSchema, default: () => ({}) },
    },

    aprovacao: { type: String, default: "pendente" },

    validacao: {
      status:          { type: String,              default: "pendente" },
      observacoes:     { type: String,              default: "" },
      checklist:       { type: Object,              default: {} },
      validadoEm:      { type: Date,                default: null },
      validadoPorId:   { type: Schema.Types.Mixed,  default: null },
      validadoPorNome: { type: String,              default: "" },
    },

    reenvio: {
      token:     { type: String, default: null },
      tokenHash: { type: String, default: null },
      expiresAt: { type: Date,   default: null },
      usadoEm:   { type: Date,   default: null },
    },

    // Activação de conta — definir senha após aprovação
    setupToken:        { type: String, default: null },
    setupTokenHash:    { type: String, default: null },
    setupTokenExpires: { type: Date,   default: null },
    setupTokenUsadoEm: { type: Date,   default: null },
    passwordHash:      { type: String, default: null },

    // Localização em tempo real (existente em motorista.routes.js)
    lat:  { type: Number, default: null },
    lng:  { type: Number, default: null },
    location: { type: Object, default: null },

    // ── NOVO: Veículo actualmente atribuído ───────────────────
    // null = motorista sem veículo (não pode ser despachado)
    // Definido pelo gestor no portal de gestão.
    // Se o motorista sair, o gestor remove a atribuição — o campo
    // volta a null e pode ser reatribuído a outro motorista.
    veiculoId: {
      type: Schema.Types.ObjectId,
      ref: "Veiculo",
      default: null,
      index: true,
    },

    // ── NOVO: Disponibilidade operacional ─────────────────────
    // true  = livre para receber reservas
    // false = em serviço activo
    disponivel: { type: Boolean, default: true, index: true },

    // ── NOVO: Último veículo usado (atalho "USAR ESTE VEÍCULO") ─
    // Snapshot desnormalizado, gravado automaticamente em
    // POST /api/motorista/veiculo/selecionar/:id assim que a
    // seleção é confirmada. Não é a fonte de verdade sobre o
    // veículo actual (isso é `Veiculo.motoristaId`) — serve só
    // para o frontend sugerir o último veículo sem o motorista
    // ter de o procurar de novo na lista, caso ainda esteja livre.
    ultimoVeiculo: {
      id:           { type: Schema.Types.ObjectId, ref: "Veiculo", default: null },
      marca:        { type: String, default: "" },
      modelo:       { type: String, default: "" },
      matricula:    { type: String, default: "" },
      atualizadoEm: { type: Date,   default: null },
    },

    // ── NOVO: gestorId como ObjectId para queries eficientes ──
    // Mantém o campo gestor.id (String) por retrocompatibilidade
    gestorId: {
      type: Schema.Types.ObjectId,
      ref: "Colaborador",
      default: null,
      index: true,
    },

    // Rating médio calculado a partir dos feedbacks
    rating: { type: Number, default: 5.0, min: 1, max: 5 },
  },
  { timestamps: true }
);

// ── Índices para dispatch ──────────────────────────────────────
MotoristaSchema.index({ disponivel: 1, aprovacao: 1 });
MotoristaSchema.index({ gestorId: 1, aprovacao: 1 });

export default models.Motorista || model("Motorista", MotoristaSchema);