import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./routes/auth.routes.js";
import reservasRoutes from "./routes/reservas.routes.js";
import partilhaRoutes from "./routes/partilha.routes.js";

dotenv.config();

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Health (pode ficar antes ou depois, tanto faz)
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    port: Number(process.env.PORT || 10000),
    hasMongoUri: Boolean(process.env.MONGODB_URI || process.env.MONGO_URI),
  });
});

// Rotas
app.use("/api", authRoutes);
app.use("/", reservasRoutes);
app.use("/", partilhaRoutes);

export default app;
