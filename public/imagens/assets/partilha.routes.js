// src/routes/partilha.routes.js
import { Router } from "express";
import crypto from "crypto";
import { calcularTotalQuote } from "../services/quoteCalc.service.js";

const router = Router();

/**
 * ⚠️ STORE EM MEMÓRIA (para testar já)
 * - Se reiniciares o backend, apaga tudo.
 * - Depois a gente troca por MongoDB (model).
 */
const shareStore = new Map();   // shareId -> shareObj
const contactStore = new Map(); // contacto -> { nome, contacto }

// contactos de teste (podes apagar depois)
contactStore.set("+351911111111", { nome: "Ana Costa", contacto: "+351911111111" });
contactStore.set("+351922222222", { nome: "Bruno Lima", contacto: "+351922222222" });
contactStore.set("+351933333333", { nome: "Carla Sousa", contacto: "+351933333333" });
contactStore.set("+351944444444", { nome: "Diogo Ferreira", contacto: "+351944444444" });

function makeShareId() {
  return "SHR-" + crypto.randomBytes(8).toString("hex").toUpperCase();
}
function normalizeContact(raw) {
  return String(raw || "").trim().replace(/\s+/g, "");
}

/* =========================
   ✅ TIMEOUT REAL NO BACKEND
   ========================= */
const SHARE_TTL_MS = 5 * 60 * 1000; // 5 minutos

function cancelShare(share, shareId, reason = "manual") {
  if (!share || share.cancelled) return;

  share.cancelled = true;

  share.participantes = (share.participantes || []).map((p) => {
    if (p.status === "pagou") return { ...p, status: "refund" };
    if (p.status === "recusou") return p;
    return { ...p, status: "cancelado" };
  });

  console.log(reason === "auto" ? "⏳ EXPIRADA (AUTO):" : "🛑 CANCELAR PARTILHA:", shareId);
}

// varre expiradas a cada 10s (suficiente para testes)
setInterval(() => {
  const now = Date.now();

  for (const [shareId, share] of shareStore.entries()) {
    if (share.cancelled) continue;

    // usa expiresAt se existir; senão cai no createdAt + TTL
    const expAt = Number(share.expiresAt || (share.createdAt + SHARE_TTL_MS));
    if (now >= expAt) {
      cancelShare(share, shareId, "auto");
    }
  }
}, 10_000);

/**
 * POST /confirmar-contacto
 * body: { contacto }
 * resp: { ok:true, nome, contacto } | { ok:false, message }
 */
router.post("/confirmar-contacto", (req, res) => {
  const contacto = normalizeContact(req.body?.contacto);
  if (!contacto) return res.status(400).json({ ok: false, message: "Contacto vazio." });

  const found = contactStore.get(contacto);
  if (!found) return res.status(404).json({ ok: false, message: "Contacto não encontrado." });

  return res.json({ ok: true, nome: found.nome, contacto: found.contacto });
});

/**
 * POST /partilha/criar
 * body: {
 *   totalPessoas,
 *   destino: { address, lat, lng },
 *   participantes: [{ contacto, nome }],
 *   categoria?: "Confort"|"Executive"|"Luxury" (opcional)
 * }
 */
router.post(["/partilha/criar", "/partilhas"], (req, res) => {
  try {
    const totalPessoas = Number(req.body?.totalPessoas || 0);
    const destino = req.body?.destino;
    const participantesIn = Array.isArray(req.body?.participantes) ? req.body.participantes : [];
    const categoria = String(req.body?.categoria || "").trim() || null;

    if (!totalPessoas || totalPessoas < 1 || totalPessoas > 17) {
      return res.status(400).json({ ok: false, message: "Total de pessoas inválido (1-17)." });
    }
    if (!destino || typeof destino.lat !== "number" || typeof destino.lng !== "number") {
      return res.status(400).json({ ok: false, message: "Destino inválido." });
    }
    if (participantesIn.length !== totalPessoas) {
      return res.status(400).json({ ok: false, message: "Participantes não corresponde ao total." });
    }

    const participantes = participantesIn.map((p) => {
      const contacto = normalizeContact(p?.contacto);
      const nome = String(p?.nome || "").trim() || "Titular";
      if (!contacto) throw new Error("Contacto inválido em participantes.");

      return {
        contacto,
        nome,
        status: "pendente", // convite enviado
        valor: 0,
        paymentUrl: null,
      };
    });

    // ✅ valida duplicados
    const unique = new Set(participantes.map((p) => p.contacto));
    if (unique.size !== participantes.length) {
      return res.status(400).json({ ok: false, message: "Há contactos duplicados." });
    }

    const shareId = makeShareId();
    const now = Date.now();

    const shareObj = {
      shareId,
      totalPessoas,
      destino,
      categoria, // pode ficar null, depois define no /partilha/calcular
      createdAt: now,
      expiresAt: now + SHARE_TTL_MS, // ✅
      cancelled: false,
      participantes,
      total: 0,
      km: 0,
      meta: {
        portagens: 0,
        status: "",
        valorKm: 0,
      },
    };

    shareStore.set(shareId, shareObj);

    console.log("✅ PARTILHA CRIADA:", shareId);
    console.log("📩 CONVITES PARA:", participantes.map((p) => p.contacto).join(", "));

    return res.json({
      ok: true,
      shareId,
      message: "Partilha criada e convites enviados.",
      participantes,
      expiresAt: shareObj.expiresAt,
    });
  } catch (err) {
    console.error("❌ Erro /partilha/criar:", err);
    return res.status(500).json({ ok: false, message: "Erro ao criar partilha." });
  }
});

/**
 * ✅ NOVO: POST /partilha/calcular
 * Usa o teu cálculo real (calcularTotalQuote) e grava no Map.
 *
 * body:
 * {
 *   shareId,
 *   categoria: "Confort"|"Executive"|"Luxury",
 *   distanciaKm: number,
 *   tempoNormal?, tempoComTransito?, passouPortagem?, saiuDeAeroporto?,
 *   tempoEsperaMin?, pedidosZona?, baselineZona?
 * }
 */
router.post("/partilha/calcular", (req, res) => {
  try {
    const shareId = String(req.body?.shareId || "").trim();
    if (!shareId) return res.status(400).json({ ok: false, message: "shareId em falta." });

    const share = shareStore.get(shareId);
    if (!share) return res.status(404).json({ ok: false, message: "Partilha não encontrada." });

    // expira on-demand
    const now = Date.now();
    const expAt = Number(share.expiresAt || (share.createdAt + SHARE_TTL_MS));
    if (!share.cancelled && now >= expAt) cancelShare(share, shareId, "auto");

    if (share.cancelled) {
      return res.status(400).json({ ok: false, message: "Partilha cancelada/expirada." });
    }

    const categoria = String(req.body?.categoria || share.categoria || "").trim();
    const distanciaKm = Number(req.body?.distanciaKm || 0);

    if (!categoria) {
      return res.status(400).json({ ok: false, message: "categoria é obrigatória." });
    }
    if (!Number.isFinite(distanciaKm) || distanciaKm <= 0) {
      return res.status(400).json({ ok: false, message: "distanciaKm inválida (tem de ser número > 0)." });
    }

    const resultado = calcularTotalQuote({
      categoria,
      distanciaKm,
      saiuDeAeroporto: !!req.body?.saiuDeAeroporto,
      tempoEsperaMin: Number(req.body?.tempoEsperaMin || 0),
      pedidosZona: Number(req.body?.pedidosZona || 0),
      baselineZona: Number(req.body?.baselineZona || 0),
      tempoNormal: Number(req.body?.tempoNormal || 1),
      tempoComTransito: Number(req.body?.tempoComTransito || 1),
      passouPortagem: !!req.body?.passouPortagem,
    });

    share.categoria = categoria;
    share.km = Number(distanciaKm.toFixed(2));
    share.total = resultado.total;
    share.meta = {
      portagens: resultado.portagens,
      status: resultado.status,
      valorKm: resultado.valorKm,
    };

    const n = Number(share.totalPessoas || share.participantes?.length || 1);
    const porPessoa = Number((resultado.total / n).toFixed(2));

    share.participantes = (share.participantes || []).map((p) => ({
      ...p,
      valor: porPessoa,
    }));

    return res.json({
      ok: true,
      shareId,
      categoria: share.categoria,
      km: share.km,
      total: share.total,
      porPessoa,
      meta: share.meta,
      participantes: share.participantes,
    });
  } catch (err) {
    console.error("❌ Erro /partilha/calcular:", err);
    return res.status(500).json({ ok: false, message: "Erro ao calcular partilha." });
  }
});

/**
 * GET /partilha/status?shareId=...
 */
router.get("/partilha/status", (req, res) => {
  const shareId = String(req.query?.shareId || "").trim();
  if (!shareId) return res.status(400).json({ ok: false, message: "shareId em falta." });

  const share = shareStore.get(shareId);
  if (!share) return res.status(404).json({ ok: false, message: "Partilha não encontrada." });

  // se já expirou e ainda não foi varrida, cancela aqui também
  const now = Date.now();
  const expAt = Number(share.expiresAt || (share.createdAt + SHARE_TTL_MS));
  if (!share.cancelled && now >= expAt) {
    cancelShare(share, shareId, "auto");
  }

  return res.json({
    ok: true,
    shareId: share.shareId,
    destino: share.destino,
    categoria: share.categoria,
    km: share.km,
    total: share.total,
    meta: share.meta,
    cancelled: share.cancelled,
    expiresAt: share.expiresAt,
    participantes: share.participantes,
  });
});

/**
 * POST /partilha/cancelar
 * body: { shareId }
 */
router.post("/partilha/cancelar", (req, res) => {
  const shareId = String(req.body?.shareId || "").trim();
  if (!shareId) return res.status(400).json({ ok: false, message: "shareId em falta." });

  const share = shareStore.get(shareId);
  if (!share) return res.status(404).json({ ok: false, message: "Partilha não encontrada." });

  // idempotente
  if (!share.cancelled) {
    const paid = share.participantes.filter((p) => p.status === "pagou");
    console.log("🛑 CANCELAR PARTILHA:", shareId, "| pagaram:", paid.map((p) => p.contacto).join(", "));
    cancelShare(share, shareId, "manual");
  }

  return res.json({ ok: true, message: "Partilha cancelada." });
});

/**
 * EXTRA (para testes rápidos): simular aceitar/recusar/pagar
 * POST /partilha/simular
 * body: { shareId, contacto, acao:"aceitar"|"recusar"|"pagar" }
 */
router.post("/partilha/simular", (req, res) => {
  const shareId = String(req.body?.shareId || "").trim();
  const contacto = normalizeContact(req.body?.contacto);
  const acao = String(req.body?.acao || "").trim();

  const share = shareStore.get(shareId);
  if (!share) return res.status(404).json({ ok: false, message: "Partilha não encontrada." });

  // expira on-demand também
  const now = Date.now();
  const expAt = Number(share.expiresAt || (share.createdAt + SHARE_TTL_MS));
  if (!share.cancelled && now >= expAt) {
    cancelShare(share, shareId, "auto");
  }

  if (share.cancelled) return res.status(400).json({ ok: false, message: "Partilha já cancelada/expirada." });

  const p = share.participantes.find((x) => x.contacto === contacto);
  if (!p) return res.status(404).json({ ok: false, message: "Participante não encontrado." });

  if (acao === "recusar") {
    p.status = "recusou";
    p.paymentUrl = null;
  } else if (acao === "aceitar") {
    p.status = "aceitou";
    // mantém simulação, mas agora podes calcular real chamando /partilha/calcular
    p.valor = Math.round((5 + Math.random() * 20) * 100) / 100;
    p.paymentUrl = `http://localhost:${process.env.PORT || 10000}/pagar-fake?shareId=${encodeURIComponent(
      shareId
    )}&contacto=${encodeURIComponent(contacto)}`;
  } else if (acao === "pagar") {
    p.status = "pagou";
    p.valor = Number(p.valor || 10);
    p.paymentUrl = null;
  } else {
    return res.status(400).json({ ok: false, message: "Ação inválida." });
  }

  share.total = share.participantes.reduce((sum, x) => sum + (x.valor || 0), 0);
  return res.json({ ok: true, participantes: share.participantes, total: share.total });
});

// Página fake para testar clique em "pagar"
router.get("/pagar-fake", (req, res) => {
  res.send(`
    <html><body style="font-family:Arial;padding:20px">
      <h2>PAGAMENTO FAKE</h2>
      <p>shareId: ${req.query.shareId}</p>
      <p>contacto: ${req.query.contacto}</p>
      <p>Depois vamos trocar por PayPal real.</p>
      <button onclick="window.close()">Fechar</button>
    </body></html>
  `);
});

console.log("✅ partilha.routes.js carregado");

export default router;
