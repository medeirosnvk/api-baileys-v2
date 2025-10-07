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
      const existingStatus = this.connectionStatus.get(connectionId);

      // Se já existe conexão em andamento, apenas retorna o status atual
      if (existingStatus && existingStatus.status === "connecting") {
        Logger.info(
          `Conexão ${connectionId} já está em andamento. Ignorando nova tentativa.`
        );
        return existingStatus;
      }

      // Se for reconexão, limpar conexão existente apenas se não estiver "connecting"
      if (isReconnection && this.connections.has(connectionId)) {
        const existingSocket = this.connections.get(connectionId);
        const currentStatus = this.connectionStatus.get(connectionId);
        console.log("existingSocket -", existingSocket);
        console.log("currentStatus -", currentStatus);

        if (!currentStatus || currentStatus.status !== "connecting") {
          try {
            existingSocket?.end(undefined);
          } catch (error) {
            Logger.warn(`Erro ao finalizar socket existente: ${error}`);
          }
          this.connections.delete(connectionId);
        } else {
          Logger.info(
            `Conexão ${connectionId} está em connecting. Não será finalizada para evitar interrupção.`
          );
        }
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

      // Controle de QR Code
      let qrShown = false;
      let qrTimeout: NodeJS.Timeout | null = null;

      socket.ev.on("creds.update", saveCreds);

      // socket.ev.on("connection.update", async (update) => {
      //   const { qr, connection } = update;

      //   if (qr && !qrShown) {
      //     qrShown = true;
      //     Logger.info(`QR Code gerado para conexão ${connectionId}`);
      //     qrcode.generate(qr, { small: true });

      //     qrTimeout = setTimeout(() => {
      //       Logger.warn(
      //         `Tempo limite atingido para leitura do QR de ${connectionId}. Encerrando tentativa.`
      //       );
      //       socket.end(undefined);
      //       this.connections.delete(connectionId);

      //       const timeoutStatus = this.connectionStatus.get(connectionId);
      //       if (timeoutStatus) {
      //         timeoutStatus.status = "error";
      //         timeoutStatus.error = "timeout";
      //         this.connectionStatus.set(connectionId, timeoutStatus);
      //       }
      //     }, 5 * 60 * 1000);
      //   }

      //   if (connection === "open" && qrTimeout) {
      //     clearTimeout(qrTimeout);
      //     qrTimeout = null;
      //     Logger.info(`Conexão estabelecida com sucesso: ${connectionId}`);
      //   }

      //   if (connection === "close" && qrTimeout) {
      //     clearTimeout(qrTimeout);
      //     qrTimeout = null;
      //     Logger.warn(`Conexão encerrada antes de autenticar: ${connectionId}`);
      //   }

      //   await this.handleConnectionUpdate(connectionId, update);
      // });

      socket.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "close") {
          let shouldReconnect = true;

          const error = lastDisconnect?.error;
          if (error) {
            // Verifica se é uma instância Boom (que tem .output)
            if (error instanceof Boom) {
              shouldReconnect =
                error.output.statusCode !== DisconnectReason.loggedOut;
            } else {
              // fallback para erros genéricos
              shouldReconnect = true;
            }
          }

          if (shouldReconnect) {
            console.log(
              `🔄 Tentando reconectar a instância ${connectionId}...`
            );
            // opcional: aqui você pode chamar a função que reconecta, ex:
            // createConnection(connectionId, true);
          } else {
            console.log(
              `⚠️ Usuário da instância ${connectionId} desconectado. Escaneie o QR Code novamente.`
            );
          }
        } else if (connection === "open") {
          console.log(
            `✅ Conexão iniciada com sucesso para a instância ${connectionId}!`
          );
        }
      });

      socket.ev.on("messages.upsert", (messageUpdate) => {
        this.handleIncomingMessage(connectionId, messageUpdate);
      });

      Logger.info(
        isReconnection
          ? `Tentando reconectar: ${connectionId}`
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
    let status = this.connectionStatus.get(connectionId);

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

      status = this.connectionStatus.get(connectionId);
      if (!status) return;

      // 🚫 Se foi encerrada por timeout do QR (408), não tenta reconectar
      if (errorCode === 408 || status.error === "timeout") {
        Logger.warn(
          `Conexão ${connectionId} fechada por TIMEOUT do QR. Não será reconectada.`
        );
        status.status = "disconnected";
        status.error = "timeout";
        await this.removeConnection(connectionId);

        this.connections.delete(connectionId);
        this.connectionStatus.set(connectionId, status);
        return;
      }

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

      this.connectionStatus.set(connectionId, status);
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
      this.connectionStatus.set(connectionId, status);
    }
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
      // Caminho absoluto da pasta temp
      const qrPath = path.join(
        "/home/deploy/api-baileys/temp",
        `${connectionId}.png`
      );

      if (await fs.pathExists(qrPath)) {
        return await fs.readFile(qrPath);
      }

      Logger.warn(`QR Code não encontrado em: ${qrPath}`);
      return null;
    } catch (error) {
      Logger.error("Erro ao obter QR Code:", error);
      return null;
    }
  }

  async getQRCodeBase64(connectionId: string): Promise<string | null> {
    try {
      // Caminho absoluto da pasta temp
      const qrPath = path.join(
        "/home/deploy/api-baileys/temp",
        `${connectionId}.png`
      );

      if (await fs.pathExists(qrPath)) {
        const buffer = await fs.readFile(qrPath);
        return buffer.toString("base64"); // 🔑 converte para base64
      }

      Logger.warn(`QR Code não encontrado em: ${qrPath}`);
      return null;
    } catch (error) {
      Logger.error("Erro ao obter QR Code em Base64:", error);
      return null;
    }
  }
}
