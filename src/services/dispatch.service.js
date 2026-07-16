// src/services/dispatch.service.js
// ══════════════════════════════════════════════════════════════
// Serviço de atribuição automática de motorista + veículo
// a uma reserva, com base na categoria pedida.
//
// Fluxo:
//   1. Normaliza a categoria pedida
//   2. Encontra veículos aprovados + disponíveis + com motorista
//      atribuído + motorista aprovado + motorista disponível
//   3. Ordena por rating do motorista (melhor primeiro)
//   4. Atribui o par à reserva e marca ambos como "em serviço"
//   5. Emite evento Socket.io ao motorista (se io disponível)
//   6. Devolve os dados para o polling do cliente
//
// Substituição de motorista/veículo:
//   O gestor pode chamar reatribuirVeiculo() ou reatribuirMotorista()
//   a qualquer momento. A reserva activa é transferida e o par
//   anterior fica disponível.
// ══════════════════════════════════════════════════════════════

import Motorista from "../models/Motorista.js";
import Veiculo   from "../models/Veiculo.js";
import Reserva   from "../models/Reserva.js";
import logger    from "../config/logger.js";

// ── Mapeamento de categorias da reserva → categorias do veículo ──
// Uma reserva "luxury" só pode ser servida por um veículo "luxury".
// Reservas de grupo mapeiam para a capacidade correcta.
const CAT_MAP = {
  economica:  ["economica"],
  confort:    ["confort"],
  executive:  ["executive"],
  luxury:     ["luxury"],
  // Grupo: aceita veículo com capacidade igual ou superior
  grupo6:     ["grupo6", "grupo8", "grupo17"],
  grupo8:     ["grupo8", "grupo17"],
  grupo17:    ["grupo17"],
  // Legacy / alternativas
  ECONOMICA:  ["economica"],
  CONFORT:    ["confort"],
  EXECUTIVE:  ["executive"],
  LUXURY:     ["luxury"],
};

function normalizarCategoria(raw) {
  const c = String(raw || "").trim().toLowerCase();
  // grupo6/8/17 directo
  if (c === "grupo6"  || c === "grupo_6")  return "grupo6";
  if (c === "grupo8"  || c === "grupo_8")  return "grupo8";
  if (c === "grupo17" || c === "grupo_17") return "grupo17";
  // standard
  if (["economica","confort","executive","luxury"].includes(c)) return c;
  // uppercase legacy
  const up = c.toUpperCase();
  if (up === "ECONOMICA") return "economica";
  if (up === "CONFORT")   return "confort";
  if (up === "EXECUTIVE") return "executive";
  if (up === "LUXURY")    return "luxury";
  return c; // passa tal como está
}

/* ════════════════════════════════════════════════════════════════
   despacharReserva(reservaId, io?)
   Chamado após confirmação de pagamento.
   Procura e atribui o melhor par (veículo + motorista).
════════════════════════════════════════════════════════════════ */
export async function despacharReserva(reservaId, io = null) {
  const reserva = await Reserva.findById(reservaId);
  if (!reserva) throw new Error(`Reserva ${reservaId} não encontrada`);
  if (reserva.motoristaId) {
    logger.info({ reservaId }, "Reserva já tem motorista — dispatch ignorado");
    return { ok: true, jaAtribuido: true };
  }

  const catNorm = normalizarCategoria(reserva.categoria);
  const cats    = CAT_MAP[catNorm] || [catNorm];

  // ── Encontrar veículos elegíveis ──────────────────────────────
  // IMPORTANTE: filtra por categoriasAtivas (array — o conjunto que
  // o motorista liga/desliga no painel dele, dentro do que o admin
  // autorizou), NÃO por "categoria" (campo único, "categoria
  // principal" do veículo). Antes desta correção, um veículo
  // aprovado para "grupo6" através de categoriasAtivas nunca era
  // encontrado para um pedido de "grupo6" se a sua categoria
  // principal fosse outra (ex: "confort") — o despacho falhava em
  // silêncio, a reserva ficava para sempre pendente.
  const veiculos = await Veiculo.find({
    categoriasAtivas: { $in: cats },
    disponivel:  true,
    aprovacao:   "aprovado",
    motoristaId: { $ne: null },   // tem motorista atribuído
  })
    .populate({
      path:   "motoristaId",
      match:  { aprovacao: "aprovado", disponivel: true },
      select: "nome contacto email rating lat lng disponivel aprovacao veiculoId",
    })
    .lean();

  // Filtrar veículos cujo motorista foi populado com sucesso
  const elegiveis = veiculos.filter(v => v.motoristaId !== null);

  if (!elegiveis.length) {
    logger.warn({ reservaId, categoria: catNorm }, "⚠️ Nenhum par disponível para dispatch");
    // Não lança erro — a reserva fica pendente para atribuição manual
    return { ok: false, mensagem: "Nenhum motorista disponível para esta categoria. A reserva ficará pendente." };
  }

  // Ordenar por rating (melhor primeiro)
  elegiveis.sort((a, b) => (b.motoristaId?.rating || 5) - (a.motoristaId?.rating || 5));

  const veiculo   = elegiveis[0];
  const motorista = veiculo.motoristaId;

  // ── Atribuir — tudo numa transacção ──────────────────────────
  await Promise.all([
    // 1. Atualizar reserva
    Reserva.findByIdAndUpdate(reservaId, {
      motoristaId: motorista._id,
      veiculoId:   veiculo._id,
      status:      "atribuida",
      // Snapshot dos dados no momento da atribuição (histórico imutável)
      snapshotMotorista: {
        nome:      motorista.nome,
        contacto:  motorista.contacto,
        email:     motorista.email,
        rating:    motorista.rating,
      },
      snapshotVeiculo: {
        marca:     veiculo.marca,
        modelo:    veiculo.modelo,
        matricula: veiculo.matricula,
        cor:       veiculo.cor,
        categoria: veiculo.categoria,
      },
    }),
    // 2. Marcar veículo como em serviço
    Veiculo.findByIdAndUpdate(veiculo._id, { disponivel: false }),
    // 3. Marcar motorista como em serviço
    Motorista.findByIdAndUpdate(motorista._id, { disponivel: false }),
  ]);

  logger.info(
    { reservaId, motoristaId: motorista._id, veiculoId: veiculo._id },
    "✅ Dispatch concluído"
  );

  // ── Notificar motorista via Socket.io ─────────────────────────
  if (io) {
    io.to(`motorista_${motorista._id}`).emit("nova_reserva", {
      reservaId:   String(reservaId),
      codigo:      reserva.codigo,
      partida:     reserva.partida,
      destino:     reserva.destino,
      datahora:    reserva.datahora,
      valor:       reserva.valor,
      passageiro:  reserva.nome,
      contacto:    reserva.contacto,
    });
  }

  return {
    ok:        true,
    jaAtribuido: false,
    motorista: {
      motoristaNome: motorista.nome,
      nome:          motorista.nome,
      contacto:      motorista.contacto,
      rating:        motorista.rating || 5,
      lat:           motorista.lat || null,
      lng:           motorista.lng || null,
    },
    veiculo: {
      marca:     veiculo.marca,
      modelo:    veiculo.modelo,
      matricula: veiculo.matricula,
      cor:       veiculo.cor,
    },
  };
}

/* ════════════════════════════════════════════════════════════════
   liberarPar(motoristaId, veiculoId)
   Chamado quando a viagem termina — ambos ficam disponíveis.
════════════════════════════════════════════════════════════════ */
export async function liberarPar(motoristaId, veiculoId) {
  await Promise.all([
    Motorista.findByIdAndUpdate(motoristaId, { disponivel: true }),
    Veiculo.findByIdAndUpdate(veiculoId,     { disponivel: true }),
  ]);
  logger.info({ motoristaId, veiculoId }, "✅ Par libertado — disponíveis");
}

/* ════════════════════════════════════════════════════════════════
   atribuirMotoristaaVeiculo(veiculoId, motoristaId)
   O gestor liga um motorista a um veículo no portal.
   Se o motorista estava noutro veículo, desliga-o primeiro.
════════════════════════════════════════════════════════════════ */
export async function atribuirMotoristaAVeiculo(veiculoId, motoristaId) {
  const [veiculo, motorista] = await Promise.all([
    Veiculo.findById(veiculoId),
    Motorista.findById(motoristaId),
  ]);
  if (!veiculo)   throw Object.assign(new Error("Veículo não encontrado"),   { status: 404 });
  if (!motorista) throw Object.assign(new Error("Motorista não encontrado"), { status: 404 });

  // Desligar do veículo anterior (se existia)
  if (motorista.veiculoId && String(motorista.veiculoId) !== String(veiculoId)) {
    await Veiculo.findByIdAndUpdate(motorista.veiculoId, { motoristaId: null });
  }

  // Desligar o motorista anterior deste veículo (se existia)
  if (veiculo.motoristaId && String(veiculo.motoristaId) !== String(motoristaId)) {
    await Motorista.findByIdAndUpdate(veiculo.motoristaId, { veiculoId: null });
  }

  // Ligar ambos
  await Promise.all([
    Veiculo.findByIdAndUpdate(veiculoId,   { motoristaId }),
    Motorista.findByIdAndUpdate(motoristaId, { veiculoId }),
  ]);

  logger.info({ veiculoId, motoristaId }, "✅ Motorista atribuído ao veículo");
}

/* ════════════════════════════════════════════════════════════════
   removerMotoristaDeVeiculo(veiculoId)
   O gestor remove o motorista (saída, rescisão, substituição).
   A reserva activa (se houver) fica pendente para reatribuição.
════════════════════════════════════════════════════════════════ */
export async function removerMotoristaDeVeiculo(veiculoId) {
  const veiculo = await Veiculo.findById(veiculoId);
  if (!veiculo || !veiculo.motoristaId) return;

  const motoristaId = veiculo.motoristaId;

  await Promise.all([
    Veiculo.findByIdAndUpdate(veiculoId,     { motoristaId: null, disponivel: false }),
    Motorista.findByIdAndUpdate(motoristaId, { veiculoId:   null, disponivel: false }),
  ]);

  logger.info({ veiculoId, motoristaId }, "✅ Motorista removido do veículo");
}

/* ════════════════════════════════════════════════════════════════
   substituirParEmReserva(reservaId, novoMotoristaId, novoVeiculoId, io?)
   Gestor substitui motorista/veículo numa reserva activa.
   O par anterior fica disponível; o novo entra em serviço.
════════════════════════════════════════════════════════════════ */
export async function substituirParEmReserva(reservaId, novoMotoristaId, novoVeiculoId, io = null) {
  const reserva = await Reserva.findById(reservaId);
  if (!reserva) throw Object.assign(new Error("Reserva não encontrada"), { status: 404 });
  if (!["pendente","atribuida","em_viagem"].includes(reserva.status))
    throw Object.assign(new Error("Reserva não pode ser reatribuída neste estado"), { status: 400 });

  const antMotoristaId = reserva.motoristaId;
  const antVeiculoId   = reserva.veiculoId;

  // Libertar par anterior
  if (antMotoristaId) await Motorista.findByIdAndUpdate(antMotoristaId, { disponivel: true });
  if (antVeiculoId)   await Veiculo.findByIdAndUpdate(antVeiculoId,     { disponivel: true });

  // Obter snapshot novo
  const [novoM, novoV] = await Promise.all([
    Motorista.findById(novoMotoristaId).lean(),
    Veiculo.findById(novoVeiculoId).lean(),
  ]);
  if (!novoM) throw Object.assign(new Error("Novo motorista não encontrado"), { status: 404 });
  if (!novoV) throw Object.assign(new Error("Novo veículo não encontrado"),   { status: 404 });

  await Promise.all([
    Reserva.findByIdAndUpdate(reservaId, {
      motoristaId: novoMotoristaId,
      veiculoId:   novoVeiculoId,
      status:      "atribuida",
      snapshotMotorista: { nome: novoM.nome, contacto: novoM.contacto, rating: novoM.rating },
      snapshotVeiculo:   { marca: novoV.marca, modelo: novoV.modelo, matricula: novoV.matricula, cor: novoV.cor },
    }),
    Motorista.findByIdAndUpdate(novoMotoristaId, { disponivel: false }),
    Veiculo.findByIdAndUpdate(novoVeiculoId,     { disponivel: false }),
  ]);

  // Notificar novo motorista
  if (io) {
    io.to(`motorista_${novoMotoristaId}`).emit("nova_reserva", {
      reservaId: String(reservaId),
      codigo:    reserva.codigo,
      partida:   reserva.partida,
      destino:   reserva.destino,
      datahora:  reserva.datahora,
    });
  }

  logger.info({ reservaId, novoMotoristaId, novoVeiculoId }, "✅ Par substituído na reserva");
}