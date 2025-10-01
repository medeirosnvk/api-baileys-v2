export interface ConnectionStatus {
  id: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'forbidden' | 'error' | 'loggedOut';
  qrCode?: string;
  connectionTimeout?: NodeJS.Timeout;
  phoneNumber?: string;
  lastSeen?: Date;
  error?: string;
}

export interface SendMessageRequest {
  connectionId: string;
  to: string;
  message: string;
  type?: 'text';
}

export interface SendMediaRequest {
  connectionId: string;
  to: string;
  caption?: string;
  type: 'image' | 'document' | 'video' | 'audio';
}