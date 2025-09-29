import { Request, Response } from 'express';
import { WhatsAppService } from '../services/whatsappServices';
import { Logger } from '../utils/logger';

export class WhatsAppController {
  constructor(private whatsappService: WhatsAppService) {}

  async createConnection(req: Request, res: Response) {
    try {
      const { connectionId } = req.params;

      if (!connectionId) {
        return res.status(400).json({
          success: false,
          message: 'connectionId é obrigatório'
        });
      }

      const status = await this.whatsappService.createConnection(connectionId);

      res.json({
        success: true,
        message: 'Conexão criada com sucesso',
        data: status
      });
    } catch (error: any) {
      Logger.error('Erro ao criar conexão:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erro interno do servidor'
      });
    }
  }

  async getConnections(req: Request, res: Response) {
    try {
      const connections = this.whatsappService.getAllConnections();

      res.json({
        connections
      });
    } catch (error: any) {
      Logger.error('Erro ao obter conexões:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erro interno do servidor'
      });
    }
  }

  async getConnectionStatus(req: Request, res: Response) {
    try {
      const { connectionId } = req.params;
      const status = this.whatsappService.getConnectionStatus(connectionId);

      if (!status) {
        return res.status(404).json({
          success: false,
          message: 'Conexão não encontrada'
        });
      }

      res.json({
        success: true,
        data: status
      });
    } catch (error: any) {
      Logger.error('Erro ao obter status da conexão:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erro interno do servidor'
      });
    }
  }

  async removeConnection(req: Request, res: Response) {
    try {
      const { connectionId } = req.params;
      const removed = await this.whatsappService.removeConnection(connectionId);

      if (!removed) {
        return res.status(404).json({
          success: false,
          message: 'Conexão não encontrada'
        });
      }

      res.json({
        success: true,
        message: 'Conexão removida com sucesso'
      });
    } catch (error: any) {
      Logger.error('Erro ao remover conexão:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erro interno do servidor'
      });
    }
  }

  async getQRCode(req: Request, res: Response) {
    try {
      const { connectionId } = req.params;
      const qrBuffer = await this.whatsappService.getQRCodeImage(connectionId);

      if (!qrBuffer) {
        return res.status(404).json({
          success: false,
          message: 'QR Code não encontrado'
        });
      }

      res.setHeader('Content-Type', 'image/png');
      res.send(qrBuffer);
    } catch (error: any) {
      Logger.error('Erro ao obter QR Code:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erro interno do servidor'
      });
    }
  }

  async sendMessage(req: Request, res: Response) {
    try {
      const { connectionId, to, message } = req.body;

      if (!connectionId || !to || !message) {
        return res.status(400).json({
          success: false,
          message: 'connectionId, to e message são obrigatórios'
        });
      }

      await this.whatsappService.sendTextMessage(connectionId, to, message);

      res.json({
        success: true,
        message: 'Mensagem enviada com sucesso'
      });
    } catch (error: any) {
      Logger.error('Erro ao enviar mensagem:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erro interno do servidor'
      });
    }
  }

  async sendMedia(req: Request, res: Response) {
    try {
      const { connectionId, to, type, caption, media } = req.body;

      if (!connectionId || !to || !type || !media) {
        return res.status(400).json({
          success: false,
          message: 'connectionId, to, type, caption e link do arquivo são obrigatórios'
        });
      }

      await this.whatsappService.sendMediaMessage(
        connectionId,
        to,
        type,
        caption,
        media
      );

      res.json({
        success: true,
        message: 'Mídia enviada com sucesso'
      });
    } catch (error: any) {
      Logger.error('Erro ao enviar mídia:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erro interno do servidor'
      });
    }
  }

  async sendMediaBase64(req: Request, res: Response) {
    try {
      const { connectionId, to, type, caption, base64 } = req.body;
  
      if (!connectionId || !to || !type || !base64) {
        return res.status(400).json({
          success: false,
          message: 'connectionId, to, type e media (base64) são obrigatórios'
        });
      }
  
      await this.whatsappService.sendMediaMessageBase64(
        connectionId,
        to,
        type,
        caption,
        base64
      );
  
      res.json({
        success: true,
        message: 'Mídia (base64) enviada com sucesso'
      });
    } catch (error: any) {
      Logger.error('Erro ao enviar mídia base64:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erro interno do servidor'
      });
    }
  }
}