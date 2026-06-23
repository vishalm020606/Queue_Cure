import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { 
  Clock, 
  Users, 
  Wifi, 
  WifiOff, 
  AlertTriangle, 
  CheckCircle, 
  RefreshCw, 
  Bell, 
  Volume2,
  Phone,
  Languages,
  CheckCircle2,
  Share2,
  Ticket,
  FileText,
  Calendar,
  User
} from 'lucide-react';
import { BACKEND_URL } from '../config';
import { requestFirebaseToken } from '../firebase';

export default function PatientQueue() {
  const { visitId } = useParams();
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Patient queue data
  const [visit, setVisit] = useState(null);
  const [queueState, setQueueState] = useState({
    currentToken: "0",
    currentTokenSeq: 0,
    avgConsultationTime: 10,
    visits: [],
    localIp: ''
  });
  
  // Notification history and registration state
  const [notifications, setNotifications] = useState([]);
  const [fcmRegistered, setFcmRegistered] = useState(false);
  const [fcmToken, setFcmToken] = useState('');
  const [isRegisteringFcm, setIsRegisteringFcm] = useState(false);
  const [rejoining, setRejoining] = useState(false);

  // Load from local storage cache if offline
  const getCacheKey = () => `patient_queue_${visitId}`;
  
  const cacheDataLocally = (vData, qData) => {
    try {
      localStorage.setItem(getCacheKey(), JSON.stringify({ visit: vData, queueState: qData }));
    } catch (err) {
      console.error('Failed to cache patient queue data:', err);
    }
  };

  const loadCachedData = () => {
    try {
      const cached = localStorage.getItem(getCacheKey());
      if (cached) {
        const parsed = JSON.parse(cached);
        setVisit(parsed.visit);
        setQueueState(parsed.queueState);
        setLoading(false);
        return true;
      }
    } catch (err) {
      console.error('Failed to load cached patient queue data:', err);
    }
    return false;
  };

  // Main data fetcher
  const fetchData = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/current-state`);
      if (!response.ok) throw new Error('Failed to fetch clinic status.');
      
      const qData = await response.json();
      setQueueState({
        currentToken: qData.currentToken,
        currentTokenSeq: qData.currentTokenSeq || 0,
        avgConsultationTime: qData.avgConsultationTime,
        visits: qData.visits,
        localIp: qData.localIp || ''
      });

      const matchedVisit = qData.visits.find(v => v._id === visitId);
      if (matchedVisit) {
        setVisit(matchedVisit);
        setError('');
        cacheDataLocally(matchedVisit, qData);
        
        // Check if deviceToken exists
        if (matchedVisit.deviceToken || matchedVisit.patientId?.deviceToken) {
          setFcmRegistered(true);
        }
      } else {
        // If not in active visits, load cache or show error
        const hasCache = loadCachedData();
        if (!hasCache) {
          setError('Your token is inactive, completed, or does not exist.');
        }
      }
    } catch (err) {
      console.error('Fetch error:', err);
      const hasCache = loadCachedData();
      if (!hasCache) {
        setError('Network error. Could not connect to clinic server.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Fetch specific notification log audit history
  const fetchNotifications = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/visit/${visitId}/notifications`);
      if (response.ok) {
        const data = await response.json();
        setNotifications(data.logs || []);
      }
    } catch (err) {
      console.error('Failed to fetch patient notifications history:', err);
    }
  };

  // Initial loads and Socket.IO configuration
  useEffect(() => {
    fetchData();
    fetchNotifications();

    const socket = io(BACKEND_URL, {
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    // Real-Time Queue Updates
    socket.on('queue-updated', (newState) => {
      setQueueState({
        currentToken: newState.currentToken,
        currentTokenSeq: newState.currentTokenSeq || 0,
        avgConsultationTime: newState.avgConsultationTime,
        visits: newState.visits,
        localIp: newState.localIp || ''
      });

      const matchedVisit = newState.visits.find(v => v._id === visitId);
      if (matchedVisit) {
        setVisit(matchedVisit);
        cacheDataLocally(matchedVisit, newState);
      }
    });

    // Real-Time Notification Log Updates
    socket.on('notification-logged', (newLog) => {
      if (newLog.patientId === visit?.patientId?._id || newLog.patientId?._id === visit?.patientId?._id) {
        setNotifications(prev => [newLog, ...prev]);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [visitId, visit?.patientId?._id]);

  // Request FCM Notification Permissions and register device token
  const handleRegisterFcm = async () => {
    setIsRegisteringFcm(true);
    try {
      const token = await requestFirebaseToken();
      if (token) {
        setFcmToken(token);
        
        // Post token to backend
        const response = await fetch(`${BACKEND_URL}/api/register-device-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            visitId,
            deviceToken: token
          })
        });

        const resData = await response.json();
        if (response.ok && resData.success) {
          setFcmRegistered(true);
          // Update local state
          setVisit(prev => ({
            ...prev,
            deviceToken: token
          }));
        } else {
          alert(resData.error || 'Failed to link device notification token.');
        }
      } else {
        alert('Permission denied or FCM failed to generate token.');
      }
    } catch (err) {
      console.error('FCM registration error:', err);
      alert('Could not set up notifications: ' + err.message);
    } finally {
      setIsRegisteringFcm(false);
    }
  };

  // Rejoin queue request
  const handleRejoin = async () => {
    setRejoining(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/visit/${visitId}/rejoin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setVisit(data.visit);
        setError('');
        fetchNotifications();
      } else {
        alert(data.error || 'Failed to rejoin queue.');
      }
    } catch (err) {
      console.error('Rejoin queue error:', err);
      alert('Network error. Failed to send rejoin request.');
    } finally {
      setRejoining(false);
    }
  };

  const getScannedUrl = () => {
    const origin = window.location.origin;
    const localIp = queueState.localIp;
    if (localIp && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      return origin.replace('localhost', localIp).replace('127.0.0.1', localIp) + '/patient-queue/' + visitId;
    }
    return origin + '/patient-queue/' + visitId;
  };

  // Share Dashboard URL
  const handleShare = () => {
    const shareUrl = getScannedUrl();
    if (navigator.share) {
      navigator.share({
        title: `Queue Cure - Token #${visit?.tokenNumber}`,
        text: `Track my live queue status for Token #${visit?.tokenNumber}`,
        url: shareUrl,
      }).catch(console.error);
    } else {
      navigator.clipboard.writeText(shareUrl);
      alert('Dashboard link copied to clipboard!');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-10 h-10 text-blue-500 animate-spin" />
          <p className="text-sm font-semibold text-slate-400">Loading your clinic dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 bg-grid-pattern">
        <div className="glass-premium rounded-3xl p-8 max-w-md w-full border border-rose-500/20 text-center relative">
          <div className="w-16 h-16 bg-rose-950/70 border border-rose-500/20 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-5">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Queue Inactive or Complete</h2>
          <p className="text-sm text-slate-400 mb-6">{error}</p>
          <button 
            onClick={fetchData} 
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-6 rounded-xl transition duration-200"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  // Live Position Computations
  const patient = visit?.patientId;
  const isUrgent = visit?.priority === 'Urgent';
  const waitingVisits = queueState.visits.filter(v => v.status === 'waiting');
  
  // Sort waiting list logically to find position: Urgent first, then Normal
  const sortedWaiting = [...waitingVisits].sort((a, b) => {
    if (a.priority === 'Urgent' && b.priority !== 'Urgent') return -1;
    if (a.priority !== 'Urgent' && b.priority === 'Urgent') return 1;
    return a.tokenSeq - b.tokenSeq;
  });

  // Index of this patient in the active queue
  const myQueueIndex = sortedWaiting.findIndex(v => v._id === visitId);

  // Calculations based on queue position
  let statusText = "Waiting";
  let statusColor = "bg-blue-500/10 text-blue-400 border border-blue-500/20";
  let patientsAhead = 0;
  let estimatedWait = 0;

  if (visit.status === 'serving') {
    statusText = "Serving Now";
    statusColor = "bg-emerald-500/20 text-emerald-400 border border-emerald-500/35 glow-green";
    patientsAhead = 0;
    estimatedWait = 0;
  } else if (visit.status === 'completed') {
    statusText = "Completed";
    statusColor = "bg-slate-800 text-slate-400 border border-slate-700";
    patientsAhead = 0;
    estimatedWait = 0;
  } else if (visit.status === 'skipped') {
    statusText = "Missed Call";
    statusColor = "bg-rose-950/70 text-rose-400 border border-rose-500/30 animate-pulse";
    patientsAhead = 0;
    estimatedWait = 0;
  } else {
    // Waiting state
    patientsAhead = myQueueIndex >= 0 ? myQueueIndex : 0;
    
    // Sum predicted wait times for all patients ahead of me
    const avgConsult = queueState.avgConsultationTime;
    
    // serving patient remaining time
    const servingVisit = queueState.visits.find(v => v.status === 'serving');
    let currentServingRemaining = 0;
    if (servingVisit) {
      const elapsedMs = Date.now() - new Date(servingVisit.updatedAt).getTime();
      const elapsedMins = elapsedMs / 60000;
      currentServingRemaining = Math.max(1, Math.round(avgConsult - elapsedMins));
    }

    let calculatedWait = currentServingRemaining;
    for (let i = 0; i < patientsAhead; i++) {
      const durationFactor = sortedWaiting[i]?.priority === 'Urgent' ? 1.3 : 1.0;
      calculatedWait += Math.round(avgConsult * durationFactor);
    }
    estimatedWait = calculatedWait || avgConsult;
  }

  // Queue progress calculation: initial predicted patients ahead vs remaining patients ahead
  const initialAhead = Math.round(visit.initialPredictedWaitTime / queueState.avgConsultationTime) || 1;
  const progressPercent = visit.status === 'serving' || visit.status === 'completed'
    ? 100 
    : Math.max(5, Math.min(95, Math.round(((initialAhead - patientsAhead) / initialAhead) * 100)));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between bg-grid-pattern p-4 md:p-8 select-none">
      
      {/* Top Header */}
      <header className="max-w-2xl w-full mx-auto flex items-center justify-between border-b border-slate-900 pb-4 mb-6">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
            <span className="text-lg font-black text-white">QC</span>
          </div>
          <div>
            <h1 className="text-lg font-black text-white uppercase tracking-tight">Queue Cure</h1>
            <p className="text-[10px] text-slate-400 font-semibold uppercase">Digital Queue Tracker</p>
          </div>
        </div>

        {/* LAN Online/Offline Indicator */}
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold border ${
          isConnected 
            ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/10' 
            : 'bg-rose-950/40 text-rose-400 border-rose-500/10 animate-pulse'
        }`}>
          {isConnected ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              <span>Synced Live</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-rose-400" />
              <span>Offline Cache</span>
            </>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-2xl w-full mx-auto flex-1 flex flex-col gap-6">
        
        {/* Main Status Card */}
        <div className="glass-premium rounded-[2rem] p-6 md:p-8 relative overflow-hidden shadow-2xl border border-slate-800">
          <div className="absolute right-0 top-0 -mt-10 -mr-10 w-28 h-28 bg-blue-500/10 rounded-full blur-2xl" />
          
          {/* Patient Info row */}
          <div className="flex justify-between items-start gap-4">
            <div>
              <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wider block">Patient Name</span>
              <h2 className="text-xl font-bold text-white mt-0.5">{patient?.name || 'Patient'}</h2>
              <div className="flex gap-2.5 mt-2">
                {isUrgent && (
                  <span className="bg-red-950 text-red-400 border border-red-500/20 text-[8px] px-2 py-0.5 rounded uppercase font-bold animate-pulse">
                    Urgent
                  </span>
                )}
                <span className="text-[9px] text-slate-400 font-semibold bg-slate-900 border border-slate-800 px-2 py-0.5 rounded flex items-center gap-1">
                  <Languages className="w-3 h-3 text-slate-400" />
                  {patient?.preferredLanguage || 'English'}
                </span>
                {patient?.phone && (
                  <span className="text-[9px] text-slate-400 font-semibold bg-slate-900 border border-slate-800 px-2 py-0.5 rounded flex items-center gap-1">
                    <Phone className="w-3 h-3 text-slate-400" />
                    {patient.phone}
                  </span>
                )}
              </div>
            </div>

            <div className="text-right">
              <span className="text-slate-500 text-[10px] font-bold uppercase tracking-wider block">Queue Status</span>
              <span className={`inline-block text-xs font-extrabold uppercase px-3 py-1.5 rounded-full mt-1.5 ${statusColor}`}>
                {statusText}
              </span>
            </div>
          </div>

          {/* TOKEN BIG COUNTER */}
          <div className="flex flex-col items-center justify-center my-8">
            <span className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">Your Token Number</span>
            <div className="relative bg-slate-950/50 border border-slate-850 px-12 py-6 rounded-[2rem] shadow-inner text-center">
              <span className="text-6xl md:text-7xl font-black text-blue-400 font-mono glow-blue">
                #{visit.tokenNumber}
              </span>
            </div>
          </div>

          {/* Queue Progress Bar */}
          <div className="mb-6">
            <div className="flex justify-between items-center text-xs font-bold text-slate-400 mb-2">
              <span>Queue Intake</span>
              <span>Serving #{visit.tokenNumber} ({progressPercent}%)</span>
            </div>
            <div className="h-3 bg-slate-900 rounded-full border border-slate-850 overflow-hidden p-0.5">
              <div 
                className="h-full bg-gradient-to-r from-blue-600 to-indigo-500 rounded-full shadow-[0_0_12px_rgba(59,130,246,0.5)] transition-all duration-500" 
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-3 text-center border-t border-slate-900 pt-6">
            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-4">
              <span className="text-slate-500 text-[9px] font-bold uppercase tracking-wider block">Current Serving</span>
              <span className="text-2xl font-black text-emerald-400 mt-1 block font-mono glow-green">
                {queueState.currentToken !== "0" ? `#${queueState.currentToken}` : '--'}
              </span>
            </div>

            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-4">
              <span className="text-slate-500 text-[9px] font-bold uppercase tracking-wider block">Patients Ahead</span>
              <span className="text-2xl font-black text-white mt-1 block font-mono">
                {patientsAhead}
              </span>
            </div>

            <div className="bg-slate-950/40 border border-slate-900 rounded-2xl p-4">
              <span className="text-slate-500 text-[9px] font-bold uppercase tracking-wider block">Est. Wait Time</span>
              <span className="text-2xl font-black text-yellow-500 mt-1 block font-mono glow-red">
                {estimatedWait} <span className="text-xs font-semibold text-slate-400">mins</span>
              </span>
            </div>
          </div>

          {/* Dynamic re-join alert for skipped patient */}
          {visit.status === 'skipped' && (
            <div className="mt-6 bg-rose-950/50 border border-rose-500/20 rounded-2xl p-5 text-center flex flex-col items-center gap-3">
              <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
                <AlertTriangle className="w-5 h-5 text-rose-500 animate-pulse" />
                <span>Doctor called your token but you were not present.</span>
              </div>
              <p className="text-xs text-rose-300">
                You have been skipped. Tap the button below to rejoin the queue at the end of the line.
              </p>
              <button
                onClick={handleRejoin}
                disabled={rejoining}
                className="w-full bg-rose-600 hover:bg-rose-500 disabled:bg-rose-900 text-white font-bold py-2.5 px-5 rounded-xl text-xs transition duration-200 flex items-center justify-center gap-2 shadow-lg shadow-rose-900/30"
              >
                {rejoining ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Rejoining...</span>
                  </>
                ) : (
                  <span>Rejoin Queue</span>
                )}
              </button>
            </div>
          )}

          {/* Share button */}
          <button
            onClick={handleShare}
            className="absolute top-4 right-4 bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-400 hover:text-white p-2 rounded-xl transition duration-200"
            title="Share dashboard"
          >
            <Share2 className="w-4 h-4" />
          </button>

        </div>

        {/* Digital Token Receipt Details Card */}
        <div className="glass-premium rounded-[2rem] p-6 md:p-8 relative overflow-hidden shadow-2xl border border-slate-800 flex flex-col gap-4">
          <div className="flex items-center gap-2.5 pb-3 border-b border-slate-900">
            <Ticket className="w-5 h-5 text-blue-500 animate-pulse" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Digital Token Receipt</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="flex items-center justify-between p-3 bg-slate-950/40 border border-slate-900 rounded-xl">
              <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Token Number</span>
              <span className="font-bold text-blue-400 font-mono text-sm">#{visit.tokenNumber}</span>
            </div>
            
            <div className="flex items-center justify-between p-3 bg-slate-950/40 border border-slate-900 rounded-xl">
              <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Patient ID</span>
              <span className="font-bold text-white font-mono">{patient?.patientId || 'N/A'}</span>
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-950/40 border border-slate-900 rounded-xl">
              <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Patient Name</span>
              <span className="font-bold text-white">{patient?.name || 'N/A'}</span>
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-950/40 border border-slate-900 rounded-xl">
              <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Phone Number</span>
              <span className="font-bold text-white font-mono">{patient?.phone || 'N/A'}</span>
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-950/40 border border-slate-900 rounded-xl">
              <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Priority Level</span>
              <span className={`px-2.5 py-1 rounded font-bold uppercase text-[9px] border ${
                visit.priority === 'Urgent' 
                  ? 'bg-rose-950/60 text-rose-400 border-rose-500/20' 
                  : 'bg-slate-900 text-slate-300 border-slate-800'
              }`}>
                {visit.priority}
              </span>
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-950/40 border border-slate-900 rounded-xl">
              <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Language Preferred</span>
              <span className="font-bold text-white">{patient?.preferredLanguage || 'English'}</span>
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-950/40 border border-slate-900 rounded-xl">
              <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Reason for Visit</span>
              <span className="font-bold text-white truncate max-w-[150px]">{visit.reasonForVisit || 'General Consultation'}</span>
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-950/40 border border-slate-900 rounded-xl">
              <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Est. Wait at Issue</span>
              <span className="font-bold text-yellow-500 font-mono">
                {visit.initialPredictedWaitTime || queueState.avgConsultationTime || 10} mins
              </span>
            </div>
          </div>
          
          <div className="flex items-center justify-between p-3 bg-blue-950/20 border border-blue-500/10 rounded-xl text-[10px] text-slate-400 gap-3 mt-1">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-400" />
              <span>Ticket Issued Date & Time</span>
            </div>
            <span className="font-semibold text-white font-mono">
              {visit.createdAt ? new Date(visit.createdAt).toLocaleString() : new Date().toLocaleString()}
            </span>
          </div>
        </div>

        {/* Firebase Push Notifications Config Card */}
        <div className="glass rounded-[2rem] p-5 flex items-center justify-between border border-slate-900 shadow-md">
          <div className="flex items-center gap-3.5">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              fcmRegistered 
                ? 'bg-emerald-950 border border-emerald-500/10 text-emerald-400' 
                : 'bg-slate-950 border border-slate-850 text-slate-400'
            }`}>
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Browser Push Alerts</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {fcmRegistered 
                  ? 'FCM device token registered. Alerts will trigger.' 
                  : 'Receive free live updates directly on your device.'
                }
              </p>
            </div>
          </div>

          <div>
            {fcmRegistered ? (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-bold bg-emerald-950/20 border border-emerald-500/10 px-3 py-1.5 rounded-xl">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Active
              </span>
            ) : (
              <button
                onClick={handleRegisterFcm}
                disabled={isRegisteringFcm}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 text-white text-xs font-bold py-2 px-4 rounded-xl transition duration-200"
              >
                {isRegisteringFcm ? 'Configuring...' : 'Enable alerts'}
              </button>
            )}
          </div>
        </div>

        {/* Personalized QR Code card */}
        <div className="glass rounded-[2rem] p-6 border border-slate-900 flex flex-col md:flex-row items-center gap-6 shadow-md">
          <div className="w-32 h-32 bg-white rounded-2xl p-2 flex-shrink-0 flex items-center justify-center shadow-inner">
            <img 
              src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(getScannedUrl())}`}
              alt="Visit Dashboard QR Code"
              className="w-28 h-28"
            />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white mb-1.5">QR-Based Status Tracker</h3>
            <p className="text-xs text-slate-400 leading-relaxed mb-3">
              Scan this QR code from another device (or print it) to share your live token status dashboard. It links directly to this token.
            </p>
            <span className="text-[10px] text-slate-500 font-mono select-all break-all">
              {getScannedUrl()}
            </span>
          </div>
        </div>

        {/* Notification History panel */}
        <div className="glass rounded-[2rem] p-6 border border-slate-900 flex-1 flex flex-col shadow-md">
          <div className="flex items-center justify-between border-b border-slate-900 pb-3.5 mb-4">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Notification Log History</span>
            <button 
              onClick={fetchNotifications} 
              className="text-slate-500 hover:text-slate-300 p-1.5 rounded-lg hover:bg-slate-900 transition duration-150"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-3 max-h-56 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-slate-600 text-xs flex flex-col items-center gap-1.5">
                <Bell className="w-6 h-6 text-slate-700" />
                <span>No alerts sent to this token yet</span>
              </div>
            ) : (
              notifications.map((log) => (
                <div 
                  key={log._id} 
                  className="flex items-start justify-between p-3.5 bg-slate-950/40 border border-slate-900 rounded-xl gap-4 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-300 uppercase text-[10px] tracking-wider bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
                        {log.type.replace('_', ' ')}
                      </span>
                      <span className="text-[9px] text-slate-500">
                        {new Date(log.sentAt || log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-slate-400 text-xs leading-relaxed whitespace-pre-line font-mono py-1">
                      {log.message}
                    </p>
                  </div>
                  
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                      log.channel === 'push'
                        ? 'bg-indigo-950 text-indigo-400 border border-indigo-500/10'
                        : 'bg-emerald-950 text-emerald-400 border border-emerald-500/10'
                    }`}>
                      {log.channel === 'push' ? 'FCM Push' : 'WhatsApp'}
                    </span>
                    <span className={`text-[8px] font-semibold flex items-center gap-0.5 ${
                      log.status === 'sent' ? 'text-emerald-500' : 'text-rose-500'
                    }`}>
                      {log.status === 'sent' ? 'Sent' : 'Failed'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </main>

      {/* Footer */}
      <footer className="text-center text-slate-600 text-[10px] max-w-2xl w-full mx-auto border-t border-slate-900 pt-4 mt-6">
        Queue Cure Clinic Digital Manager • Powered by Node.js & React
      </footer>

    </div>
  );
}
