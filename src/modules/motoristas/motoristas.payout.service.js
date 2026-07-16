function createError(message, statusCode = 500) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function calcularPayoutMotorista(viagem = {}) {
  const valorTotal = toNumber(
    viagem?.valor ??
    viagem?.quote?.total ??
    viagem?.quote?.baseTotal,
    0
  );

  if (valorTotal <= 0) {
    throw createError("Valor da viagem inválido para payout.", 400);
  }

  const pricingMode = String(viagem?.pricingMode || "normal").trim().toLowerCase();

  const descontoEmpresaPercent = 15;
  const valorBaseMotorista = Number(
    (valorTotal * (1 - descontoEmpresaPercent / 100)).toFixed(2)
  );

  let bonusRepeatDriverPercent = 0;
  let bonusRepeatDriverValor = 0;
  let valorFinalMotorista = valorBaseMotorista;
  let mensagemBonus = "";

  if (pricingMode === "repeat_driver") {
    bonusRepeatDriverPercent = 7.5;
    bonusRepeatDriverValor = Number(
      (valorBaseMotorista * (bonusRepeatDriverPercent / 100)).toFixed(2)
    );
    valorFinalMotorista = Number(
      (valorBaseMotorista + bonusRepeatDriverValor).toFixed(2)
    );
    mensagemBonus = `Irá receber +${bonusRepeatDriverPercent}% por esta viagem.`;
  }

  return {
    pricingMode,
    valorTotal: Number(valorTotal.toFixed(2)),
    descontoEmpresaPercent,
    valorBaseMotorista,
    bonusRepeatDriverPercent,
    bonusRepeatDriverValor,
    valorFinalMotorista,
    mensagemBonus,
  };
}