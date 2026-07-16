import FinanceSnapshot from "../../models/FinanceSnapshot.js";
import Reserva from "../../models/Reserva.js";
import { getIsoWeekYear, getMonthYear, startOfIsoWeek, endOfIsoWeek, startOfMonth, endOfMonth } from "../../utils/period.js";

/**
 * Calcula métricas a partir das Reservas num intervalo [from, to]
 * E grava snapshots para:
 * - COLABORADOR (hotel/alojamento/frota) por colaboradorId
 * - MOTORISTA por motoristaId
 *
 * Regras de receitas:
 * - totalBruto = soma(valor)
 * - totalHotel = soma(valor) onde pagamento.pagador === "HOTEL_PAGA"
 * - totalPassageiro = soma(valor) onde pagamento.pagador === "CLIENTE_PAGA"
 * - totalDescontoAplicado = soma(descontoAplicado) (se tiveres esse campo; se não, fica 0)
 */
async function aggregateRange(from, to) {
  const match = { datahora: { $gte: from, $lte: to } };

  // para contagens + receitas por colaborador e motorista em 1 query (aggregation)
  const rows = await Reserva.aggregate([
    { $match: match },
    {
      $project: {
        status: 1,
        valor: { $ifNull: ["$valor", 0] },
        colaboradorId: 1,
        motoristaId: 1,
        pagador: "$pagamento.pagador",
        descontoAplicado: { $ifNull: ["$descontoAplicado", 0] },
      },
    },
    {
      $facet: {
        porColaborador: [
          { $match: { colaboradorId: { $ne: null } } },
          {
            $group: {
              _id: "$colaboradorId",
              viagensSolicitadas: { $sum: 1 },
              viagensConcluidas: { $sum: { $cond: [{ $eq: ["$status", "concluida"] }, 1, 0] } },
              viagensCanceladas: { $sum: { $cond: [{ $eq: ["$status", "cancelada"] }, 1, 0] } },

              totalBruto: { $sum: "$valor" },
              totalHotel: { $sum: { $cond: [{ $eq: ["$pagador", "HOTEL_PAGA"] }, "$valor", 0] } },
              totalPassageiro: { $sum: { $cond: [{ $eq: ["$pagador", "CLIENTE_PAGA"] }, "$valor", 0] } },
              totalDescontoAplicado: { $sum: "$descontoAplicado" },
            },
          },
        ],
        porMotorista: [
          { $match: { motoristaId: { $ne: null } } },
          {
            $group: {
              _id: "$motoristaId",
              viagensSolicitadas: { $sum: 1 },
              viagensConcluidas: { $sum: { $cond: [{ $eq: ["$status", "concluida"] }, 1, 0] } },
              viagensCanceladas: { $sum: { $cond: [{ $eq: ["$status", "cancelada"] }, 1, 0] } },

              totalBruto: { $sum: "$valor" },
            },
          },
        ],
      },
    },
  ]);

  const porColaborador = rows?.[0]?.porColaborador || [];
  const porMotorista = rows?.[0]?.porMotorista || [];

  return { porColaborador, porMotorista };
}

export async function closeWeekSnapshot(date = new Date()) {
  // fecha a semana do "date" (normalmente vamos chamar com a semana anterior)
  const { year, week } = getIsoWeekYear(date);
  const from = startOfIsoWeek(date);
  const to = endOfIsoWeek(date);

  const { porColaborador, porMotorista } = await aggregateRange(from, to);

  // grava COLABORADORES
  for (const row of porColaborador) {
    await FinanceSnapshot.updateOne(
      {
        periodType: "WEEK",
        year,
        weekNumber: week,
        ownerType: "COLABORADOR",
        colaboradorId: row._id,
      },
      {
        $setOnInsert: {
          periodType: "WEEK",
          year,
          weekNumber: week,
          ownerType: "COLABORADOR",
          colaboradorId: row._id,
          month: null,
        },
        $set: {
          viagensSolicitadas: row.viagensSolicitadas,
          viagensConcluidas: row.viagensConcluidas,
          viagensCanceladas: row.viagensCanceladas,
          totalBruto: row.totalBruto,
          totalHotel: row.totalHotel,
          totalPassageiro: row.totalPassageiro,
          totalDescontoAplicado: row.totalDescontoAplicado,
          fechadoAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  // grava MOTORISTAS (por enquanto totalMotorista = totalBruto; depois aplicamos comissão/regras)
  for (const row of porMotorista) {
    await FinanceSnapshot.updateOne(
      {
        periodType: "WEEK",
        year,
        weekNumber: week,
        ownerType: "MOTORISTA",
        motoristaId: row._id,
      },
      {
        $setOnInsert: {
          periodType: "WEEK",
          year,
          weekNumber: week,
          ownerType: "MOTORISTA",
          motoristaId: row._id,
          month: null,
        },
        $set: {
          viagensSolicitadas: row.viagensSolicitadas,
          viagensConcluidas: row.viagensConcluidas,
          viagensCanceladas: row.viagensCanceladas,
          totalBruto: row.totalBruto,
          totalMotorista: row.totalBruto,
          fechadoAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  return { ok: true, year, week, from, to };
}

export async function closeMonthSnapshot(date = new Date()) {
  const { year, month } = getMonthYear(date);
  const from = startOfMonth(date);
  const to = endOfMonth(date);

  const { porColaborador, porMotorista } = await aggregateRange(from, to);

  for (const row of porColaborador) {
    await FinanceSnapshot.updateOne(
      {
        periodType: "MONTH",
        year,
        month,
        ownerType: "COLABORADOR",
        colaboradorId: row._id,
      },
      {
        $setOnInsert: {
          periodType: "MONTH",
          year,
          month,
          ownerType: "COLABORADOR",
          colaboradorId: row._id,
          weekNumber: null,
        },
        $set: {
          viagensSolicitadas: row.viagensSolicitadas,
          viagensConcluidas: row.viagensConcluidas,
          viagensCanceladas: row.viagensCanceladas,
          totalBruto: row.totalBruto,
          totalHotel: row.totalHotel,
          totalPassageiro: row.totalPassageiro,
          totalDescontoAplicado: row.totalDescontoAplicado,
          fechadoAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  for (const row of porMotorista) {
    await FinanceSnapshot.updateOne(
      {
        periodType: "MONTH",
        year,
        month,
        ownerType: "MOTORISTA",
        motoristaId: row._id,
      },
      {
        $setOnInsert: {
          periodType: "MONTH",
          year,
          month,
          ownerType: "MOTORISTA",
          motoristaId: row._id,
          weekNumber: null,
        },
        $set: {
          viagensSolicitadas: row.viagensSolicitadas,
          viagensConcluidas: row.viagensConcluidas,
          viagensCanceladas: row.viagensCanceladas,
          totalBruto: row.totalBruto,
          totalMotorista: row.totalBruto,
          fechadoAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  return { ok: true, year, month, from, to };
}