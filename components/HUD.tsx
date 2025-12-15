import React, { useState, useEffect, useRef } from 'react';
import { RoxyState, MemoryLog, PermissionRequest } from '../types';
import { FaMicrophone, FaMicrophoneSlash, FaPowerOff, FaCamera, FaChevronDown, FaCog, FaKey } from 'react-icons/fa';
import { FiSun, FiMoon, FiBattery, FiWifi, FiMaximize, FiMinimize } from 'react-icons/fi';
import { BiSad, BiHappy } from 'react-icons/bi';
import { TbFaceId } from "react-icons/tb";
import Orb from './Orb';

interface HUDProps {
  state: RoxyState;
  memory: MemoryLog[];
  onToggleMic: () => void;
  isMicMuted: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  error: string | null;
  visuals: { inputVolume: number };
  toggleCamera: () => void;
  isCameraActive: boolean;
  videoStream: MediaStream | null;
  sendTextMessage: (text: string) => Promise<void>;
  permissionRequest: PermissionRequest | null;
  activeSystemAction: string | null;
  setApiKey?: (key: string) => void;
  hasApiKey?: boolean;
}

// Confirmation Dialog Component
const ConfirmDialog = ({ 
    isOpen, 
    title, 
    message, 
    onConfirm, 
    onCancel 
}: { 
    isOpen: boolean; title: string; message: string; onConfirm: () => void; onCancel: () => void 
}) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="glass-card p-6 w-80 shadow-2xl transform scale-100 transition-all">
                <h3 className="text-lg font-sans font-semibold text-white mb-2">{title}</h3>
                <p className="text-slate-400 text-sm mb-6 leading-relaxed">{message}</p>
                <div className="flex gap-3">
                    <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-white/5 text-slate-300 hover:bg-white/10 transition-colors text-sm font-medium">Cancel</button>
                    <button onClick={onConfirm} className="flex-1 py-3 rounded-xl bg-primary-500 text-white hover:bg-primary-400 transition-colors text-sm font-medium shadow-lg shadow-primary-500/20">Confirm</button>
                </div>
            </div>
        </div>
    );
};

// Key Input Dialog
const KeyDialog = ({
    isOpen,
    onClose,
    onSave
}: {
    isOpen: boolean; onClose: () => void; onSave: (key: string) => void;
}) => {
    const [key, setKey] = useState('');
    
    if (!isOpen) return null;
    
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-fade-in">
             <div className="glass-card p-6 w-[90%] max-w-sm shadow-2xl">
                 <div className="flex items-center gap-3 mb-4 text-white">
                     <FaKey className="text-primary-400" />
                     <h3 className="text-lg font-sans font-semibold">API Configuration</h3>
                 </div>
                 <p className="text-slate-400 text-sm mb-4">
                     Please enter your Gemini API Key to activate ROXY OS system functions.
                 </p>
                 <input 
                    type="password" 
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full bg-slate-900/50 border border-white/10 rounded-xl p-3 text-white text-sm mb-6 focus:outline-none focus:border-primary-500 transition-colors font-mono"
                 />
                 <div className="flex gap-3">
                     <button onClick={onClose} className="py-3 px-4 rounded-xl bg-white/5 text-slate-300 hover:bg-white/10 text-sm font-medium">Cancel</button>
                     <button onClick={() => { onSave(key); onClose(); }} className="flex-1 py-3 rounded-xl bg-primary-500 text-white hover:bg-primary-400 transition-colors text-sm font-medium">Save Access Key</button>
                 </div>
             </div>
        </div>
    );
};

// Simple Widget Component
const Widget = ({ icon: Icon, label, value, subLabel }: { icon: any, label: string, value: string, subLabel?: string }) => (
    <div className="glass p-4 rounded-2xl flex items-center gap-4 transition-transform hover:scale-[1.02]">
        <div className="p-3 rounded-full bg-white/5 text-primary-400">
            <Icon size={20} />
        </div>
        <div>
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">{label}</div>
            <div className="text-lg font-sans font-semibold text-slate-100">{value}</div>
            {subLabel && <div className="text-xs text-slate-500">{subLabel}</div>}
        </div>
    </div>
);

export const HUD: React.FC<HUDProps> = ({ 
  state, 
  memory, 
  onToggleMic, 
  isMicMuted, 
  onConnect, 
  onDisconnect,
  error,
  visuals,
  toggleCamera,
  isCameraActive,
  videoStream,
  permissionRequest,
  activeSystemAction,
  setApiKey,
  hasApiKey
}) => {
  const [time, setTime] = useState(new Date());
  const [zenMode, setZenMode] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'disconnect' | 'camera' | null>(null);
  const [showKeyModal, setShowKeyModal] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const roxyLogs = memory.filter(m => m.role === 'roxy');
  const latestLog = roxyLogs.length > 0 ? roxyLogs[roxyLogs.length - 1].text : '';

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // If there is an API Key error, show the modal
    if (error && (error.includes('API Key') || error.includes('missing'))) {
        setShowKeyModal(true);
    }
  }, [error]);

  useEffect(() => {
    if (videoRef.current && videoStream) {
      videoRef.current.srcObject = videoStream;
    }
  }, [videoStream]);

  // Handlers for confirmation
  const handleDisconnectRequest = () => setConfirmAction('disconnect');
  const handleCameraRequest = () => {
      if (isCameraActive) {
        setConfirmAction('camera'); 
      } else {
        toggleCamera(); 
      }
  };

  const executeConfirm = () => {
      if (confirmAction === 'disconnect') onDisconnect();
      if (confirmAction === 'camera') toggleCamera();
      setConfirmAction(null);
  };

  return (
    <div className="relative z-10 w-full h-full flex flex-col justify-between p-6 overflow-hidden transition-all duration-700">
      
      {/* --- TOP BAR --- */}
      <div className={`flex justify-between items-start transition-opacity duration-500 ${zenMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <div>
           <div className="flex items-center gap-2 mb-1">
               <span className="text-xs font-bold text-primary-400 tracking-widest uppercase">ROXY OS</span>
               <div className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_8px_#4ade80]"></div>
           </div>
           <h1 className="text-4xl font-sans font-light text-white tracking-tight">
             {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
           </h1>
           <p className="text-slate-400 text-sm font-medium">
             {time.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
           </p>
        </div>
        
        <div className="flex gap-4">
             {/* Zen Mode Toggle */}
             <button 
                onClick={() => setZenMode(!zenMode)}
                className="glass p-2 rounded-full text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
             >
                <FiMaximize />
             </button>

             {/* Settings / API Key */}
             <button 
                onClick={() => setShowKeyModal(true)}
                className="glass p-2 rounded-full text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
             >
                <FaCog />
             </button>
        </div>
      </div>

      {/* --- CENTER: ORB & CONTENT --- */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-0">
        
        {/* The Core Orb */}
        <div className="pointer-events-auto cursor-pointer mb-8" onClick={state === RoxyState.DISCONNECTED ? onConnect : onToggleMic}>
             <Orb state={state} inputVolume={visuals.inputVolume} />
        </div>

        {/* Dynamic Response Text */}
        {!zenMode && latestLog && (
            <div className="max-w-md w-[90%] text-center animate-slide-up">
                <p className="text-lg md:text-xl font-sans text-slate-100 font-medium leading-relaxed drop-shadow-lg">
                    "{latestLog}"
                </p>
            </div>
        )}

        {/* System Action Toast */}
        {activeSystemAction && (
            <div className="absolute top-1/3 animate-fade-in glass px-6 py-3 rounded-full flex items-center gap-3 shadow-lg">
                 <div className="w-2 h-2 rounded-full bg-primary-400 animate-pulse"></div>
                 <span className="text-sm font-medium text-white">{activeSystemAction}</span>
            </div>
        )}
      </div>

      {/* --- WIDGET LAYER (Hidden in Zen) --- */}
      <div className={`absolute top-24 right-6 flex flex-col gap-4 w-48 transition-all duration-500 ${zenMode || isCameraActive ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}`}>
          <Widget icon={FiSun} label="Weather" value="24° Cloudy" subLabel="San Francisco" />
          <Widget icon={BiHappy} label="Mood" value="Productive" subLabel="3 tasks remaining" />
      </div>

      {/* --- CAMERA FEED (Face Scan) --- */}
      <div className={`absolute top-24 right-6 transition-all duration-500 ${isCameraActive ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-10 pointer-events-none'}`}>
          <div className="relative w-48 aspect-[3/4] rounded-2xl overflow-hidden glass shadow-2xl">
              {videoStream && <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />}
              
              {/* Soft Face Scan Animation */}
              <div className="absolute inset-0 border-[3px] border-primary-400/30 rounded-2xl"></div>
              <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-primary-500/20 to-transparent animate-scan"></div>
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 glass px-3 py-1 rounded-full">
                  <TbFaceId className="text-primary-300" />
                  <span className="text-[10px] text-white font-medium tracking-wide">SCANNING</span>
              </div>
          </div>
      </div>

      {/* --- BOTTOM DOCK --- */}
      <div className={`w-full flex justify-center pb-8 pointer-events-auto z-20 transition-all duration-500 ${zenMode ? 'translate-y-20 opacity-0' : 'translate-y-0 opacity-100'}`}>
         {state === RoxyState.DISCONNECTED ? (
             <button 
                onClick={onConnect}
                className="px-8 py-4 rounded-full bg-slate-100 text-slate-900 font-semibold shadow-[0_0_40px_rgba(255,255,255,0.3)] hover:scale-105 transition-all flex items-center gap-3"
             >
                <FaPowerOff className="text-primary-600" />
                Initialize ROXY
             </button>
         ) : (
             <div className="glass px-6 py-3 rounded-full flex items-center gap-6 shadow-2xl">
                 {/* Mic */}
                 <button 
                    onClick={onToggleMic} 
                    className={`p-4 rounded-full transition-all ${isMicMuted ? 'bg-red-500/10 text-red-400' : 'bg-white/10 text-white hover:bg-white/20'}`}
                 >
                    {isMicMuted ? <FaMicrophoneSlash size={20} /> : <FaMicrophone size={20} />}
                 </button>

                 {/* Camera */}
                 <button 
                    onClick={handleCameraRequest}
                    className={`p-4 rounded-full transition-all ${isCameraActive ? 'bg-primary-500 text-white shadow-lg' : 'bg-white/10 text-slate-300 hover:bg-white/20'}`}
                 >
                    <FaCamera size={20} />
                 </button>

                 <div className="w-[1px] h-8 bg-white/10"></div>

                 {/* Disconnect */}
                 <button 
                    onClick={handleDisconnectRequest} 
                    className="p-4 rounded-full hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors"
                 >
                    <FaPowerOff size={20} />
                 </button>
             </div>
         )}
      </div>

      {/* Zen Mode Exit (Only visible in Zen) */}
      {zenMode && (
         <button 
            onClick={() => setZenMode(false)}
            className="absolute bottom-10 left-1/2 -translate-x-1/2 glass px-6 py-2 rounded-full text-slate-400 hover:text-white text-sm transition-colors pointer-events-auto"
         >
            Exit Focus Mode
         </button>
      )}

      {/* --- MODALS --- */}
      <KeyDialog 
         isOpen={showKeyModal} 
         onClose={() => setShowKeyModal(false)}
         onSave={(key) => {
             if(setApiKey) setApiKey(key);
         }}
      />

      <ConfirmDialog 
         isOpen={confirmAction === 'disconnect'} 
         title="Disconnect Session?"
         message="This will end your current conversation with ROXY. You'll need to reconnect to start over."
         onConfirm={executeConfirm}
         onCancel={() => setConfirmAction(null)}
      />
      
      <ConfirmDialog 
         isOpen={confirmAction === 'camera'} 
         title={isCameraActive ? "Disable Vision?" : "Enable Vision?"}
         message={isCameraActive 
            ? "ROXY will no longer be able to see your environment." 
            : "This allows ROXY to see what you see. Video data is processed in real-time and not stored."}
         onConfirm={executeConfirm}
         onCancel={() => setConfirmAction(null)}
      />

      {/* Error Toast */}
      {error && !showKeyModal && (
          <div className="absolute top-24 left-1/2 -translate-x-1/2 glass px-6 py-3 rounded-xl border border-red-500/20 text-red-300 flex items-center gap-3 animate-slide-up shadow-xl cursor-pointer" onClick={() => setShowKeyModal(true)}>
              <span className="text-sm font-medium">{error}</span>
          </div>
      )}
      
      {/* --- PERMISSION MODAL --- */}
      {permissionRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-fade-in">
            <div className="glass-card p-8 w-80 text-center">
                <div className="w-16 h-16 rounded-full bg-primary-500/20 text-primary-400 flex items-center justify-center mx-auto mb-6">
                    {permissionRequest.type === 'audio' ? <FaMicrophone size={24} /> : <FaCamera size={24} />}
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Enable {permissionRequest.type === 'audio' ? 'Microphone' : 'Camera'}</h3>
                <p className="text-slate-400 text-sm mb-8">
                    ROXY needs access to your {permissionRequest.type} to {permissionRequest.type === 'audio' ? 'hear your commands' : 'see the world'}.
                </p>
                <div className="flex flex-col gap-3">
                    <button onClick={permissionRequest.onConfirm} className="w-full py-3 rounded-xl bg-primary-500 text-white font-medium hover:bg-primary-400 transition-colors">Allow Access</button>
                    <button onClick={permissionRequest.onCancel} className="w-full py-3 rounded-xl hover:bg-white/5 text-slate-400 text-sm transition-colors">Not Now</button>
                </div>
            </div>
        </div>
      )}

      <style>{`
        @keyframes scan {
            0% { top: -50%; }
            100% { top: 150%; }
        }
        .animate-scan {
            animation: scan 3s linear infinite;
        }
      `}</style>
    </div>
  );
};