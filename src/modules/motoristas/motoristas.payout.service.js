import AdminQuoteConfig from "../../models/AdminQuoteConfig.js";
import DispatchSession  from "../../models/DispatchSession.js";

function createError(message, statusCode = 500) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/* ══════════════════════════════════════════════════════════════
   COMISSAO DA PLATAFORMA — fonte unica de verdade
   --------------------------------------------------------------
   Estava escrita a 15% aqui dentro, em codigo. Mas o valor real e
   o AdminQuoteConfig.plataformaPercent (25% por defeito, piso de
   15%, configuravel pelo admin) — que e o que o motor de ofertas
   ja usava para dizer ao motorista quanto ia ganhar. Resultado:
   o motorista via um valor ao aceitar e outro ao ser pago, com
   10 pontos percentuais de diferenca.

   Ha ainda o incentivo "motorista mais proximo": se ninguem aceitar
   na 1a volta, a comissao desta viagem em concreto e reduzida em 10
   pontos e gravada em DispatchSession.comissaoAjustada. O payout
   ignorava-o — ou seja, prometia-se mais ao motorista para ele
   aceitar, e depois pagava-se ao valor normal. Agora respeita-se.
   ══════════════════════════════════════════════════════════════ */
async function obterComissaoDaViagem(viagem) {
  const PADRAO = 0.25;

  // 1) Comissao especifica desta viagem (incentivo ja aplicado)
  try {
    const tripId = String(viagem?._id || viagem?.tripId || "");
    if (tripId) {
      const sess = await DispatchSession.findOne({ tripId }).select("comissaoAjustada").lean();
      const ajust = Number(sess?.comissaoAjustada);
      if (Number.isFinite(ajust) && ajust > 0) return ajust;
    }
  } catch (_) { /* sem sessao — segue para o valor global */ }

  // 2) Valor global configurado pelo admin
  try {
    const cfg = await AdminQuoteConfig.findOne({ key: "default" }).select("plataformaPercent").lean();
    const base = Number(cfg?.plataformaPercent);
    if (Number.isFinite(base) && base > 0) return base;
  } catch (_) { /* sem config — usa o padrao */ }

  return PADRAO;
}

export async function calcularPayoutMotorista(viagem = {}) {
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

  const comissao = await obterComissaoDaViagem(viagem);
  const descontoEmpresaPercent = Number((comissao * 100).toFixed(2));
  const valorBaseMotorista = Number(
    (valorTotal * (1 - comissao)).toFixed(2)
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
    comissaoAplicada: comissao,
    valorTotal: Number(valorTotal.toFixed(2)),
    descontoEmpresaPercent,
    valorBaseMotorista,
    bonusRepeatDriverPercent,
    bonusRepeatDriverValor,
    valorFinalMotorista,
    mensagemBonus,
  };
}