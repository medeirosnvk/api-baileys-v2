import { Request, Response } from "express";
import { WhatsAppService } from "../services/whatsappServices.js";
import { Logger } from "../utils/logger.js";

export class WhatsAppController {
  constructor(private whatsappService: WhatsAppService) {}

  async createConnection(req: Request, res: Response) {
    try {
      const { instanceName } = req.body;

      if (!instanceName) {
        return res.status(400).json({
          success: false,
          message: "instanceName é obrigatório",
        });
      }

      const status = await this.whatsappService.createConnection(instanceName);

      res.json({
        success: true,
        message: "Conexão criada com sucesso",
        data: status,
      });
    } catch (error: any) {
      Logger.error("Erro ao criar conexão:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Erro interno do servidor",
      });
    }
  }

  async getConnections(req: Request, res: Response) {
    try {
      const connections = this.whatsappService.getAllConnections();

      res.json(connections);
    } catch (error: any) {
      Logger.error("Erro ao obter conexões:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Erro interno do servidor",
      });
    }
  }

  async getConnectionStatus(req: Request, res: Response) {
    try {
      const { instanceName } = req.params;
      const status = this.whatsappService.getConnectionStatus(instanceName);

      if (!status) {
        return res.status(404).json({
          success: false,
          message: "Conexão não encontrada",
        });
      }

      res.json({
        instanceName,
        state: status.status === "connected" ? "open" : status.status,
      });
    } catch (error: any) {
      Logger.error("Erro ao obter status da conexão:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Erro interno do servidor",
      });
    }
  }

  async removeConnection(req: Request, res: Response) {
    try {
      const { instanceName } = req.params;

      if (!instanceName) {
        return res.status(400).send("instanceName is required");
      }

      const removed = await this.whatsappService.removeConnection(instanceName);

      if (!removed) {
        return res.status(404).json({
          success: false,
          message: "Conexão não encontrada",
        });
      }

      res.json({
        success: true,
        message: "Conexão removida com sucesso",
      });
    } catch (error: any) {
      Logger.error("Erro ao remover conexão:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Erro interno do servidor",
      });
    }
  }

  async sendMessage(req: Request, res: Response) {
    try {
      const { number, textMessage } = req.body;
      const { instanceName } = req.params;

      if (!instanceName || !number || !textMessage?.text) {
        return res
          .status(400)
          .send("instanceName, number, e textMessage.text são obrigatórios");
      }

      await this.whatsappService.sendTextMessage(
        instanceName,
        number,
        textMessage.text
      );

      res.json({
        status: "PENDING",
      });
    } catch (error: any) {
      Logger.error("Erro ao enviar mensagem:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Erro interno do servidor",
      });
    }
  }

  async sendMedia(req: Request, res: Response) {
    try {
      const { number, mediaMessage } = req.body;
      const { instanceName } = req.params;

      if (!instanceName || !number || !mediaMessage || !mediaMessage.media) {
        return res
          .status(400)
          .send("instanceName, number, e mediaMessage.media são obrigatórios.");
      }

      await this.whatsappService.sendMediaMessage(
        instanceName,
        number,
        mediaMessage.mediatype,
        mediaMessage.caption,
        mediaMessage.media
      );

      res.json({
        status: "PENDING",
      });
    } catch (error: any) {
      Logger.error("Erro ao enviar mídia:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Erro interno do servidor",
      });
    }
  }

  async sendMediaBase64(req: Request, res: Response) {
    try {
      const { number, mediaMessage } = req.body;
      const { instanceName } = req.params;

      if (!instanceName || !number || !mediaMessage || !mediaMessage.base64) {
        return res
          .status(400)
          .send("instanceName, number, and mediaMessage.base64 are required");
      }

      await this.whatsappService.sendMediaMessageBase64(
        instanceName,
        number,
        mediaMessage.base64,
        mediaMessage.fileName,
        mediaMessage.mimeType,
        mediaMessage.caption
      );

      res.json({
        status: "PENDING",
      });
    } catch (error: any) {
      Logger.error("Erro ao enviar mídia base64:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Erro interno do servidor",
      });
    }
  }

  async getQRCode(req: Request, res: Response) {
    try {
      const { instanceName } = req.params;
      const qrBuffer = await this.whatsappService.getQRCodeImage(instanceName);

      if (!qrBuffer) {
        return res.status(404).json({
          success: false,
          message: "QR Code não encontrado",
        });
      }

      res.setHeader("Content-Type", "image/png");
      res.send(qrBuffer);
    } catch (error: any) {
      Logger.error("Erro ao obter QR Code:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Erro interno do servidor",
      });
    }
  }

  async getQRCodeBase64(req: Request, res: Response) {
    try {
      const { instanceName } = req.params;
      const qrBase64 = await this.whatsappService.getQRCodeBase64(instanceName);

      if (!qrBase64) {
        return res.status(404).json({
          success: false,
          message: "QR Code não encontrado",
        });
      }

      res.json({
        instance: instanceName,
        base64: `data:image/png;base64,${qrBase64}`,
      });
    } catch (error: any) {
      Logger.error("Erro ao obter QR Code em Base64:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Erro interno do servidor",
      });
    }
  }

  async checkWhatsappNumber(req: Request, res: Response) {
    try {
      const { instanceName } = req.params;
      const { numbers } = req.body;
      const phoneNumber = numbers[0];

      if (!instanceName || !phoneNumber) {
        return res
          .status(400)
          .json("instanceName e phoneNumber são obrigatórios");
      }

      const result = await this.whatsappService.checkWhatsappNumber(
        instanceName,
        phoneNumber
      );

      return res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Erro ao verificar número WhatsApp:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Erro interno do servidor",
      });
    }
  }
}
