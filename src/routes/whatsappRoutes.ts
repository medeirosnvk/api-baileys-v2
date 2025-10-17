import { Router } from "express";
import multer from "multer";
import { WhatsAppController } from "../controllers/whatsappControllers.js";
import { WhatsAppService } from "../services/whatsappServices.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Instanciar serviços e controllers
const whatsappService = new WhatsAppService();
const whatsappController = new WhatsAppController(whatsappService);

// Rotas
router.post(
  "/instance/create",
  whatsappController.createConnection.bind(whatsappController)
);

router.get(
  "/instance/fetchInstances",
  whatsappController.getConnections.bind(whatsappController)
);

router.get(
  "/instance/connectionState/:instanceName",
  whatsappController.getConnectionStatus.bind(whatsappController)
);

router.delete(
  "/instance/logout/:instanceName",
  whatsappController.removeConnection.bind(whatsappController)
);

router.get(
  "/instance/connect/image/:instanceName",
  whatsappController.getQRCode.bind(whatsappController)
);

router.get(
  "/instance/connect/:instanceName",
  whatsappController.getQRCodeBase64.bind(whatsappController)
);

router.post(
  "/message/sendText/:instanceName",
  whatsappController.sendMessage.bind(whatsappController)
);

router.post(
  "/message/sendMedia/:instanceName",
  whatsappController.sendMedia.bind(whatsappController)
);

router.post(
  "/message/sendBase64/:instanceName",
  whatsappController.sendMediaBase64.bind(whatsappController)
);

router.get(
  "/chat/whatsappNumbers/:instanceName",
  whatsappController.checkWhatsappNumber.bind(whatsappController)
);

export default router;
