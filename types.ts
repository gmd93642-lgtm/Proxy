export enum RoxyState {
  DISCONNECTED = 'DISCONNECTED',
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
  PROCESSING = 'PROCESSING',
  SPEAKING = 'SPEAKING',
}

export interface MemoryLog {
  id: string;
  role: 'user' | 'roxy';
  text: string; // Transcribed text
  timestamp: number;
}

export interface AudioVisuals {
  inputVolume: number; // 0-1
  outputVolume: number; // 0-1
}

export interface PermissionRequest {
  type: 'audio' | 'video';
  onConfirm: () => void;
  onCancel: () => void;
}

export interface RoxyContextType {
  state: RoxyState;
  connect: () => Promise<void>;
  disconnect: () => void;
  visuals: AudioVisuals;
  memory: MemoryLog[];
  toggleMic: () => void;
  isMicMuted: boolean;
  error: string | null;
  sendTextMessage: (text: string) => Promise<void>;
  sendImage: (base64: string, mimeType: string) => void;
  // Vision
  isCameraActive: boolean;
  toggleCamera: () => void;
  videoStream: MediaStream | null;
  videoResolution: 'SD' | 'HD';
  toggleResolution: () => void;
  // Permissions
  permissionRequest: PermissionRequest | null;
  // Feedback
  activeSystemAction: string | null;
  // Settings
  setApiKey: (key: string) => void;
  hasApiKey: boolean;
}