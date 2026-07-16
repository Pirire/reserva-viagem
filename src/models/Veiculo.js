// src/models/Veiculo.js
// ══════════════════════════════════════════════════════════════
// SUBSTITUIR o Veiculo.js existente — retrocompatível com todos
// os campos já existentes. Apenas ADICIONA campos novos.
// ══════════════════════════════════════════════════════════════
import mongoose from "mongoose";

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
    meta:     { type: MetaDocumentoSchema, default: () => ({}) } },
  { _id: false }
);

const FotoVeiculoSchema = new Schema(
  { file: { type: FileSchema,          default: null },
    meta: { type: MetaDocumentoSchema, default: () => ({}) } },
  { _id: false }
);

// ── CATEGORIAS suportadas ──────────────────────────────────────
const CATEGORIAS = [
  "economica", "confort", "executive", "luxury",
  "grupo6", "grupo8", "grupo17",
];

const VeiculoSchema = new Schema(
  {
    // ── Identificação (existentes) ─────────────────────────────
    marca:      { type: String, required: true, trim: true },
    modelo:     { type: String, required: true, trim: true },
    matricula:  { type: String, required: true, trim: true, uppercase: true, unique: true },
    cor:        { type: String, default: "" },
    ano:        { type: Number, default: null },

    // ── NOVO: Categoria de serviço ─────────────────────────────
    // Define a que tipos de reserva este veículo pode responder.
    categoria:  {
      type: String,
      enum: CATEGORIAS,
      default: "economica",
      index: true,
    },

    // ── NOVO: Categorias ATIVAS para despacho ─────────────────
    // "categoria" acima continua a ser a categoria PRINCIPAL do
    // veículo (usada pelo motor de preços/reserva do hotel — não
    // mexer). categoriasAtivas é a lista de categorias que o
    // motorista LIGOU para receber pedidos (botão de categorias no
    // motorista.html) — pode incluir mais do que uma (ex: um veículo
    // "confort" com 6 lugares pode estar ligado a "confort" E
    // "grupo6" ao mesmo tempo). Por defeito, só a categoria
    // principal fica ativa.
    categoriasAtivas: {
      type: [String],
      enum: CATEGORIAS,
      default: function () { return [this.categoria || "economica"]; },
    },

    // ── NOVO: Categorias PERMITIDAS (teto fixo, definido pelo admin) ─
    // Preenchido automaticamente em POST /api/veiculos/registo, a
    // partir da regra Marca/Modelo definida no painel "Categorias
    // Veículos" do admin (VehicleCategoryRule). Representa o
    // conjunto máximo de categorias que este veículo tem autorização
    // para realizar — o motorista NUNCA pode ligar (categoriasAtivas)
    // uma categoria fora deste conjunto, por muito que tente via
    // PATCH /motorista/categorias. Só o admin muda isto, editando a
    // regra Marca/Modelo (não há edição directa por veículo).
    categoriasPermitidas: {
      type: [String],
      enum: CATEGORIAS,
      default: [],
    },

    // Capacidade em lugares (4 para berlinas, 6/8/17 para grupos)
    capacidade: { type: Number, default: 4, min: 1, max: 30 },

    // ── NOVO: Gestor de Frota a quem pertence ─────────────────
    // Referência ao Colaborador (tipo: "frota") que registou o veículo.
    // Um veículo pertence sempre a um gestor. Se o gestor sair,
    // o campo fica com o _id para histórico mas pode ser reatribuído.
    gestorId: {
      type: Schema.Types.ObjectId,
      ref: "Colaborador",
      default: null,
      index: true,
    },
    // Cache de dados do gestor (evita populate para queries simples)
    gestor: {
      nome:    { type: String, default: "" },
      email:   { type: String, default: "" },
      empresa: { type: String, default: "" },
    },

    // ── NOVO: Motorista actualmente atribuído ─────────────────
    // null = veículo sem motorista (não pode ser despachado)
    // ObjectId = motorista activo atribuído pelo gestor
    motoristaId: {
      type: Schema.Types.ObjectId,
      ref: "Motorista",
      default: null,
      index: true,
    },

    // ── NOVO: Disponibilidade operacional ─────────────────────
    // true  = livre para receber reservas
    // false = em serviço / indisponível temporariamente
    disponivel: { type: Boolean, default: true, index: true },

    // ── Documentos (existentes) ────────────────────────────────
    documentos: {
      dua:      { type: DocumentoSchema, default: () => ({}) },
      seguro:   { type: DocumentoSchema, default: () => ({}) },
      inspecao: { type: DocumentoSchema, default: () => ({}) },
    },

    fotos: { type: [FotoVeiculoSchema], default: [] },

    // ── Aprovação (existentes) ────────────────────────────────
    estado:   { type: String, default: "pendente" },
    aprovacao:{ type: String, default: "pendente" },

    validacao: {
      status:          { type: String, default: "pendente" },
      observacoes:     { type: String, default: "" },
      checklist:       { type: Object, default: {} },
      validadoEm:      { type: Date,   default: null },
      validadoPorId:   { type: Schema.Types.Mixed, default: null },
      validadoPorNome: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

// ── Índice composto para dispatch ──────────────────────────────
// Permite encontrar rapidamente veículos por categoria + disponível + aprovado
VeiculoSchema.index({ categoria: 1, disponivel: 1, aprovacao: 1 });
VeiculoSchema.index({ categoriasAtivas: 1, disponivel: 1, aprovacao: 1 });
VeiculoSchema.index({ gestorId: 1, aprovacao: 1 });

export default models.Veiculo || model("Veiculo", VeiculoSchema);