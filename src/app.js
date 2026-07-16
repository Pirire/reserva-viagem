// src/app.js

import express from "express";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

// ── ROTAS ─────────────────────────────────────────────
import motoristaVeiculosRoutes from "./routes/motoristaVeiculos.routes.js";
import authRoutes from "./routes/auth.routes.js";
import faturacaoRoutes from "./modules/faturacao/faturacao.routes.js";
import feedbackRoutes from "./modules/feedback/feedback.routes.js";
import dispatchRoutes from "./modules/dispatch/dispatch.routes.js";
import motoristasModuleRoutes from "./modules/motoristas/motoristas.routes.js";
import errorMiddleware from "./middlewares/error.middleware.js";
import authValidador from "./middlewares/authValidador.js";
import authAdmin from "./middlewares/authAdmin.js";
import gestaoFrotaRoutes from "./routes/gestao-frota.routes.js";
import veiculosRoutes    from "./routes/veiculos.routes.js";
import motoristaRoutes from "./routes/motorista.routes.js";
import reservasRoutes from "./routes/reservas.routes.js";
import paymentsRoutes from "./routes/payments.routes.js";
import passwordRoutes from "./routes/password.routes.js";
import tripsRoutes from "./routes/trips.routes.js";
import partilhaRoutes from "./routes/partilha.routes.js";
import quoteRoutes from "./routes/quote.routes.js";
import ticketRoutes from "./routes/ticket.routes.js";
import validacaoNotifyRoutes from "./routes/validacaoNotify.routes.js";
import clientesRoutes from "./routes/clientes.routes.js";
import colaboradoresRoutes from "./routes/colaboradores.routes.js";
import contactRoutes from "./routes/contact.routes.js";
import inviteMotoristaRoutes from "./routes/inviteMotorista.routes.js";
import parceiroInviteRoutes from "./routes/parceiroInvite.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import viagensRoutes from "./modules/viagens/viagens.routes.js";
import validacaoTempRoutes from "./routes/validacaoTemp.routes.js";
import validadorRoutes from "./routes/validador.routes.js";
import trackingRoutes from "./routes/tracking.routes.js";
import operadorSegurancaRoutes from "./routes/operadorSeguranca.routes.js";
import adminOperadoresSegurancaRoutes from "./routes/adminOperadoresSeguranca.routes.js";
import partnerKeysRoutes             from "./routes/partnerKeys.routes.js";
import validationSubmissionsRoutes   from "./routes/validationSubmissions.routes.js";
import vehicleCategoryRoutes         from "./routes/vehicleCategory.routes.js";
import convidadoRoutes               from "./routes/convidado.routes.js";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");

app.disable("x-powered-by");

/* ==============================
   CORS — CORRIGIDO
   origin:"*" + credentials:true é bloqueado pelos browsers.
   Em desenvolvimento: aceita qualquer localhost.
   Em produção: origens do .env (CORS_ORIGINS=https://...,https://...)
============================== */
const IS_PROD = String(process.env.NODE_ENV || "").toLowerCase() === "production";

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (!IS_PROD && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    const envOrigins = String(process.env.CORS_ORIGINS || "")
      .split(",").map(s => s.trim()).filter(Boolean);
    if (envOrigins.includes(origin)) return callback(null, true);
    if (IS_PROD) return callback(new Error("CORS: origem não permitida — " + origin));
    return callback(null, true); // dev: aceitar tudo o resto
  },
  credentials:    true,
  methods:        ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Client", "X-Requested-With", "X-Api-Key"],
  optionsSuccessStatus: 200,
}));

/* ==============================
   BODY
============================== */
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());

/* ==============================
   STATIC
============================== */
app.use(express.static(PUBLIC_DIR));
app.use("/uploads", express.static(UPLOADS_DIR));

/* ==============================
   RATE LIMIT
============================== */
app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  max: IS_PROD ? 1500 : 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: "Demasiados pedidos. Tente novamente dentro de alguns minutos." },
}));

/* ==============================
   HEALTH
============================== */
app.get("/api/__health", (_req, res) => {
  res.json({ ok: true, service: "realmetropolis-api" });
});

/* ==============================
   PÁGINAS
============================== */
app.get("/", (_req, res) =>
  res.sendFile(path.join(PUBLIC_DIR, "index.html"))
);

/* ==============================
   ROTAS ORGANIZADAS
============================== */

// 🔵 CORE API
app.use("/api/clientes", clientesRoutes);
app.use("/api/colaboradores", colaboradoresRoutes);
// Alias — o gestor-frota.html usa historicamente /api/gestor/*.
// Montar o MESMO router em ambos os prefixos evita duplicação de
// código e mantém compatibilidade com HTMLs existentes.
app.use("/api/gestor", colaboradoresRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/motorista", motoristaVeiculosRoutes);

// 🟢 RESERVAS / VIAGENS
app.use("/api/reservas", reservasRoutes);
app.use("/api/trips", tripsRoutes);
app.use("/api/motorista", motoristaRoutes);
app.use("/api/viagens", viagensRoutes);

// 🚗 GESTÃO DE FROTA
app.use("/api/frota",    gestaoFrotaRoutes);
app.use("/api/veiculos", veiculosRoutes);

// 💳 PAGAMENTOS
app.use("/api/payments", paymentsRoutes);

// 💬 FEEDBACK
app.use("/api/feedback", feedbackRoutes);

// 🧾 FATURAÇÃO
app.use("/api/faturacao", faturacaoRoutes);

// 📩 QUOTES
app.use("/api/quotes", quoteRoutes);

// 🎟️ TICKETS
app.use("/api/tickets", ticketRoutes);

// 🔁 PARTILHA
app.use("/api/partilha", partilhaRoutes);

// 🔐 PASSWORD
app.use("/api/password", passwordRoutes);

// 🔔 NOTIFICAÇÕES
app.use("/api/validacoes", validacaoNotifyRoutes);

// ✅ VALIDADORES
// /api/validadores      — login, logout, me, painel (acesso do validador)
// /api/admin/validadores — convidar, gerir (acesso do admin)
app.use("/api/validadores",       validadorRoutes);
app.use("/api/admin/validadores", validadorRoutes);

// 🧑‍💼 ADMIN / BACKOFFICE
app.use("/api/admin", adminRoutes);
app.use("/api/admin/motoristas", motoristasModuleRoutes);
app.use("/api/admin/parceiros", parceiroInviteRoutes);
app.use("/api/admin/operadores-seguranca", authAdmin, adminOperadoresSegurancaRoutes);
app.use("/api/admin/partner-keys",         authAdmin, partnerKeysRoutes);
app.use("/api/validation",                 validationSubmissionsRoutes);
app.use("/api/admin/vehicle-categories",   authAdmin, vehicleCategoryRoutes);
app.use("/api/auth", authRoutes);
// 🎟️ CONVIDADOS
app.use("/api/convidado", convidadoRoutes);

// 🛡️ SEGURANÇA
app.use("/api/tracking", trackingRoutes);
app.use("/api/operadores-seguranca", operadorSegurancaRoutes);

// 🧪 TEMP / TESTES
app.use("/api", inviteMotoristaRoutes);
app.use("/api", validacaoTempRoutes);

/* ==============================
   404 API
============================== */
app.use("/api", (req, res) => {
  res.status(404).json({
    ok: false,
    message: "Endpoint não encontrado",
    path: req.originalUrl
  });
});

/* ==============================
   ERROR HANDLER
============================== */
app.use(errorMiddleware);

/* ==============================
   404 FRONTEND
============================== */
app.use((_req, res) => {
  res.status(404).send("Página não encontrada");
});

export default app;
export { app };