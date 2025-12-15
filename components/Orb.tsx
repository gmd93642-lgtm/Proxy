import React from 'react';
import { RoxyState } from '../types';

interface OrbProps {
  state: RoxyState;
  inputVolume: number;
}

const Orb: React.FC<OrbProps> = ({ state, inputVolume }) => {
  const isSpeaking = state === RoxyState.SPEAKING;
  const isListening = state === RoxyState.LISTENING;
  
  // Smoother volume scaling for a "liquid" feel
  const volumeScale = Math.min(inputVolume * 2, 0.5); 
  const baseScale = isListening ? 1.1 : 1.0;
  
  return (
    <div className="relative flex items-center justify-center w-64 h-64 md:w-80 md:h-80 transition-all duration-700 ease-out">
      
      {/* 1. Ambient Glow (Outer) */}
      <div 
        className={`absolute inset-0 rounded-full blur-[60px] transition-all duration-1000 ${
            isSpeaking ? 'bg-indigo-500/40' : 
            isListening ? 'bg-primary-400/30' : 
            'bg-slate-700/10'
        }`}
      ></div>

      {/* 2. Breathing Ring */}
      <div 
        className={`absolute inset-4 rounded-full border border-white/10 ${state === RoxyState.IDLE ? 'animate-breathe' : ''}`}
        style={{
            transform: `scale(${1 + volumeScale})`,
            transition: 'transform 0.1s ease-out'
        }}
      ></div>

      {/* 3. The Core (Gradient Sphere) */}
      <div 
        className={`
          relative z-10 w-32 h-32 md:w-40 md:h-40 rounded-full 
          shadow-[inset_0_-10px_30px_rgba(0,0,0,0.5),0_0_30px_rgba(99,102,241,0.3)]
          transition-all duration-500 ease-in-out
          flex items-center justify-center
        `}
        style={{
             background: isSpeaking 
                ? 'linear-gradient(135deg, #818cf8 0%, #4f46e5 100%)' // Indigo active
                : isListening 
                    ? 'linear-gradient(135deg, #c084fc 0%, #7c3aed 100%)' // Purple listening
                    : 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', // Dark idle
             transform: `scale(${baseScale + volumeScale})`,
        }}
      >
        {/* Inner Highlight/Reflection */}
        <div className="absolute top-4 left-6 w-8 h-4 bg-white/10 rounded-full blur-md rotate-[-45deg]"></div>
        
        {/* State Icon / Graphic inside Orb */}
        <div className="opacity-80 mix-blend-overlay">
           {isSpeaking && <div className="w-16 h-16 bg-white/20 rounded-full blur-xl animate-pulse"></div>}
           {state === RoxyState.PROCESSING && (
               <div className="w-12 h-12 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
           )}
        </div>
      </div>

      {/* 4. Text Label (Minimal) */}
      <div className="absolute -bottom-12 text-center opacity-60 transition-opacity duration-500">
          <span className="text-sm font-sans tracking-widest text-slate-300">
              {state === RoxyState.DISCONNECTED ? 'OFFLINE' : 
               state === RoxyState.IDLE ? 'READY' : 
               state}
          </span>
      </div>
    </div>
  );
};

export default Orb;