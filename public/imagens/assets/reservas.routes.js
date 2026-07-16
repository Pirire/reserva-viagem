// src/routes/reservas.routes.js
import { Router } from "express";
import Reserva from "../models/Reserva.js";

import { calcularTotalQuote } from "../services/quoteCalc.service.js";
import { calcTollsPortugalFromDirectionsRoute } from "../services/tolls.pt.js";

const router = Router();

// ✅ GET /paypal-client-id
router.get("/paypal-client-id", (req, res) => {
  return res.json({
    clientId: process.env.PAYPAL_CLIENT_ID || "",
  });
});

// DEBUG
console.log("✅ reservas.routes.js carregado");

/**
 * POST /quote  ✅ (Uber-style)
 *
 * O FRONT envia:
 * {
 *   origem, destino, categoria,
 *   distanciaKm,
 *   tempoNormal, tempoComTransito, etc...
 *
 *   // NOVO:
 *   directionsRoute: <routes[0] do Google Directions>   (objeto "limpo")
 * }
 *
 * O backend:
 * 1) calcula total base (sem portagem fixa)
 * 2) deteta portagens na rota (keywords)
 * 3) soma apenas as portagens detetadas
 */
router.post("/quote", (req, res) => {
  try {
    const {
      origem,
      destino,
      categoria,
      distanciaKm,

      saiuDeAeroporto = false,
      tempoEsperaMin = 0,
      pedidosZona = 0,
      baselineZona = 0,
      tempoNormal = 1,
      tempoComTransito = 1,

      // ✅ NOVO: rota do Google (routes[0])
      directionsRoute = null,
    } = req.body || {};

    if (!origem || !destino || !categoria) {
      return res.status(400).json({
        success: false,
        message: "origem, destino e categoria são obrigatórios",
      });
    }

    const km = Number(distanciaKm);
    if (!Number.isFinite(km) || km <= 0) {
      return res.status(400).json({
        success: false,
        message: "distanciaKm inválida (tem de ser número > 0)",
      });
    }

    // 1) calcula BASE (não cobra portagem aqui, para não duplicar)
    const base = calcularTotalQuote({
      categoria,
      saiuDeAeroporto,
      tempoEsperaMin,
      pedidosZona,
      baselineZona,
      distanciaKm: km,
      tempoNormal,
      tempoComTransito,
      passouPortagem: false, // ⚠️ força false: portagens vêm da rota real
    });

    // 2) deteta portagens na rota (se vier rota)
    let tollAmount = 0;
    let tolls = [];
    let hasTolls = false;

    if (directionsRoute && typeof directionsRoute === "object") {
      const tollInfo = calcTollsPortugalFromDirectionsRoute(directionsRoute);
      hasTolls = Boolean(tollInfo?.hasTolls);
      tollAmount = Number(tollInfo?.tollAmount || 0);
      tolls = Array.isArray(tollInfo?.tolls) ? tollInfo.tolls : [];
    }

    // 3) soma base + portagens detetadas
    const total = Number((Number(base.total || 0) + tollAmount).toFixed(2));

    return res.json({
      success: true,

      // total final
      total,

      // portagens reais (Uber style)
      portagens: Number(tollAmount.toFixed(2)),
      status: hasTolls ? "Inclui portagem" : "Sem portagens",
      tolls, // breakdown

      // extras úteis
      valorKm: base.valorKm,
      baseTotal: Number(Number(base.total || 0).toFixed(2)),
    });
  } catch (err) {
    console.error("❌ Erro POST /quote:", err);
    return res.status(500).json({
      success: false,
      message: "Erro ao calcular viagem",
    });
  }
});

/**
 * POST /obter-valores
 */
router.post("/obter-valores", async (req, res) => {
  try {
    const { origem, destino, canal } = req.body || {};

    if (!origem || !destino) {
      return res.status(400).json({
        success: false,
        message: "origem e destino são obrigatórios",
      });
    }

    const tabelaA = {
      Confort: 1.2,
      Executive: 1.6,
      Luxury: 2.0,
      GRUPO6: 3.0,
      GRUPO8: 3.6,
      GRUPO17: 6.5,
    };

    const tabelaB = {
      Confort: 1.4,
      Executive: 1.8,
      Luxury: 2.2,
      GRUPO6: 3.2,
      GRUPO8: 3.8,
      GRUPO17: 6.8,
    };

    const c = String(canal || "A").toUpperCase();
    const valores = c === "B" ? tabelaB : tabelaA;

    return res.json({ success: true, valores });
  } catch (err) {
    console.error("❌ Erro POST /obter-valores:", err);
    return res.status(500).json({ success: false, message: "Erro ao obter valores" });
  }
});

/**
 * POST /reserva
 */
router.post("/reserva", async (req, res) => {
  try {
    const {
      nome,
      email,
      categoria,
      partida,
      destino,
      datahora,
      valor,
      contato,
      contacto,
      codigo,
      observacoes,
      origemGeo,
      destinoGeo,
    } = req.body || {};

    if (!nome || !email || !categoria || !partida || !destino || !datahora || !codigo) {
      return res.status(400).json({
        success: false,
        message: "Campos obrigatórios: nome,email,categoria,partida,destino,datahora,codigo",
      });
    }

    const exists = await Reserva.findOne({ codigo }).lean();
    if (exists) {
      return res.status(409).json({ success: false, message: "Código de reserva já existe" });
    }

    const nova = await Reserva.create({
      codigo: String(codigo).trim(),
      canal: "publico",
      nome: String(nome).trim(),
      email: String(email).toLowerCase().trim(),
      contacto: String(contacto || contato || "").trim(),
      categoria: String(categoria).trim(),
      partida: String(partida).trim(),
      destino: String(destino).trim(),
      origemGeo: origemGeo || null,
      destinoGeo: destinoGeo || null,
      datahora: new Date(datahora),
      valor: Number(valor || 0),
      observacoes: String(observacoes || ""),
      status: "pendente",
      pagamento: { provider: "paypal", status: "pendente" },
      createdAt: new Date(),
    });

    return res.json({ success: true, reserva: nova });
  } catch (err) {
    console.error("❌ Erro POST /reserva:", err);
    return res.status(500).json({ success: false, message: "Erro ao criar reserva" });
  }
});

/**
 * POST /cancelar-reserva
 */
router.post("/cancelar-reserva", async (req, res) => {
  try {
    const { email, codigo } = req.body || {};
    if (!email || !codigo) {
      return res.status(400).json({ success: false, message: "email e codigo obrigatórios" });
    }

    const reserva = await Reserva.findOne({
      email: String(email).toLowerCase().trim(),
      codigo: String(codigo).trim(),
    });

    if (!reserva) {
      return res.status(404).json({ success: false, message: "Reserva não encontrada" });
    }

    reserva.status = "cancelada";
    await reserva.save();

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Erro POST /cancelar-reserva:", err);
    return res.status(500).json({ success: false, message: "Erro ao cancelar reserva" });
  }
});

export default router;
