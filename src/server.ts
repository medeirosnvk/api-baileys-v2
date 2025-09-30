import express from "express";
import cors from "cors";
import * as fs from "fs-extra";
import * as path from "path";
import whatsappRoutes from "./routes/whatsappRoutes";
import { Logger } from "./utils/logger";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
  Logger.info(
    `📱 WhatsApp API disponível em http://localhost:${PORT}/api/baileys`
  );
  Logger.info(`💊 Health check disponível em http://localhost:${PORT}/health`);
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
