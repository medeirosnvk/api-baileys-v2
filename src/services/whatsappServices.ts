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
import { normalizeBrazilianNumber } from "../utils/validateAndFormatNumber.js";
import { executeQuery } from "../config/database/dbConfig.js";
import { formatPhoneNumber } from "../utils/formatProne.js";
import axios from "axios";

export class WhatsAppService {
  private connections = new Map<string, WASocket>();
  private connectionStatus = new Map<string, ConnectionStatus>();
  private authDir = path.resolve(process.cwd(), "auth");

  // 🔒 NOVO: Controle de locks para evitar chamadas concorrentes
  private connectionLocks = new Map<string, boolean>();
  private connectionPromises = new Map<string, Promise<ConnectionStatus>>();

  // 🔄 Controle de tentativas de reconexão
  private reconnectAttempts = new Map<string, number>();
  private qrLocks: Map<string, boolean> = new Map();
  private readonly MAX_RECONNECT_ATTEMPTS = 3;

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
    // 🔒 PROTEÇÃO 1: Se já existe uma promise em andamento, retorna ela
    const existingPromise = this.connectionPromises.get(connectionId);

    if (existingPromise) {
      Logger.info(
        `Conexão ${connectionId} já está em processamento. Retornando promise existente.`
      );
      return existingPromise;
    }

    // 🔒 PROTEÇÃO 2: Verificar se já existe lock ativo
    if (this.connectionLocks.get(connectionId)) {
      Logger.warn(
        `Tentativa de criar conexão ${connectionId} enquanto outra está em andamento. Ignorando.`
      );

      const status = this.connectionStatus.get(connectionId);
      if (status) return status;

      throw new Error(`Conexão ${connectionId} está sendo processada`);
    }

    // 🔒 PROTEÇÃO 3: Verificar status atual antes de prosseguir
    const existingStatus = this.connectionStatus.get(connectionId);
    if (existingStatus && !isReconnection) {
      // Se está conectando ou conectado E NÃO é reconexão, retorna o status atual
      if (
        existingStatus.status === "connecting" ||
        existingStatus.status === "connected"
      ) {
        Logger.info(
          `Conexão ${connectionId} já está ${existingStatus.status}. Retornando status atual.`
        );
        return existingStatus;
      }
    }

    // 🛠️ Nova verificação para reconexões
    if (isReconnection && existingStatus?.status === "connecting") {
      Logger.info(`Reconexão ignorada: ${connectionId} ainda está conectando.`);
      return existingStatus;
    }

    // Cria a promise e armazena antes de iniciar o processo
    const connectionPromise = this._createConnectionInternal(
      connectionId,
      isReconnection
    );

    this.connectionPromises.set(connectionId, connectionPromise);

    try {
      const result = await connectionPromise;
      return result;
    } finally {
      // Limpa a promise após conclusão (sucesso ou erro)
      this.connectionPromises.delete(connectionId);
    }
  }

  private async _createConnectionInternal(
    connectionId: string,
    isReconnection = false
  ): Promise<ConnectionStatus> {
    // Ativa o lock
    this.connectionLocks.set(connectionId, true);

    // 🛠️ Proteção extra: se já existir um socket ativo, aborta
    if (this.connections.has(connectionId)) {
      Logger.warn(
        `_createConnectionInternal abortado: socket já existe para ${connectionId}`
      );
      this.connectionLocks.delete(connectionId);
      return this.connectionStatus.get(connectionId)!;
    }

    // 🛠️ Debounce: aguarda 500ms antes de criar o socket (evita reentradas rápidas)
    await new Promise((r) => setTimeout(r, 500));

    try {
      // Se for reconexão, limpar conexão existente apenas se não estiver "connecting"
      if (isReconnection && this.connections.has(connectionId)) {
        const existingSocket = this.connections.get(connectionId);
        const currentStatus = this.connectionStatus.get(connectionId);

        if (!currentStatus || currentStatus.status !== "connecting") {
          try {
            existingSocket?.end(undefined);
          } catch (error) {
            Logger.warn(`Erro ao finalizar socket existente: ${error}`);
          }
          this.connections.delete(connectionId);
        } else {
          Logger.info(
            `Conexão ${connectionId} está em connecting. Não será finalizada.`
          );
        }
      } else if (!isReconnection && this.connections.has(connectionId)) {
        throw new Error("Conexão já existe");
      }

      const authPath = path.join(this.authDir, connectionId);

      // Se NÃO for reconexão, sempre limpar pasta de sessão antiga
      if (!isReconnection && (await fs.pathExists(authPath))) {
        Logger.warn(
          `Removendo sessão antiga de ${connectionId} para evitar credenciais corrompidas`
        );
        await fs.remove(authPath);
      }

      await fs.ensureDir(authPath);

      const { state, saveCreds } = await useMultiFileAuthState(authPath);

      const WHATSAPP_VERSION: [number, number, number] = [2, 3000, 1027934701];

      const socket = makeWASocket({
        version: WHATSAPP_VERSION,
        auth: state,
        logger: pino({ level: "silent" }),
      });

      this.connections.set(connectionId, socket);

      const status: ConnectionStatus = {
        id: connectionId,
        status: "connecting",
        createdAt: new Date(),
        phoneNumber: null,
      };

      this.connectionStatus.set(connectionId, status);

      // Controle de QR Code
      let qrShown = false;
      let qrTimeout: NodeJS.Timeout | null = null;

      socket.ev.on("creds.update", saveCreds);

      socket.ev.on("connection.update", async (update: any) => {
        const { qr, connection } = update;

        if (qr && !qrShown && !this.qrLocks.get(connectionId)) {
          qrShown = true;

          // 🛠️ Ativa o lock global de QR
          this.qrLocks.set(connectionId, true);

          Logger.info(`QR Code gerado para conexão ${connectionId}`);
          qrcode.generate(qr, { small: true });

          qrTimeout = setTimeout(() => {
            Logger.warn(
              `Tempo limite atingido para leitura do QR de ${connectionId}. Encerrando tentativa.`
            );
            socket.end(undefined);
            this.connections.delete(connectionId);
            this.qrLocks.delete(connectionId); // 🛠️ Libera o lock global de QR

            const timeoutStatus = this.connectionStatus.get(connectionId);
            if (timeoutStatus) {
              timeoutStatus.status = "error";
              timeoutStatus.error = "timeout";
              this.connectionStatus.set(connectionId, timeoutStatus);
            }

            // 🔒 Libera o lock quando houver timeout
            this.connectionLocks.delete(connectionId);
          }, 5 * 60 * 1000);
        }

        if (connection === "open" && qrTimeout) {
          clearTimeout(qrTimeout);
          qrTimeout = null;
          Logger.info(`Conexão estabelecida com sucesso: ${connectionId}`);

          // 🛠️ Libera o lock global de QR
          this.qrLocks.delete(connectionId);

          // 🔒 Libera o lock quando conectar com sucesso
          this.connectionLocks.delete(connectionId);
        }

        if (connection === "close" && qrTimeout) {
          clearTimeout(qrTimeout);
          qrTimeout = null;
          Logger.warn(`Conexão encerrada antes de autenticar: ${connectionId}`);

          // 🛠️ Libera o lock global de QR
          this.qrLocks.delete(connectionId);

          // 🔒 Libera o lock quando fechar
          this.connectionLocks.delete(connectionId);
        }

        await this.handleConnectionUpdate(connectionId, update);
      });

      socket.ev.on("messages.upsert", (messageUpdate: any) => {
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
      // 🔒 Libera o lock em caso de erro
      this.connectionLocks.delete(connectionId);
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

      // Se foi encerrada por timeout do QR (408), não tenta reconectar
      if (errorCode === 408 || status.error === "timeout") {
        Logger.warn(
          `Conexão ${connectionId} fechada por TIMEOUT do QR. Não será reconectada.`
        );
        status.status = "disconnected";
        status.error = "timeout";
        await this.removeConnection(connectionId);
        this.connections.delete(connectionId);
        this.connectionStatus.set(connectionId, status);
        this.connectionLocks.delete(connectionId);
        return;
      }

      // Erros críticos — encerrar definitivamente
      if (
        errorCode === DisconnectReason.badSession ||
        errorCode === DisconnectReason.forbidden ||
        error?.message?.includes("405")
      ) {
        status.status = "error";
        status.error = "Sessão inválida ou número proibido";
        Logger.error(
          `Encerrando conexão ${connectionId} por erro crítico (badSession/forbidden/405)`
        );
        await this.removeConnection(connectionId);
        this.connectionStatus.set(connectionId, status);
        this.connectionLocks.delete(connectionId);
        return;
      }

      // 🧩 Lista de erros reconectáveis
      const reconectaveis = [
        515, // Stream Error
        DisconnectReason.loggedOut,
        DisconnectReason.restartRequired,
        DisconnectReason.connectionLost,
      ];

      if (reconectaveis.includes(errorCode)) {
        const attempts = this.reconnectAttempts.get(connectionId) || 0;

        if (attempts >= this.MAX_RECONNECT_ATTEMPTS) {
          Logger.error(
            `❌ Máximo de tentativas de reconexão atingido (${attempts}/${this.MAX_RECONNECT_ATTEMPTS}) para ${connectionId}`
          );
          status.status = "error";
          status.error = `Falha após ${attempts} tentativas (${errorCode})`;
          this.connectionStatus.set(connectionId, status);
          this.reconnectAttempts.delete(connectionId);
          this.connectionLocks.delete(connectionId);
          await this.removeConnection(connectionId);
          return;
        }

        // Incrementa e tenta reconectar
        this.reconnectAttempts.set(connectionId, attempts + 1);

        Logger.warn(
          `⚠️  Erro reconectável (${errorCode}) em ${connectionId}. Tentativa ${
            attempts + 1
          }/${this.MAX_RECONNECT_ATTEMPTS}`
        );

        // Atualiza status e libera lock
        status.status = "disconnected";
        status.error = `Erro ${errorCode} - reconectando...`;
        this.connectionStatus.set(connectionId, status);
        this.connections.delete(connectionId);
        this.connectionLocks.delete(connectionId);

        setTimeout(async () => {
          try {
            Logger.info(
              `🔄 Iniciando reconexão automática para ${connectionId}`
            );
            await this.createConnection(connectionId, true);
          } catch (reconnectError) {
            Logger.error(
              `Falha na reconexão automática de ${connectionId}:`,
              reconnectError
            );

            const currentStatus = this.connectionStatus.get(connectionId);
            if (currentStatus) {
              currentStatus.status = "error";
              currentStatus.error = "Falha na reconexão após erro reconectável";
              this.connectionStatus.set(connectionId, currentStatus);
            }
          }
        }, 3000);

        return;
      }

      // Outros erros genéricos
      if (error?.message?.includes("SessionEntry")) {
        Logger.warn(`sessão E2E foi encerrada e será recriada. Ignorando...`);
      }

      this.connectionStatus.set(connectionId, status);
    } else if (connection === "open") {
      status.status = "connected";
      status.qrCode = undefined;
      status.error = undefined;
      status.createdAt = new Date();

      const socket = this.connections.get(connectionId);

      if (socket?.user?.id) {
        status.phoneNumber = socket.user.id.split("@")[0].split(":")[0];
      }

      Logger.success(`Conexão ${connectionId} estabelecida com sucesso!`);
      this.connectionStatus.set(connectionId, status);

      // 🔄 Reseta contador de tentativas após conexão bem-sucedida
      this.reconnectAttempts.delete(connectionId);
    }
  }

  private async handleIncomingMessage(
    connectionId: string,
    messageUpdate: any
  ) {
    const { type, messages } = messageUpdate;

    let mediaName = "";
    let mediaUrl = "";
    let mediaBase64 = "";
    let ticketId = "";
    let bot_idstatus = "";

    const port = process.env.PORT;
    const urlHostIP = process.env.HOST_IP;
    const urlWebhookMedia = `${urlHostIP}:${port}`;

    if (type !== "notify" || !messages) {
      for (const message of messages) {
        if (message.key.fromMe) continue;

        console.log("message", message);

        Logger.info(`Mensagem recebida na conexão ${connectionId}:`, {
          from: message.key.remoteJid,
          message: message.message?.conversation || "Mídia/Outros",
        });

        const responseStatusUrlWebhook = await executeQuery(
          `SELECT webhook, ativa_bot FROM codechat_hosts ch WHERE nome='${urlWebhookMedia}'`
        );

        const firstRow = Array.isArray(responseStatusUrlWebhook)
          ? responseStatusUrlWebhook[0]
          : (responseStatusUrlWebhook as any)?.rows?.[0];

        const { webhook, ativa_bot } = firstRow || {};
        const fromPhoneNumber = formatPhoneNumber(message.from);
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);

        if (message.hasMedia) {
          try {
            // Fazer o download da mídia
            const media = await message.downloadMedia();

            // Determinar mimeType e extensão
            const mimeType: string =
              media.mimetype || "application/octet-stream";
            let ext = mimeType.split("/")[1] || "bin";

            // Normalizar extensões comuns
            if (ext.includes("jpeg")) ext = "jpg";
            if (ext.includes("javascript")) ext = "js";

            // Se for pdf, forçar extensão pdf
            if (mimeType === "application/pdf") ext = "pdf";

            // Classificar tipo geral (image, video, audio, document)
            let mediaType = "document";
            if (mimeType.startsWith("image/")) mediaType = "image";
            else if (mimeType.startsWith("video/")) mediaType = "video";
            else if (mimeType.startsWith("audio/")) mediaType = "audio";

            const mediaPath = path.join(
              __dirname,
              "../../media",
              fromPhoneNumber
            );

            // Garantir que o diretório existe
            await fs.ensureDir(mediaPath);

            // Definir o nome e o caminho do arquivo
            const fileName = `${new Date().getTime()}.${ext}`;
            const filePath = path.join(mediaPath, fileName);

            // media.data geralmente já é base64 (string) quando vindo do baileys
            let base64Data: string;
            if (typeof media.data === "string") {
              base64Data = media.data;
            } else if (Buffer.isBuffer(media.data)) {
              base64Data = media.data.toString("base64");
            } else {
              // tentar converter caso venha em outro formato
              base64Data = Buffer.from(media.data).toString("base64");
            }

            // Salvar o arquivo localmente
            await fs.writeFile(filePath, Buffer.from(base64Data, "base64"));

            // Verificar se foi salvo corretamente
            if (await fs.pathExists(filePath)) {
              const stats = await fs.stat(filePath);
              console.log(`Arquivo recebido e salvo em: ${filePath}`);
              mediaName = fileName;
              mediaUrl = `${urlWebhookMedia}/media/${fromPhoneNumber}/${fileName}`;
              mediaBase64 = base64Data;

              // Adicionar informações de mídia ao payload
              ticketId = message?.key?.id || "";
              bot_idstatus = "received";

              // anexar campos extras no message que será enviado ao webhook
              message.media = {
                mediaType,
                mimeType,
                fileName,
                fileSize: stats.size,
                base64: base64Data,
                url: mediaUrl,
              };
            } else {
              console.error(
                `O arquivo não foi salvo corretamente em ${filePath}`
              );
            }
          } catch (error) {
            console.error(
              `Erro ao processar mídia para a sessão ${connectionId}:`,
              error
            );
          }
        }

        try {
          const payload: any = {
            connectionId,
            message: {
              ...message,
              body: mediaName || message.body,
            },
          };

          // Se temos dados de mídia, anexar campos adicionais
          if (mediaName || mediaBase64 || mediaUrl || message.media) {
            payload.message.media = {
              name: mediaName || message.media?.fileName,
              url: mediaUrl || message.media?.url,
              base64: mediaBase64 || message.media?.base64,
              type:
                message.media?.mediaType ||
                (mediaName ? mediaName.split(".").pop() : undefined),
              mimeType: message.media?.mimeType || undefined,
              fileSize: message.media?.fileSize || undefined,
            };
          }

          await axios.post(webhook, payload);
        } catch (error: any) {
          console.error(
            `Erro ao enviar dados para o webhook para a sessão ${connectionId}:`,
            error?.message || error
          );
          if (error?.response) {
            console.error("Webhook response status:", error.response.status);
            console.error("Webhook response data:", error.response.data);
          }
        }
      }
    } else {
      Logger.info(`Atualização de mensagem ignorada:`, messageUpdate);
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

      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);

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
    mimeType: "image" | "document" | "video" | "audio" | "application/pdf",
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
            fileName: fileName,
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
        case "application/pdf":
          messageContent = {
            document: mediaBuffer,
            fileName: fileName,
            caption,
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

  getAllConnections() {
    return Array.from(this.connectionStatus.values()).map((status) => ({
      instance: {
        instanceName: status.id, // mapeia o id da conexão
        owner: status.phoneNumber, // mapeia o número pareado
      },
    }));
  }

  async getQRCodeImage(connectionId: string): Promise<Buffer | null> {
    try {
      // 🔒 Validação básica
      if (!connectionId || typeof connectionId !== "string") {
        Logger.error("❌ connectionId inválido:", connectionId);
        return null;
      }

      // 📁 Caminho dinâmico compatível com local e produção
      const tempDir =
        process.env.QR_TEMP_DIR || path.resolve(process.cwd(), "temp");
      await fs.ensureDir(tempDir);

      const qrPath = path.join(tempDir, `${connectionId}.png`);

      // 🔍 Verifica se o caminho existe
      if (!(await fs.pathExists(qrPath))) {
        Logger.warn(`⚠️ QR Code não encontrado em: ${qrPath}`);
        return null;
      }

      // 🧩 Garante que o caminho é um arquivo (não uma pasta)
      const stats = await fs.stat(qrPath);
      if (!stats.isFile()) {
        Logger.error(`❌ O caminho não é um arquivo: ${qrPath}`);
        return null;
      }

      // ✅ Retorna o Buffer da imagem PNG
      return await fs.readFile(qrPath);
    } catch (error) {
      Logger.error("Erro ao obter QR Code:", error);
      return null;
    }
  }

  async getQRCodeBase64(connectionId: string): Promise<string | null> {
    try {
      if (!connectionId || typeof connectionId !== "string") {
        Logger.error("❌ connectionId inválido:", connectionId);
        return null;
      }

      const tempDir =
        process.env.QR_TEMP_DIR || path.resolve(process.cwd(), "temp");
      await fs.ensureDir(tempDir);

      const qrPath = path.join(tempDir, `${connectionId}.png`);

      // 🔎 Garante que o caminho existe e é um arquivo
      if (!(await fs.pathExists(qrPath))) {
        Logger.warn(`⚠️ QR Code não encontrado em: ${qrPath}`);
        return null;
      }

      const stats = await fs.stat(qrPath);
      if (!stats.isFile()) {
        Logger.error(`❌ O caminho não é um arquivo: ${qrPath}`);
        return null;
      }

      // 📄 Agora podemos ler com segurança
      const buffer = await fs.readFile(qrPath);
      return buffer.toString("base64");
    } catch (error) {
      Logger.error("Erro ao obter QR Code em Base64:", error);
      return null;
    }
  }

  async checkWhatsappNumber(
    connectionId: string,
    phoneNumber: string
  ): Promise<any | null> {
    const socket = this.connections.get(connectionId);

    if (!socket) {
      throw new Error("Conexão não encontrada");
    }

    const status = this.connectionStatus.get(connectionId);

    if (status?.status !== "connected") {
      throw new Error("Conexão não está ativa");
    }

    const normalized = await normalizeBrazilianNumber(phoneNumber);

    const jid = `${normalized}@s.whatsapp.net`;

    try {
      const result = await socket.onWhatsApp(jid);
      const exists = result?.[0]?.exists || false;

      if (exists) {
        return [
          {
            exists: true,
          },
        ];
      } else {
        return [
          {
            exists: false,
          },
        ];
      }
    } catch (error) {
      console.error("Erro ao verificar número:", error);
      return null;
    }
  }
}
