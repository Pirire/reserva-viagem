// src/services/quoteCalc.service.js
export function calcularTotalQuote(params) {
  const {
    categoria,
    saiuDeAeroporto,
    tempoEsperaMin = 0,
    pedidosZona = 0,
    baselineZona = 0,
    distanciaKm = 0,
    tempoNormal = 1,
    tempoComTransito = 1,
    passouPortagem = false,
  } = params || {};

  const precoKm = {
    Confort: 1.2,
    Executive: 1.6,
    Luxury: 2.0,
  };

  const valorKm = precoKm[categoria] || 1.2;
  let valorBase = Number(distanciaKm) * valorKm;

  const trafficRatio = Number(tempoComTransito) / Number(tempoNormal || 1);
  const fatorTransito = Math.min(1.3, Math.max(1, trafficRatio));

  const hora = new Date().getHours();
  const fatorHora =
    (hora >= 7 && hora <= 10) || (hora >= 17 && hora <= 20) ? 1.1 : 1.0;

  let fatorDemanda = 1.0;
  if (Number(pedidosZona) > Number(baselineZona)) {
    fatorDemanda = Math.min(
      1.5,
      1 + (Number(pedidosZona) - Number(baselineZona)) * 0.15
    );
  }

  let valorEspera = 0;
  if (Number(tempoEsperaMin) > 10) {
    valorEspera = (Number(tempoEsperaMin) - 10) * 0.8;
  }

  const portagem = passouPortagem ? 2.1 : 0;

  let total = valorBase * fatorTransito * fatorHora * fatorDemanda + valorEspera;

  if (saiuDeAeroporto && total < 15) total = 15;
  if (!saiuDeAeroporto && total < 10) total = 10;

  total = Number((total + portagem).toFixed(2));

  return {
    total,
    portagens: portagem,
    status: portagem > 0 ? "Inclui portagem" : "Sem portagens",
    valorKm,
  };
}
