import React from 'react';
import { useLiveRoxy } from './hooks/useLiveRoxy'; 
import { HUD } from './components/HUD';

const App: React.FC = () => {
  const { 
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
    permissionRequest,
    activeSystemAction,
    setApiKey,
    hasApiKey
  } = useLiveRoxy();

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-900">
      
      {/* Premium Gradient Background */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-black z-0"></div>
      
      {/* Subtle Ambient Light Orb (Background decoration) */}
      <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] bg-primary-500/10 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] left-[-10%] w-[400px] h-[400px] bg-accent-500/5 rounded-full blur-[80px] pointer-events-none"></div>

      {/* Main UI Layer */}
      <HUD 
        state={state}
        memory={memory}
        onToggleMic={toggleMic}
        isMicMuted={isMicMuted}
        onConnect={connect}
        onDisconnect={disconnect}
        error={error}
        visuals={visuals}
        toggleCamera={toggleCamera}
        isCameraActive={isCameraActive}
        videoStream={videoStream}
        sendTextMessage={sendTextMessage}
        permissionRequest={permissionRequest}
        activeSystemAction={activeSystemAction}
        setApiKey={setApiKey}
        hasApiKey={hasApiKey}
      />

    </div>
  );
};

export default App;