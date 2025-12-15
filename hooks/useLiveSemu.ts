import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { RoxyState, MemoryLog, AudioVisuals } from '../types';
import { ROXY_SYSTEM_INSTRUCTION, MODEL_NAME, SAMPLE_RATE_INPUT, SAMPLE_RATE_OUTPUT } from '../constants';
import { createPcmBlob, decodeBase64, pcmToAudioBuffer, calculateRMS } from '../utils/audioUtils';

// Define the system control tools
const systemTools: FunctionDeclaration[] = [
  {
    name: "executeSystemCommand",
    description: "Executes a system-level command on the Android device (Apps, Hardware, Settings).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: "The action to perform: 'OPEN_APP', 'TOGGLE_WIFI', 'TOGGLE_BLUETOOTH', 'TOGGLE_FLASHLIGHT', 'SET_VOLUME', 'GET_BATTERY_STATUS'."
        },
        target: {
          type: Type.STRING,
          description: "The target app name or setting parameter (e.g., 'YouTube', 'Spotify', 'Instagram', 'ON', 'OFF')."
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
  const [state, setState] = useState<RoxyState>(RoxyState.DISCONNECTED);
  const [memory, setMemory] = useState<MemoryLog[]>([]);
  const [visuals, setVisuals] = useState<AudioVisuals>({ inputVolume: 0, outputVolume: 0 });
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Vision State
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [videoResolution, setVideoResolution] = useState<'SD' | 'HD'>('SD');
  
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

  const connect = useCallback(async () => {
    try {
      if (!process.env.API_KEY) {
        throw new Error("API Key not found in environment.");
      }

      setError(null);
      setState(RoxyState.IDLE);

      // Initialize Audio Contexts
      inputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE_INPUT });
      outputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE_OUTPUT });
      
      // CRITICAL: Resume contexts to bypass autoplay policies in WebViews/APKs
      await inputContextRef.current.resume();
      await outputContextRef.current.resume();
      
      // Output Setup
      outputGainRef.current = outputContextRef.current.createGain();
      outputGainRef.current.connect(outputContextRef.current.destination);

      // Microphone Setup
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const config = {
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: ROXY_SYSTEM_INSTRUCTION,
          // Add codeExecution tool for Python snippets
          // Add functionDeclarations for system control
          tools: [
              { functionDeclarations: systemTools },
              { codeExecution: {} } 
          ],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }, 
          },
        },
      };

      const callbacks = {
        onopen: () => {
          console.log("ROXY Connected");
          setState(RoxyState.IDLE);
          startAudioInput();
        },
        onmessage: async (message: LiveServerMessage) => {
          handleServerMessage(message);
        },
        onclose: () => {
          console.log("ROXY Disconnected");
          setState(RoxyState.DISCONNECTED);
          stopVideoInput(); // Stop camera if disconnected
        },
        onerror: (err: any) => {
          console.error("ROXY Error", err);
          setError("Connection lost. Tap to reconnect.");
          disconnect();
        }
      };

      // Connect to Gemini Live
      sessionPromiseRef.current = ai.live.connect({ ...config, callbacks });

    } catch (err: any) {
      console.error("Connection failed", err);
      setError(err.message || "Failed to initialize ROXY");
      setState(RoxyState.DISCONNECTED);
    }
  }, []); 

  const startAudioInput = () => {
    if (!inputContextRef.current || !streamRef.current) return;

    inputSourceRef.current = inputContextRef.current.createMediaStreamSource(streamRef.current);
    processorRef.current = inputContextRef.current.createScriptProcessor(4096, 1, 1);

    processorRef.current.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      
      // Visualization update
      const rms = calculateRMS(inputData);
      setVisuals(prev => ({ ...prev, inputVolume: rms }));

      // State update logic based on volume (simple VAD simulation)
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

  // --- VISION LOGIC ---
  const toggleCamera = useCallback(async () => {
    if (isCameraActive) {
      stopVideoInput();
    } else {
      await startVideoInput();
    }
  }, [isCameraActive, videoResolution]); // Added videoResolution dep

  // Updated startVideoInput to take optional constraints or use state
  const startVideoInput = async (forcedMode?: 'SD' | 'HD') => {
    const mode = forcedMode || videoResolution;
    const constraints = mode === 'HD' 
        ? { width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: { ideal: 640 }, height: { ideal: 480 } };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          ...constraints,
          facingMode: "environment" // Use back camera if available
        } 
      });
      setVideoStream(stream);
      setIsCameraActive(true);

      // Setup internal video element for frame capture
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

      // Start capture loop (1 FPS)
      // Clear existing interval if any to avoid duplicates on restart
      if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);
      
      videoIntervalRef.current = window.setInterval(() => {
        captureAndSendFrame();
      }, 1000); 

    } catch (e) {
      console.error("Camera access failed", e);
      setError("Camera access denied.");
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
          // Restart stream with new mode
          stopVideoInput();
          // Slight delay to ensure tracks release
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
    
    // Get Base64 JPEG
    const base64Data = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
    
    sessionPromiseRef.current.then(session => {
       session.sendRealtimeInput({
          media: {
             mimeType: 'image/jpeg',
             data: base64Data
          }
       });
    });
  };

  const sendImage = useCallback((base64: string, mimeType: string) => {
    if (!sessionPromiseRef.current) return;
    sessionPromiseRef.current.then(session => {
       session.sendRealtimeInput({
          media: {
             mimeType: mimeType,
             data: base64
          }
       });
       setMemory(prev => [...prev, {
          id: Date.now().toString() + '-img',
          role: 'user',
          text: '[Sent an image from Gallery]',
          timestamp: Date.now()
       }]);
    });
  }, []);
  // --------------------

  const handleServerMessage = async (message: LiveServerMessage) => {
    const { serverContent, toolCall } = message;

    if (toolCall) {
      const responses = toolCall.functionCalls.map(fc => {
        let result = "SUCCESS";
        let logText = "";
        
        if (fc.name === "executeSystemCommand") {
           const action = fc.args['action'] as string;
           const target = fc.args['target'] as string;
           console.log(`[ROXY SYSTEM] ${action} -> ${target}`);
           logText = `⚡ [SYSTEM] ${action} ${target || ''}`;
        }
        else if (fc.name === "playMedia") {
            const platform = (fc.args['platform'] as string) || 'YouTube';
            const query = fc.args['query'] as string;
            console.log(`[ROXY MEDIA] Playing ${query} on ${platform}`);
            logText = `🎵 Playing: "${query}" on ${platform}`;
        } 
        else if (fc.name === "sendCommunication") {
           const method = fc.args['method'] as string;
           const recipient = fc.args['recipient'] as string;
           const content = fc.args['content'] as string;
           
           if (method === 'WHATSAPP_MESSAGE') logText = `📱 WhatsApp to ${recipient}: "${content || ''}"`;
           else if (method === 'PHONE_CALL') logText = `📞 Calling ${recipient}...`;
           else if (method === 'SEND_EMAIL') logText = `📧 Email to ${recipient}`;
           else if (method === 'SEND_SMS') logText = `💬 SMS to ${recipient}: "${content || ''}"`;
           else if (method === 'SEND_MMS') logText = `🖼️ MMS to ${recipient}: "${content || ''}"`;
        }
        else if (fc.name === "getInstalledApps") {
            // SIMULATION: In a real Android WebView, this would bridge to native Java/Kotlin
            result = JSON.stringify([
                "WhatsApp", "Instagram", "Spotify", "YouTube", "Gmail", 
                "Google Photos", "Camera", "Maps", "Chrome", "Settings"
            ]);
            logText = "📂 [SYSTEM] Scanning installed apps...";
        }

        if (logText) {
            setMemory(prev => [...prev, {
                id: Date.now().toString() + '-sys',
                role: 'roxy',
                text: logText,
                timestamp: Date.now()
            }]);
        }
        
        return {
          id: fc.id,
          name: fc.name,
          response: { result: result }
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
          id: Date.now().toString() + '-user',
          role: 'user',
          text: currentInputTranscription.current,
          timestamp: Date.now()
        }]);
      }
      if (currentOutputTranscription.current.trim()) {
        setMemory(prev => [...prev, {
          id: Date.now().toString() + '-roxy',
          role: 'roxy',
          text: currentOutputTranscription.current,
          timestamp: Date.now()
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
    const userLog: MemoryLog = { id: Date.now().toString(), role: 'user', text, timestamp: Date.now() };
    setMemory(prev => [...prev, userLog]);
    
    try {
        if (!process.env.API_KEY) return;
        // Re-construct logic for chat mode if needed, but for now we focus on Live API
        // This is a fallback/legacy function from the chat interface
    } catch (e) {
        // ...
    }
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
    toggleResolution
  };
};