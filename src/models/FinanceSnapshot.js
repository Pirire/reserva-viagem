import mongoose from "mongoose";

/**
 * Snapshot “imutável” de receitas/contagens para relatórios.
 * periodType: WEEK | MONTH
 * ownerType: COLABORADOR | MOTORISTA
 */
const FinanceSnapshotSchema = new mongoose.Schema(
  {
    periodType: { type: String, enum: ["WEEK", "MONTH"], required: true, index: true },

    // Identificador do período
    // WEEK: year + weekNumber (ISO week)
    // MONTH: year + month (1-12)
    year: { type: Number, required: true, index: true },
    weekNumber: { type: Number, default: null, index: true }, // 1-53
    month: { type: Number, default: null, index: true }, // 1-12

    ownerType: { type: String, enum: ["COLABORADOR", "MOTORISTA"], required: true, index: true },
    colaboradorId: { type: mongoose.Schema.Types.ObjectId, ref: "Colaborador", default: null, index: true },
    motoristaId: { type: mongoose.Schema.Types.ObjectId, ref: "Motorista", default: null, index: true },

    // contagens
    viagensSolicitadas: { type: Number, default: 0 },
    viagensConcluidas: { type: Number, default: 0 },
    viagensCanceladas: { type: Number, default: 0 },

    // receitas
    totalBruto: { type: Number, default: 0 },            // total da reserva (somatório)
    totalHotel: { type: Number, default: 0 },            // somatório das reservas HOTEL_PAGA
    totalPassageiro: { type: Number, default: 0 },       // somatório CLIENTE_PAGA
    totalDescontoAplicado: { type: Number, default: 0 }, // quanto foi descontado quando hotel paga

    // motorista
    totalMotorista: { type: Number, default: 0 },        // quanto pertence ao motorista (regras depois)
    totalPagoMotorista: { type: Number, default: 0 },    // transferido (segunda 10-14)

    // metadados do fecho
    fechadoAt: { type: Date, default: Date.now },
    versao: { type: Number, default: 1 },
  },
  { timestamps: true }
);

// evita duplicar snapshots do mesmo período/owner
FinanceSnapshotSchema.index(
  { periodType: 1, year: 1, weekNumber: 1, month: 1, ownerType: 1, colaboradorId: 1, motoristaId: 1 },
  { unique: true, sparse: true }
);

export default mongoose.model("FinanceSnapshot", FinanceSnapshotSchema);
