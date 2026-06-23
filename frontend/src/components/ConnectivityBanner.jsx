import React from 'react';
import { Wifi, WifiOff } from 'lucide-react';

export default function ConnectivityBanner({ isConnected }) {
  return (
    <div className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all duration-300 ${
      isConnected 
        ? 'bg-emerald-950/70 text-emerald-400 border border-emerald-500/20' 
        : 'bg-rose-950/70 text-rose-400 border border-rose-500/20 animate-pulse'
    }`}>
      {isConnected ? (
        <>
          <Wifi className="w-3.5 h-3.5 text-emerald-400" />
          <span>Connected to Local Server</span>
        </>
      ) : (
        <>
          <WifiOff className="w-3.5 h-3.5 text-rose-400" />
          <span>Disconnected - Retrying...</span>
        </>
      )}
    </div>
  );
}
