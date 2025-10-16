import express from "express";
import cors from "cors";
import fs from "fs-extra";
import path from "path";
import whatsappRoutes from "./routes/whatsappRoutes.js";
import { Logger } from "./utils/logger.js";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure temp directory exists
const tempDir = path.join(__dirname, "../temp");
fs.ensureDirSync(tempDir);

// Routes
app.use("/", whatsappRoutes);

// Health check
app.get("/status", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Error handling middleware
app.use(
  (
    error: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    Logger.error("Erro na aplicação:", error);

    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
);

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Rota não encontrada",
  });
});

// Start server
app.listen(PORT, () => {
  Logger.success(`🚀 Servidor rodando na porta ${PORT}`);
  Logger.info(`📱 API Baileys disponível em http://localhost:${PORT}/`);
  Logger.info(`💊 Status disponível em http://localhost:${PORT}/status`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  Logger.info("🔴 Desligando servidor...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  Logger.info("🔴 Desligando servidor...");
  process.exit(0);
});
