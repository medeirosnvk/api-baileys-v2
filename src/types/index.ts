export interface ConnectionStatus {
  id: string;
  status:
    | "connecting"
    | "connected"
    | "reconnecting"
    | "disconnected"
    | "forbidden"
    | "loggedOut"
    | "banned"
    | "closed"
    | "timeout"
    | "error";
  qrCode?: string;
  connectionTimeout?: NodeJS.Timeout;
  phoneNumber: string | null;
  createdAt?: Date;
  error?: string;
}

export interface SendMessageRequest {
  connectionId: string;
  to: string;
  message: string;
  type?: "text";
}

export interface SendMediaRequest {
  connectionId: string;
  to: string;
  caption?: string;
  type: "image" | "document" | "video" | "audio";
}
