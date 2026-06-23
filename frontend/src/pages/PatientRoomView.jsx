import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import Navbar from '../components/Navbar';
import { 
  Volume2, 
  VolumeX, 
  Clock, 
  Users, 
  ChevronRight, 
  Wifi, 
  WifiOff 
} from 'lucide-react';

import { BACKEND_URL } from '../config';

const TRANSLATIONS = {
  English: 'Token Number {token}, please proceed to Doctor Room 1.',
  Tamil: 'டோக்கன் எண் {token}, மருத்துவர் அறை 1-க்கு செல்லவும்.',
  Hindi: 'टोकन नंबर {token}, कृपया डॉक्टर कमरा 1 में जाएं।',
  Telugu: 'టోకెన్ సంఖ్య {token}, దయచేసి డాక్టర్ గది 1 కి వెళ్ళండి.',
  Kannada: 'ಟೋಕನ್ ಸಂಖ್ಯೆ {token}, ದಯವಿಟ್ಟು ವೈದ್ಯರ ಕೊಠಡಿ 1 ಕ್ಕೆ ಹೋಗಿ.',
  Malayalam: 'ടോക്കൺ നമ്പർ {token}, ദയവായി ഡോക്ടർ റൂം 1 ലേക്ക് പോകുക.'
};

const VOICE_LANGS = {
  English: 'en-IN',
  Tamil: 'ta-IN',
  Hindi: 'hi-IN',
  Telugu: 'te-IN',
  Kannada: 'kn-IN',
  Malayalam: 'ml-IN'
};

export default function PatientRoomView() {
  const [isConnected, setIsConnected] = useState(false);
  const [queueState, setQueueState] = useState({
    currentToken: 0,
    avgConsultationTime: 10,
    visits: []
  });
  
  // Voice announcement state
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  
  // Track last announced token to avoid duplicates on re-connections
  const lastAnnouncedToken = useRef("");

  const fetchLatestState = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/current-state`);
      if (response.ok) {
        const data = await response.json();
        setQueueState({
          currentToken: data.currentToken,
          avgConsultationTime: data.avgConsultationTime,
          visits: data.visits
        });
      }
    } catch (error) {
      console.error('Failed to fetch fallback state:', error);
    }
  };

  const announceToken = (tokenNumber, preferredLanguage = 'English') => {
    if (!voiceEnabled || !tokenNumber || tokenNumber === "0" || tokenNumber === 0) return;
    
    // Stop prior speech immediately to prevent overlap issues
    window.speechSynthesis.cancel();

    // A small timeout ensures the cancel event finishes before starting a new utterance
    setTimeout(() => {
      // 1. Announce in English first
      const enMessage = `Token number ${tokenNumber}, please proceed to Doctor Room 1.`;
      const enUtterance = new SpeechSynthesisUtterance(enMessage);
      
      enUtterance.rate = 0.85; // slower speed for echo-prone lobby areas
      enUtterance.pitch = 1.0; 

      const voices = window.speechSynthesis.getVoices();
      const enVoice = voices.find(v => v.lang.includes('en-IN') || v.lang.includes('en-GB') || v.lang.includes('en-US'));
      if (enVoice) {
        enUtterance.voice = enVoice;
      }

      // 2. Announce in regional language on completion
      if (preferredLanguage && preferredLanguage !== 'English' && TRANSLATIONS[preferredLanguage]) {
        enUtterance.onend = () => {
          setTimeout(() => {
            const langMessage = TRANSLATIONS[preferredLanguage].replace('{token}', tokenNumber);
            const langUtterance = new SpeechSynthesisUtterance(langMessage);
            langUtterance.rate = 0.8;
            langUtterance.pitch = 1.0;

            const langVoice = voices.find(v => v.lang.includes(VOICE_LANGS[preferredLanguage]));
            if (langVoice) {
              langUtterance.voice = langVoice;
            } else {
              // Fallback prefix match
              const prefixVoice = voices.find(v => v.lang.startsWith(VOICE_LANGS[preferredLanguage].split('-')[0]));
              if (prefixVoice) langUtterance.voice = prefixVoice;
            }
            window.speechSynthesis.speak(langUtterance);
          }, 150);
        };
      }

      window.speechSynthesis.speak(enUtterance);
    }, 100);
  };

  // Socket configurations
  useEffect(() => {
    const socket = io(BACKEND_URL, {
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      setIsConnected(true);
      fetchLatestState();
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('queue-updated', (newState) => {
      setQueueState(newState);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Voice announcement hook on token updates
  useEffect(() => {
    const current = queueState.currentToken;
    if (voiceEnabled && current && current !== "0" && current !== 0 && current !== lastAnnouncedToken.current) {
      // Find the serving visit to extract patient's preferred language
      const servingVisit = queueState.visits.find(v => v.status === 'serving');
      const lang = servingVisit?.patientId?.preferredLanguage || 'English';
      
      announceToken(current, lang);
      lastAnnouncedToken.current = current;
    }
  }, [queueState.currentToken, voiceEnabled, queueState.visits]);

  const waitingVisits = queueState.visits.filter(v => v.status === 'waiting');
  
  // Total waiting tokens ahead
  const tokensAhead = waitingVisits.length;
  
  // Estimated wait time = sum of predicted wait times for all waiting patients
  const totalEstWaitTime = waitingVisits.reduce((acc, v) => acc + (v.predictedWaitTime || queueState.avgConsultationTime), 0);

  // Next up patient predicted wait time
  const upcomingQueue = waitingVisits.slice(0, 3);
  const nextWaitTime = upcomingQueue[0]?.predictedWaitTime || 0;

  const enableAudioAnnouncements = () => {
    setVoiceEnabled(true);
    
    // Play greeting only if no token is currently called
    if (!queueState.currentToken || queueState.currentToken <= 0) {
      window.speechSynthesis.cancel();
      setTimeout(() => {
        const testUtterance = new SpeechSynthesisUtterance('Voice announcements enabled.');
        testUtterance.rate = 1.0;
        window.speechSynthesis.speak(testUtterance);
      }, 50);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between bg-grid-pattern p-6 select-none">
      <Navbar />
      
      {/* Top Ticker Status Bar */}
      <header className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-slate-900 pb-5">
        
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-emerald-600 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <span className="text-2xl font-black text-white">OPD</span>
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white uppercase">Waiting Room Monitor</h1>
            <p className="text-xs font-semibold text-slate-400">Dr. Clinic Live Queue Board</p>
          </div>
        </div>

        {/* Audio and Network control tools */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          
          <button
            onClick={voiceEnabled ? () => setVoiceEnabled(false) : enableAudioAnnouncements}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] ${
              voiceEnabled 
                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/20' 
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-750'
            }`}
          >
            {voiceEnabled ? (
              <>
                <Volume2 className="w-4 h-4" />
                <span>Audio Calls Enabled</span>
              </>
            ) : (
              <>
                <VolumeX className="w-4 h-4 text-slate-400" />
                <span>Activate Audio Calls</span>
              </>
            )}
          </button>

          <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border ${
            isConnected 
              ? 'bg-emerald-950/70 text-emerald-400 border-emerald-500/20' 
              : 'bg-rose-950/70 text-rose-400 border-rose-500/20 animate-pulse'
          }`}>
            {isConnected ? (
              <>
                <Wifi className="w-4 h-4 text-emerald-400" />
                <span>Sync Online</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-rose-400" />
                <span>Sync Offline - Reconnecting</span>
              </>
            )}
          </div>

        </div>

      </header>

      {/* Main Grid: OPD waiting terminal dashboard */}
      <main className="flex-1 my-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        
        {/* Main Display Box (Now serving: Token X) */}
        <div className="lg:col-span-8 flex flex-col justify-between bg-slate-900/40 border border-slate-850 rounded-3xl p-8 lg:p-12 relative overflow-hidden shadow-2xl">
          <div className="absolute top-0 right-0 -mt-16 -mr-16 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl" />
          
          <div className="text-center md:text-left">
            <span className="text-emerald-400 text-sm md:text-base font-extrabold tracking-widest uppercase">
              Current Patient status
            </span>
            <h2 className="text-slate-400 text-lg md:text-xl font-bold mt-1">
              Please watch the screen and proceed when your token is called
            </h2>
          </div>

          {/* MAIN BIG COUNTER CARD */}
          <div className="flex flex-col items-center justify-center my-10 lg:my-16">
            <div className="text-slate-500 text-xl font-bold uppercase tracking-wider mb-2">Now Serving</div>
            
            <div className={`relative px-12 py-10 lg:px-20 lg:py-16 rounded-[2.5rem] border-4 flex flex-col items-center justify-center transition-all ${
              queueState.currentToken > 0 
                ? 'bg-emerald-950/20 border-emerald-500/40 shadow-[0_0_80px_-20px_rgba(16,185,129,0.25)]' 
                : 'bg-slate-900/35 border-slate-850'
            }`}>
              {queueState.currentToken > 0 && (
                <div className="absolute -top-3.5 bg-emerald-500 text-slate-950 font-black text-xs px-4 py-1.5 rounded-full tracking-widest animate-pulse-fast uppercase shadow-lg shadow-emerald-500/30">
                  Calling Now
                </div>
              )}
              
              <span className={`text-9xl lg:text-[11rem] font-black tracking-tight font-mono leading-none ${
                queueState.currentToken > 0 ? 'text-emerald-400 glow-green' : 'text-slate-700'
              }`}>
                {queueState.currentToken > 0 ? `#${queueState.currentToken}` : '--'}
              </span>
            </div>
          </div>

          {/* Sub details row: Next Token callout */}
          <div className="grid grid-cols-2 gap-4 my-4 border-t border-b border-slate-850 py-4 text-center">
            <div>
              <span className="text-slate-500 text-xs font-bold uppercase tracking-wider block">Next Token</span>
              <span className="text-3xl font-black text-blue-400 mt-1 font-mono">
                {upcomingQueue[0] ? `#${upcomingQueue[0].tokenNumber}` : 'None'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 text-xs font-bold uppercase tracking-wider block">Next Estimated Wait</span>
              <span className="text-3xl font-black text-yellow-500 mt-1 font-mono">
                {nextWaitTime} <span className="text-lg text-slate-400">mins</span>
              </span>
            </div>
          </div>

          {/* Audio announcement help status bar */}
          <div className="bg-slate-950/60 border border-slate-850 rounded-2xl p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-blue-900/55 flex items-center justify-center flex-shrink-0 border border-blue-500/20">
              <Volume2 className="w-5 h-5 text-blue-400" />
            </div>
            <div className="text-sm font-semibold text-slate-300">
              {queueState.currentToken > 0 ? (
                <span>Bilingual announcement triggered for <strong className="text-white">Token #{queueState.currentToken}</strong></span>
              ) : (
                <span>Waiting for doctor to call the next token...</span>
              )}
            </div>
          </div>

        </div>

        {/* Right side board (Live metrics + Next up) */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          
          {/* Tokens ahead count */}
          <div className="bg-slate-900/40 border border-slate-850 rounded-3xl p-6 flex items-center justify-between shadow-lg">
            <div>
              <span className="text-slate-500 text-xs font-bold uppercase tracking-wider block">Waiting Patients</span>
              <span className="text-5xl font-black text-white block mt-2 font-mono">{tokensAhead}</span>
            </div>
            <div className="w-14 h-14 bg-blue-950 text-blue-400 rounded-2xl flex items-center justify-center border border-blue-500/10">
              <Users className="w-7 h-7" />
            </div>
          </div>

          {/* Estimated Waiting metrics calculation */}
          <div className="bg-slate-900/40 border border-slate-850 rounded-3xl p-6 flex flex-col justify-between shadow-lg relative overflow-hidden">
            <div className="absolute right-0 top-0 -mt-8 -mr-8 w-24 h-24 bg-yellow-500/5 rounded-full blur-xl" />
            <div className="flex items-center justify-between">
              <div>
                <span className="text-slate-500 text-xs font-bold uppercase tracking-wider block">Total Queue ETA</span>
                <span className="text-5xl font-black text-yellow-500 block mt-2 font-mono glow-red">
                  {totalEstWaitTime} <span className="text-xl font-bold text-slate-400">mins</span>
                </span>
              </div>
              <div className="w-14 h-14 bg-yellow-950/80 text-yellow-400 rounded-2xl flex items-center justify-center border border-yellow-500/10">
                <Clock className="w-7 h-7" />
              </div>
            </div>
            <p className="text-[10px] text-slate-500 font-medium mt-3 border-t border-slate-850 pt-2.5">
              *Predicted using AI scheduler duration weighting (Approved emergencies prioritized, normal FIFO).
            </p>
          </div>

          {/* Up next tokens board */}
          <div className="bg-slate-900/40 border border-slate-850 rounded-3xl p-6 flex-1 flex flex-col overflow-hidden">
            <span className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-4 block">Next In Line</span>
            
            <div className="space-y-3 flex-1 overflow-y-auto">
              {upcomingQueue.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 text-sm">
                  <span>No upcoming tokens</span>
                </div>
              ) : (
                upcomingQueue.map((visit, index) => (
                  <div 
                    key={visit._id} 
                    className="flex items-center justify-between p-4 bg-slate-950/55 border border-slate-850 rounded-2xl"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-slate-900 border border-slate-800 text-blue-400 font-bold rounded-xl flex items-center justify-center font-mono">
                        #{visit.tokenNumber}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-300">
                          {visit.patientId?.name}
                        </div>
                        <div className="flex gap-1.5 mt-0.5">
                          {visit.priority === 'Urgent' && (
                            <span className="bg-red-950 text-red-400 border border-red-500/10 text-[8px] px-1 rounded uppercase font-bold animate-pulse">
                              Urgent Case
                            </span>
                          )}
                          <span className="text-[8px] text-slate-500 uppercase font-mono">
                            Lang: {visit.patientId?.preferredLanguage || 'English'}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center text-yellow-500 text-xs gap-1 font-bold font-mono">
                      <span>~{visit.predictedWaitTime || queueState.avgConsultationTime}m</span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

      </main>

      <footer className="text-center text-slate-600 text-xs border-t border-slate-900 pt-5">
        Queue Cure '26 OPD Client • Runs 100% Offline via LAN Wi-Fi
      </footer>

    </div>
  );
}
