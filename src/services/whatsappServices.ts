import {
  default as makeWASocket,
  WASocket,
  DisconnectReason,
  useMultiFileAuthState,
  ConnectionState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { Boom } from "@hapi/boom";
import * as QRCode from "qrcode";
import { Logger } from "../utils/logger.js";
import qrcode from "qrcode-terminal";
import { ConnectionStatus } from "../types/index.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs-extra";

export class WhatsAppService {
  private connections = new Map<string, WASocket>();
  private connectionStatus = new Map<string, ConnectionStatus>();
  // Use project-root level auth directory so it works in dev (src) and prod (dist)
  private authDir = path.resolve(process.cwd(), "auth");

  constructor() {
    this.ensureAuthDirectory();
    Logger.info(`Diretório de autenticação: ${this.authDir}`);
    this.loadExistingConnections();
  }

  private async ensureAuthDirectory() {
    try {
      await fs.ensureDir(this.authDir);
      Logger.info(
        `Diretório de autenticação verificado/criado: ${this.authDir}`
      );
    } catch (error) {
      Logger.error(`Erro ao garantir diretório de autenticação:`, error);
      throw error;
    }
  }

  private async loadExistingConnections() {
    try {
      const authFolders = await fs.readdir(this.authDir);

      for (const folder of authFolders) {
        const authPath = path.join(this.authDir, folder);
        const stats = await fs.stat(authPath);

        if (stats.isDirectory()) {
          Logger.info(`Reconectando conexão existente: ${folder}`);
          await this.createConnection(folder, true);
        }
      }
    } catch (error) {
      Logger.error("Erro ao carregar conexões existentes:", error);
    }
  }

  async createConnection(
    connectionId: string,
    isReconnection = false
  ): Promise<ConnectionStatus> {
    try {
      // Se for reconexão, limpar conexão existente primeiro
      if (isReconnection && this.connections.has(connectionId)) {
        const existingSocket = this.connections.get(connectionId);
        try {
          existingSocket?.end(undefined);
        } catch (error) {
          Logger.warn(`Erro ao finalizar socket existente: ${error}`);
        }
        this.connections.delete(connectionId);
      } else if (!isReconnection && this.connections.has(connectionId)) {
        throw new Error("Conexão já existe");
      }

      const authPath = path.join(this.authDir, connectionId);

      // 🔑 Se NÃO for reconexão, sempre limpar pasta de sessão antiga
      if (!isReconnection && (await fs.pathExists(authPath))) {
        Logger.warn(
          `Removendo sessão antiga de ${connectionId} para evitar credenciais corrompidas`
        );
        await fs.remove(authPath);
      }

      await fs.ensureDir(authPath);

      const { state, saveCreds } = await useMultiFileAuthState(authPath);

      const socket = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
      });

      this.connections.set(connectionId, socket);

      const status: ConnectionStatus = {
        id: connectionId,
        status: "connecting",
        lastSeen: new Date(),
      };

      this.connectionStatus.set(connectionId, status);

      let qrShown = false;
      let qrTimeout: NodeJS.Timeout | null = null;

      // Evento atualizacao
      socket.ev.on("creds.update", saveCreds);

      // Evento qrcode
      socket.ev.on("connection.update", async (update) => {
        const { qr, connection } = update;

        // Exibe QR apenas uma vez, tanto em nova conexão quanto em reconexão
        if (qr && !qrShown) {
          qrShown = true;
          Logger.info(
            `QR Code gerado para conexão ${connectionId} (${
              isReconnection ? "reconexão" : "nova"
            })`
          );
          qrcode.generate(qr, { small: true });

          // ⏳ Se em 5 minutos não conectar, encerrar a tentativa
          qrTimeout = setTimeout(() => {
            Logger.warn(
              `Tempo limite atingido para leitura do QR de ${connectionId}. Encerrando tentativa.`
            );
            socket.end(undefined);
            this.connections.delete(connectionId);
            this.connectionStatus.delete(connectionId);
          }, 5 * 60 * 1000); // 5 minutos
        }

        // Se conectou, limpar timeout
        if (connection === "open" && qrTimeout) {
          clearTimeout(qrTimeout);
          qrTimeout = null;
          Logger.info(`Conexão estabelecida com sucesso: ${connectionId}`);
        }

        // Se a conexão fechar, limpar timeout também
        if (connection === "close" && qrTimeout) {
          clearTimeout(qrTimeout);
          qrTimeout = null;
          Logger.warn(`Conexão encerrada antes de autenticar: ${connectionId}`);
        }

        await this.handleConnectionUpdate(connectionId, update);
      });

      // Evento mensagem
      socket.ev.on("messages.upsert", (messageUpdate) => {
        this.handleIncomingMessage(connectionId, messageUpdate);
      });

      Logger.info(
        isReconnection
          ? `Reconexão realizada: ${connectionId}`
          : `Nova conexão criada: ${connectionId}`
      );

      return status;
    } catch (error) {
      Logger.error(`Erro ao criar conexão ${connectionId}:`, error);
      throw error;
    }
  }

  private async handleConnectionUpdate(
    connectionId: string,
    update: Partial<ConnectionState>
  ) {
    const { connection, lastDisconnect, qr } = update;
    const status = this.connectionStatus.get(connectionId);

    if (!status) return;

    if (qr) {
      status.qrCode = qr;
      status.status = "connecting";
      Logger.info(`QR Code gerado para conexão: ${connectionId}`);

      try {
        const qrDir = path.resolve(process.cwd(), "temp");
        const qrPath = path.join(qrDir, `${connectionId}.png`);
        await fs.ensureDir(qrDir);
        await QRCode.toFile(qrPath, qr);
        Logger.success(`QR Code salvo em: ${qrPath}`);
      } catch (error) {
        Logger.error("Erro ao salvar QR Code:", error);
      }
    }

    if (connection === "close") {
      const error = lastDisconnect?.error as Boom;
      const errorCode = error?.output?.statusCode;

      Logger.warn(
        `Conexão ${connectionId} fechada. Código: ${errorCode}`,
        error
      );

      // 🔑 Forçar parada definitiva em erros críticos
      if (
        errorCode === DisconnectReason.badSession ||
        errorCode === DisconnectReason.forbidden ||
        error?.message?.includes("405") // fallback
      ) {
        status.status = "error";
        status.error = "Sessão inválida ou número proibido";
        Logger.error(
          `Encerrando conexão ${connectionId} por erro crítico (badSession/forbidden/405)`
        );
        await this.removeConnection(connectionId);
        this.connectionStatus.set(connectionId, status);
        return; // 🔑 não tenta reconectar
      }

      const shouldReconnect = errorCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        status.status = "connecting";
        Logger.info(`Reconectando ${connectionId} em 5s...`);
        this.connections.delete(connectionId);
        setTimeout(async () => {
          try {
            await this.createConnection(connectionId, true);
          } catch (error) {
            Logger.error(`Erro na reconexão ${connectionId}:`, error);
            status.status = "error";
            status.error = "Falha na reconexão";
            this.connectionStatus.set(connectionId, status);
          }
        }, 5000);
      } else {
        status.status = "disconnected";
        this.connections.delete(connectionId);
      }
    } else if (connection === "open") {
      status.status = "connected";
      status.qrCode = undefined;
      status.error = undefined;
      status.lastSeen = new Date();

      const socket = this.connections.get(connectionId);
      if (socket?.user?.id) {
        status.phoneNumber = socket.user.id.split(":")[0];
      }

      Logger.success(`Conexão ${connectionId} estabelecida com sucesso!`);
    }

    this.connectionStatus.set(connectionId, status);
  }

  private handleIncomingMessage(connectionId: string, messageUpdate: any) {
    const messages = messageUpdate.messages;

    for (const message of messages) {
      if (message.key.fromMe) continue;

      Logger.info(`Mensagem recebida na conexão ${connectionId}:`, {
        from: message.key.remoteJid,
        message: message.message?.conversation || "Mídia/Outros",
      });
    }
  }

  async removeConnection(connectionId: string): Promise<boolean> {
    try {
      const socket = this.connections.get(connectionId);

      if (socket) {
        await socket.logout();
      }

      this.connections.delete(connectionId);
      this.connectionStatus.delete(connectionId);

      // Remove auth files
      const authPath = path.join(this.authDir, connectionId);
      if (await fs.pathExists(authPath)) {
        await fs.remove(authPath);
      }

      // Remove QR code image
      const qrPath = path.join(
        __dirname,
        "../../temp",
        `${connectionId}_qr.png`
      );
      if (await fs.pathExists(qrPath)) {
        await fs.remove(qrPath);
      }

      Logger.success(`Conexão ${connectionId} removida com sucesso`);
      return true;
    } catch (error) {
      Logger.error(`Erro ao remover conexão ${connectionId}:`, error);
      return false;
    }
  }

  async sendTextMessage(
    connectionId: string,
    to: string,
    message: string
  ): Promise<boolean> {
    try {
      const socket = this.connections.get(connectionId);

      if (!socket) {
        throw new Error("Conexão não encontrada");
      }

      const status = this.connectionStatus.get(connectionId);

      if (status?.status !== "connected") {
        throw new Error("Conexão não está ativa");
      }

      let processedNumber = to;
      const brazilCountryCode = "55";

      if (processedNumber.startsWith(brazilCountryCode)) {
        const localNumber = processedNumber.slice(4);

        if (localNumber.length === 9 && localNumber.startsWith("9")) {
          processedNumber =
            brazilCountryCode +
            processedNumber.slice(2, 4) +
            localNumber.slice(1);
        }
      }

      const jid = processedNumber.includes("@")
        ? processedNumber
        : `${processedNumber}@s.whatsapp.net`;

      await socket.sendMessage(jid, { text: message });

      Logger.success(`Mensagem enviada para ${to} via ${connectionId}`);
      return true;
    } catch (error) {
      Logger.error(`Erro ao enviar mensagem:`, error);
      throw error;
    }
  }

  async sendMediaMessage(
    connectionId: string,
    to: string,
    type: "image" | "document" | "video" | "audio",
    caption?: string,
    mediaUrl?: string
  ): Promise<boolean> {
    try {
      const socket = this.connections.get(connectionId);

      if (!socket) {
        throw new Error("Conexão não encontrada");
      }

      const status = this.connectionStatus.get(connectionId);

      if (status?.status !== "connected") {
        throw new Error("Conexão não está ativa");
      }

      let processedNumber = to;
      const brazilCountryCode = "55";

      if (processedNumber.startsWith(brazilCountryCode)) {
        const localNumber = processedNumber.slice(4);

        if (localNumber.length === 9 && localNumber.startsWith("9")) {
          processedNumber =
            brazilCountryCode +
            processedNumber.slice(2, 4) +
            localNumber.slice(1);
        }
      }

      const jid = processedNumber.includes("@")
        ? processedNumber
        : `${processedNumber}@s.whatsapp.net`;

      let messageContent: any;

      switch (type) {
        case "image":
          messageContent = {
            image: { url: mediaUrl },
            caption,
          };
          break;
        case "document":
          messageContent = {
            document: { url: mediaUrl },
            fileName: mediaUrl?.split("/").pop() || "documento",
            caption,
          };
          break;
        case "video":
          messageContent = {
            video: { url: mediaUrl },
            caption,
          };
          break;
        case "audio":
          messageContent = {
            audio: { url: mediaUrl },
            mimetype: "audio/mp4",
          };
          break;
        default:
          throw new Error("Tipo de mídia não suportado");
      }

      await socket.sendMessage(jid, messageContent);

      Logger.success(`Mídia ${type} enviada para ${to} via ${connectionId}`);
      return true;
    } catch (error) {
      Logger.error(`Erro ao enviar mídia:`, error);
      throw error;
    }
  }

  async sendMediaMessageBase64(
    connectionId: string,
    to: string,
    base64: string,
    fileName: string,
    mimeType: "image" | "document" | "video" | "audio",
    caption: string
  ): Promise<boolean> {
    try {
      const socket = this.connections.get(connectionId);

      if (!socket) {
        throw new Error("Conexão não encontrada");
      }

      const status = this.connectionStatus.get(connectionId);

      if (status?.status !== "connected") {
        throw new Error("Conexão não está ativa");
      }

      let processedNumber = to;
      const brazilCountryCode = "55";

      if (processedNumber.startsWith(brazilCountryCode)) {
        const localNumber = processedNumber.slice(4);

        if (localNumber.length === 9 && localNumber.startsWith("9")) {
          processedNumber =
            brazilCountryCode +
            processedNumber.slice(2, 4) +
            localNumber.slice(1);
        }
      }

      const jid = processedNumber.includes("@")
        ? processedNumber
        : `${processedNumber}@s.whatsapp.net`;

      // Converte base64 em Buffer
      const mediaBuffer = Buffer.from(base64!, "base64");

      let messageContent: any;

      switch (mimeType) {
        case "image":
          messageContent = {
            image: mediaBuffer,
            caption,
          };
          break;
        case "document":
          messageContent = {
            document: mediaBuffer,
            fileName: "documento.pdf",
            caption,
          };
          break;
        case "video":
          messageContent = {
            video: mediaBuffer,
            caption,
          };
          break;
        case "audio":
          messageContent = {
            audio: mediaBuffer,
            mimetype: "audio/mp4",
          };
          break;
        default:
          throw new Error("Tipo de mídia não suportado");
      }

      await socket.sendMessage(jid, messageContent);

      Logger.success(
        `Mídia ${mimeType} (base64) enviada para ${to} via ${connectionId}`
      );
      return true;
    } catch (error) {
      Logger.error(`Erro ao enviar mídia base64:`, error);
      throw error;
    }
  }

  getConnection(connectionId: string): WASocket | undefined {
    return this.connections.get(connectionId);
  }

  getConnectionStatus(connectionId: string): ConnectionStatus | undefined {
    return this.connectionStatus.get(connectionId);
  }

  getAllConnections(): ConnectionStatus[] {
    return Array.from(this.connectionStatus.values());
  }

  async getQRCodeImage(connectionId: string): Promise<Buffer | null> {
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);

      const qrPath = path.join(__dirname, "../../temp", `${connectionId}.png`);

      if (await fs.pathExists(qrPath)) {
        return await fs.readFile(qrPath);
      }

      return null;
    } catch (error) {
      Logger.error("Erro ao obter QR Code:", error);
      return null;
    }
  }
}
