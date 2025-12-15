import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { RoxyState, MemoryLog, AudioVisuals, PermissionRequest } from '../types';
import { ROXY_SYSTEM_INSTRUCTION, MODEL_NAME, SAMPLE_RATE_INPUT, SAMPLE_RATE_OUTPUT } from '../constants';
import { createPcmBlob, decodeBase64, pcmToAudioBuffer, calculateRMS } from '../utils/audioUtils';

// Define the system control tools
const systemTools: FunctionDeclaration[] = [
  {
    name: "executeSystemCommand",
    description: "Executes a system-level command on the Android device.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "The action to perform. Options: 'OPEN_APP', 'OPEN_APP_SCREEN', 'TOGGLE_WIFI', 'TOGGLE_BLUETOOTH', 'TOGGLE_FLASHLIGHT', 'SET_BRIGHTNESS', 'SET_VOLUME', 'GET_BATTERY_STATUS'."
        },
        target: {
          type: Type.STRING,
          description: "Details for the action. For 'OPEN_APP_SCREEN', use 'Instagram Reels', 'Spotify Search', etc. For 'SET_BRIGHTNESS', use '50%'. For Toggle, use 'ON'/'OFF'."
        }
      },
      required: ["action"]
    }
  },
  {
    name: "playMedia",
    description: "Plays music, songs, or videos on a specified platform. Use this for all 'Play X' commands.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        platform: {
          type: Type.STRING,
          description: "The app to use. Defaults to 'YouTube' if not specified. Options: 'YouTube', 'Spotify', 'YouTube Music'."
        },
        query: {
          type: Type.STRING,
          description: "The song name, artist name (e.g., 'MC Stan'), or video title to search and play."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "sendCommunication",
    description: "Handles communication actions. Triggers intent for WhatsApp, Phone Calls, SMS, MMS, or Emails.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        method: {
          type: Type.STRING,
          description: "The communication method. MUST be one of: 'PHONE_CALL', 'WHATSAPP_MESSAGE', 'SEND_EMAIL', 'SEND_SMS', 'SEND_MMS'."
        },
        recipient: {
          type: Type.STRING,
          description: "Name, phone number, or email address of the recipient."
        },
        content: {
          type: Type.STRING,
          description: "The content/body of the message or email. (Optional for PHONE_CALL)."
        }
      },
      required: ["method", "recipient"]
    }
  },
  {
    name: "getInstalledApps",
    description: "Returns a list of all applications installed on the user's device.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    }
  }
];

export const useLiveRoxy = () => {
  // Try to get key from Local Storage first, then environment variable
  const [apiKey, setApiKeyState] = useState<string>(() => {
    return localStorage.getItem('ROXY_API_KEY') || process.env.API_KEY || '';
  });

  const [state, setState] = useState<RoxyState>(RoxyState.DISCONNECTED);
  const [memory, setMemory] = useState<MemoryLog[]>([]);
  const [visuals, setVisuals] = useState<AudioVisuals>({ inputVolume: 0, outputVolume: 0 });
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Permission State
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);

  // Vision State
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [videoResolution, setVideoResolution] = useState<'SD' | 'HD'>('SD');
  
  // Feedback State
  const [activeSystemAction, setActiveSystemAction] = useState<string | null>(null);
  
  const videoIntervalRef = useRef<number | null>(null);
  const internalVideoRef = useRef<HTMLVideoElement | null>(null);
  const internalCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Audio Contexts & Nodes
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Gemini Session
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  
  // Transcription Buffers
  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');

  // Update API Key helper
  const setApiKey = useCallback((key: string) => {
    localStorage.setItem('ROXY_API_KEY', key);
    setApiKeyState(key);
    // Clear error if it was key related
    setError(null);
  }, []);

  // Permission Request Helper
  const requestPermissionUI = (type: 'audio' | 'video' | 'overlay'): Promise<boolean> => {
      return new Promise((resolve) => {
          setPermissionRequest({
              type,
              onConfirm: () => {
                  setPermissionRequest(null);
                  resolve(true);
              },
              onCancel: () => {
                  setPermissionRequest(null);
                  resolve(false);
              }
          });
      });
  };

  const checkAndRequestPermissions = async (): Promise<boolean> => {
      // 1. Microphone (Essential)
      try {
          // Attempt to get stream immediately to trigger browser prompt
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(t => t.stop()); // Release immediately
      } catch (e) {
          // If failed, show UI prompt then try again
          const confirmed = await requestPermissionUI('audio');
          if (!confirmed) return false;
          try {
             const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
             stream.getTracks().forEach(t => t.stop());
          } catch(e2) {
             setError("Microphone permission denied.");
             return false;
          }
      }

      // 2. Camera (Asked upfront to ensure seamless vision toggle later)
      // Note: If you prefer asking only when toggling vision, remove this block.
      // Keeping it here satisfies "ask all permission" request.
      try {
          // Check if we already have permission without prompting (if persisted)
          // We can't really check "query" reliably across all browsers/webviews, so we try getUserMedia
          // If it fails or prompts, we want our UI first.
          
          // Strategy: Show our UI first for camera if not granted before
          if (!localStorage.getItem('ROXY_CAM_GRANTED')) {
             const confirmed = await requestPermissionUI('video');
             if (confirmed) {
                 try {
                    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                    stream.getTracks().forEach(t => t.stop());
                    localStorage.setItem('ROXY_CAM_GRANTED', 'true');
                 } catch (e) {
                    // Ignore, maybe user cancelled browser prompt
                 }
             }
          }
      } catch (e) {
          // Ignore
      }

      // 3. Overlay (Simulation for "Display over other apps")
      if (!localStorage.getItem('ROXY_OVERLAY_GRANTED')) {
          const confirmed = await requestPermissionUI('overlay');
          if (confirmed) {
              localStorage.setItem('ROXY_OVERLAY_GRANTED', 'true');
          }
      }

      return true;
  };
  
  // New Soft Chime Sound
  const playSystemSound = useCallback(() => {
    if (!outputContextRef.current) return;
    const ctx = outputContextRef.current;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.exponentialRampToValueAtTime(523.25, now + 0.1);

    osc.connect(gain);
    gain.connect(ctx.destination);
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

    osc.start(now);
    osc.stop(now + 0.8);
  }, []);

  const connect = useCallback(async () => {
    try {
      if (!apiKey) {
        setError("API Key missing. Please configure it in settings.");
        return;
      }

      // Perform the robust permission sequence
      const permissionsGranted = await checkAndRequestPermissions();
      if (!permissionsGranted) return;

      setError(null);
      setState(RoxyState.IDLE);

      inputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE_INPUT });
      outputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE_OUTPUT });
      
      await inputContextRef.current.resume();
      await outputContextRef.current.resume();
      
      outputGainRef.current = outputContextRef.current.createGain();
      outputGainRef.current.connect(outputContextRef.current.destination);

      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const ai = new GoogleGenAI({ apiKey: apiKey });
      
      const config = {
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: ROXY_SYSTEM_INSTRUCTION,
          tools: [
              { functionDeclarations: systemTools },
              { codeExecution: {} } 
          ],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } }, 
          },
        },
      };

      const callbacks = {
        onopen: () => {
          console.log("ROXY Connected");
          setState(RoxyState.IDLE);
          startAudioInput();
          playSystemSound(); // Gentle startup chime
        },
        onmessage: async (message: LiveServerMessage) => {
          handleServerMessage(message);
        },
        onclose: () => {
          console.log("ROXY Disconnected");
          setState(RoxyState.DISCONNECTED);
          stopVideoInput();
        },
        onerror: (err: any) => {
          console.error("ROXY Error", err);
          if (err.message?.includes('401') || err.message?.includes('key')) {
             setError("Invalid API Key. Please update in settings.");
             disconnect();
          } else {
             setError("Connection unstable.");
             disconnect();
          }
        }
      };

      sessionPromiseRef.current = ai.live.connect({ ...config, callbacks });

    } catch (err: any) {
      console.error("Connection failed", err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
         setError("Microphone access needed for voice commands.");
      } else {
         setError(err.message || "Failed to start ROXY.");
      }
      setState(RoxyState.DISCONNECTED);
    }
  }, [apiKey]); 

  const startAudioInput = () => {
    if (!inputContextRef.current || !streamRef.current) return;

    inputSourceRef.current = inputContextRef.current.createMediaStreamSource(streamRef.current);
    processorRef.current = inputContextRef.current.createScriptProcessor(4096, 1, 1);

    processorRef.current.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      const rms = calculateRMS(inputData);
      setVisuals(prev => ({ ...prev, inputVolume: rms }));

      if (rms > 0.01 && !isMicMuted) {
         setState(prev => prev === RoxyState.SPEAKING ? RoxyState.SPEAKING : RoxyState.LISTENING);
      } else if (rms < 0.01 && !isMicMuted) {
         setState(prev => prev === RoxyState.LISTENING ? RoxyState.IDLE : prev);
      }

      if (isMicMuted) return;

      const pcmBlob = createPcmBlob(inputData);
      sessionPromiseRef.current?.then(session => {
        session.sendRealtimeInput({ media: pcmBlob });
      });
    };

    inputSourceRef.current.connect(processorRef.current);
    processorRef.current.connect(inputContextRef.current.destination);
  };

  const toggleCamera = useCallback(async () => {
    if (isCameraActive) {
      stopVideoInput();
    } else {
      try {
         await startVideoInput();
      } catch (e) {
         setError("Camera unavailable");
      }
    }
  }, [isCameraActive, videoResolution]);

  const startVideoInput = async (forcedMode?: 'SD' | 'HD') => {
    const mode = forcedMode || videoResolution;
    const constraints = mode === 'HD' 
        ? { width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: { ideal: 640 }, height: { ideal: 480 } };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { ...constraints, facingMode: "environment" } 
      });
      setVideoStream(stream);
      setIsCameraActive(true);

      if (!internalVideoRef.current) {
         internalVideoRef.current = document.createElement('video');
         internalVideoRef.current.muted = true;
         internalVideoRef.current.playsInline = true;
      }
      internalVideoRef.current.srcObject = stream;
      await internalVideoRef.current.play();

      if (!internalCanvasRef.current) {
        internalCanvasRef.current = document.createElement('canvas');
      }

      if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = window.setInterval(captureAndSendFrame, 1000); 
    } catch (e: any) {
      console.error("Camera access failed", e);
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        setError("Camera permission denied.");
      } else {
        setError("Camera unavailable.");
      }
    }
  };

  const stopVideoInput = () => {
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }
    if (internalVideoRef.current) {
       internalVideoRef.current.pause();
       internalVideoRef.current.srcObject = null;
    }
    if (videoStream) {
      videoStream.getTracks().forEach(t => t.stop());
      setVideoStream(null);
    }
    setIsCameraActive(false);
  };
  
  const toggleResolution = useCallback(async () => {
      const newMode = videoResolution === 'SD' ? 'HD' : 'SD';
      setVideoResolution(newMode);
      if (isCameraActive) {
          stopVideoInput();
          setTimeout(() => startVideoInput(newMode), 100);
      }
  }, [videoResolution, isCameraActive]);

  const captureAndSendFrame = () => {
    const video = internalVideoRef.current;
    const canvas = internalCanvasRef.current;
    if (!video || !canvas || !sessionPromiseRef.current) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64Data = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
    sessionPromiseRef.current.then(session => {
       session.sendRealtimeInput({ media: { mimeType: 'image/jpeg', data: base64Data } });
    });
  };

  const sendImage = useCallback((base64: string, mimeType: string) => {
    if (!sessionPromiseRef.current) return;
    sessionPromiseRef.current.then(session => {
       session.sendRealtimeInput({ media: { mimeType: mimeType, data: base64 } });
       setMemory(prev => [...prev, {
          id: Date.now().toString() + '-img', role: 'user', text: '[Shared Image]', timestamp: Date.now()
       }]);
    });
  }, []);

  const handleServerMessage = async (message: LiveServerMessage) => {
    const { serverContent, toolCall } = message;

    if (toolCall) {
      const responses = toolCall.functionCalls.map(fc => {
        let result = "SUCCESS";
        let logText = "";
        
        if (fc.name === "executeSystemCommand") {
           const action = fc.args['action'] as string;
           const target = (fc.args['target'] as string || '').toLowerCase();
           
           if (action === 'OPEN_APP') {
              if (target.includes('youtube')) window.open('https://youtube.com', '_blank');
              else if (target.includes('instagram')) window.open('https://instagram.com', '_blank');
              else if (target.includes('spotify')) window.open('https://open.spotify.com', '_blank');
              else if (target.includes('whatsapp')) window.open('https://wa.me/', '_blank');
              else if (target.includes('gmail')) window.open('https://mail.google.com', '_blank');
              logText = `Opening ${target}`;
           } 
           // --- EXPANDED COMMANDS ---
           else if (action === 'OPEN_APP_SCREEN') {
               logText = `Opening ${target}...`; 
               if (target.includes('reels')) window.open('https://www.instagram.com/reels/', '_blank');
               else if (target.includes('shorts')) window.open('https://www.youtube.com/shorts/', '_blank');
           }
           else if (action === 'TOGGLE_BLUETOOTH') {
               logText = `Turning Bluetooth ${target}...`; 
           }
           else if (action === 'SET_BRIGHTNESS') {
               logText = `Setting Brightness to ${target}...`; 
           }
           else {
              logText = `System: ${action} ${target || ''}`;
           }
        }
        else if (fc.name === "playMedia") {
            const platform = (fc.args['platform'] as string) || 'YouTube';
            const query = fc.args['query'] as string;
            if (platform.toLowerCase().includes('spotify')) {
               window.open(`https://open.spotify.com/search/${encodeURIComponent(query)}`, '_blank');
            } else {
               window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, '_blank');
            }
            logText = `Playing ${query}`;
        } 
        else if (fc.name === "sendCommunication") {
           const method = fc.args['method'] as string;
           const recipient = fc.args['recipient'] as string;
           if (method === 'WHATSAPP_MESSAGE') {
             window.open(`https://wa.me/${recipient.replace(/\D/g, '')}`, '_blank');
             logText = `Messaging ${recipient}`;
           } else {
             logText = `${method} to ${recipient}`;
           }
        }
        else if (fc.name === "getInstalledApps") {
            result = JSON.stringify(["WhatsApp", "Instagram", "Spotify", "YouTube", "Gmail", "Maps"]);
            logText = "Checking apps...";
        }

        if (logText) {
            playSystemSound();
            setActiveSystemAction(logText); 
            setTimeout(() => setActiveSystemAction(null), 3000);

            setMemory(prev => [...prev, {
                id: Date.now().toString() + '-sys', role: 'roxy', text: logText, timestamp: Date.now()
            }]);
        }
        
        return {
          id: fc.id, name: fc.name, response: { result: result }
        };
      });

      sessionPromiseRef.current?.then(session => {
        session.sendToolResponse({ functionResponses: responses });
      });
    }

    if (serverContent?.inputTranscription) {
       currentInputTranscription.current += serverContent.inputTranscription.text;
    }
    if (serverContent?.outputTranscription) {
      currentOutputTranscription.current += serverContent.outputTranscription.text;
    }

    if (serverContent?.turnComplete) {
      if (currentInputTranscription.current.trim()) {
        setMemory(prev => [...prev, {
          id: Date.now().toString() + '-user', role: 'user', text: currentInputTranscription.current, timestamp: Date.now()
        }]);
      }
      if (currentOutputTranscription.current.trim()) {
        setMemory(prev => [...prev, {
          id: Date.now().toString() + '-roxy', role: 'roxy', text: currentOutputTranscription.current, timestamp: Date.now()
        }]);
      }
      currentInputTranscription.current = '';
      currentOutputTranscription.current = '';
      setState(RoxyState.IDLE);
    }

    const audioData = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioData) {
      setState(RoxyState.SPEAKING);
      playAudioChunk(audioData);
    }

    if (serverContent?.interrupted) {
      nextStartTimeRef.current = outputContextRef.current?.currentTime || 0;
      setState(RoxyState.IDLE);
    }
  };

  const sendTextMessage = async (text: string) => {
    // Legacy chat support if needed
  };

  const playAudioChunk = async (base64Audio: string) => {
    if (!outputContextRef.current || !outputGainRef.current) return;
    const audioBytes = decodeBase64(base64Audio);
    const audioBuffer = pcmToAudioBuffer(audioBytes, outputContextRef.current, SAMPLE_RATE_OUTPUT);
    const now = outputContextRef.current.currentTime;
    const startTime = Math.max(now, nextStartTimeRef.current);
    const source = outputContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outputGainRef.current);
    source.start(startTime);
    nextStartTimeRef.current = startTime + audioBuffer.duration;
  };

  const disconnect = useCallback(() => {
    if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
    if (inputSourceRef.current) { inputSourceRef.current.disconnect(); inputSourceRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (inputContextRef.current) { inputContextRef.current.close(); inputContextRef.current = null; }
    if (outputContextRef.current) { outputContextRef.current.close(); outputContextRef.current = null; }
    stopVideoInput();
    setState(RoxyState.DISCONNECTED);
  }, []);

  const toggleMic = useCallback(() => {
    setIsMicMuted(prev => !prev);
  }, []);

  useEffect(() => {
    return () => { disconnect(); };
  }, [disconnect]);

  return {
    state,
    connect,
    disconnect,
    visuals,
    memory,
    toggleMic,
    isMicMuted,
    error,
    sendTextMessage,
    sendImage,
    isCameraActive,
    toggleCamera,
    videoStream,
    videoResolution,
    toggleResolution,
    permissionRequest,
    activeSystemAction,
    setApiKey,
    hasApiKey: !!apiKey
  };
};