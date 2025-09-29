import { Router } from 'express';
import multer from 'multer';
import { WhatsAppController } from '../controllers/whatsappControllers';
import { WhatsAppService } from '../services/whatsappServices';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Instanciar serviços e controllers
const whatsappService = new WhatsAppService();
const whatsappController = new WhatsAppController(whatsappService);

// Rotas
router.post('/create/:connectionId', whatsappController.createConnection.bind(whatsappController));
router.get('/connections', whatsappController.getConnections.bind(whatsappController));
router.get('/connections/status/:connectionId', whatsappController.getConnectionStatus.bind(whatsappController));
router.delete('/connection/delete/:connectionId', whatsappController.removeConnection.bind(whatsappController));
router.get('/connections/qrcode/:connectionId', whatsappController.getQRCode.bind(whatsappController));
router.post('/send/text', whatsappController.sendMessage.bind(whatsappController));
router.post('/send/media', whatsappController.sendMedia.bind(whatsappController));
router.post('/send/base64', whatsappController.sendMediaBase64.bind(whatsappController));


export default router;