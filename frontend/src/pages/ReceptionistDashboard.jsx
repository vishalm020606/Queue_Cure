// Vercel build trigger: 2026-06-24
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import Navbar from '../components/Navbar';
import StatCards from '../components/StatCards';
import { 
  UserPlus, 
  Play, 
  Settings, 
  Search, 
  AlertTriangle, 
  CheckCircle,
  Printer,
  X,
  Plus,
  BarChart3,
  BookOpen,
  Calendar,
  Clock,
  ArrowRight,
  Volume2,
  VolumeX
} from 'lucide-react';

import { BACKEND_URL } from '../config';
import { 
  saveItem, 
  getAllItems, 
  deleteItem, 
  addPendingAction, 
  synchronizePendingActions,
  initDB
} from '../utils/indexedDB';
import TRANSLATIONS from '../utils/translations';

const VOICE_TRANSLATIONS = {
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

export default function ReceptionistDashboard() {
  const navigate = useNavigate();
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard', 'analytics', 'reports'
  
  const [queueState, setQueueState] = useState({
    currentToken: 0,
    avgConsultationTime: 10,
    visits: [],
    localIp: ''
  });

  // Patient Intake Form fields
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('Male');
  const [address, setAddress] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [bloodGroup, setBloodGroup] = useState('A+');
  const [preferredLanguage, setPreferredLanguage] = useState('English');
  const [notificationPreference, setNotificationPreference] = useState('whatsapp');
  const [reasonForVisit, setReasonForVisit] = useState('');
  const [priority, setPriority] = useState('Normal');

  // Form search feedback
  const [patientLookupFound, setPatientLookupFound] = useState(null); // 'found' or 'not_found'
  const [existingPatientObj, setExistingPatientObj] = useState(null);

  // Settings time inputs
  const [avgTimeInput, setAvgTimeInput] = useState('10');

  // Active printed slip
  const [activeReceipt, setActiveReceipt] = useState(null);
  
  // Sync status
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ processed: 0, total: 0, type: '' });
  const [pendingCount, setPendingCount] = useState(0);

  // Reports state
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [notificationLogs, setNotificationLogs] = useState([]);

  // Voice announcement state
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const lastAnnouncedToken = useRef("");

  const announceToken = (tokenNumber, preferredLanguage = 'English') => {
    if (!tokenNumber || tokenNumber === "0" || tokenNumber === 0) return;
    
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
      if (preferredLanguage && preferredLanguage !== 'English' && VOICE_TRANSLATIONS[preferredLanguage]) {
        enUtterance.onend = () => {
          setTimeout(() => {
            const langMessage = VOICE_TRANSLATIONS[preferredLanguage].replace('{token}', tokenNumber);
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

  const enableAudioAnnouncements = () => {
    setVoiceEnabled(true);
    
    window.speechSynthesis.cancel();
    setTimeout(() => {
      const testUtterance = new SpeechSynthesisUtterance('Voice announcements enabled.');
      testUtterance.rate = 1.0;
      window.speechSynthesis.speak(testUtterance);
    }, 50);
  };

  const getToken = () => localStorage.getItem('token');
  const getUser = () => JSON.parse(localStorage.getItem('user') || '{}');

  // Cache data locally in IndexedDB
  const cacheSystemState = async (state) => {
    try {
      // Clear old visits cache first, then write active ones
      const localVisits = await getAllItems('visits');
      for (const v of localVisits) {
        await deleteItem('visits', v._id);
      }
      for (const visit of state.visits) {
        await saveItem('visits', visit);
        if (visit.patientId) {
          await saveItem('patients', visit.patientId);
        }
      }
    } catch (err) {
      console.error('Failed to cache state locally:', err);
    }
  };

  const loadCachedState = async () => {
    try {
      const visits = await getAllItems('visits');
      setQueueState(prev => ({
        ...prev,
        visits: visits || []
      }));
    } catch (err) {
      console.error('Failed to load local visits cache:', err);
    }
  };

  const fetchLatestState = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/current-state`);
      if (response.ok) {
        const data = await response.json();
        setQueueState({
          currentToken: data.currentToken,
          avgConsultationTime: data.avgConsultationTime,
          visits: data.visits,
          localIp: data.localIp || ''
        });
        setAvgTimeInput(data.avgConsultationTime.toString());
        await cacheSystemState(data);
      } else {
        await loadCachedState();
      }
    } catch (error) {
      console.error('Failed to fetch state from server. Using local database:', error);
      await loadCachedState();
    }
  };

  const updatePendingCount = async () => {
    try {
      const pending = await getAllItems('pendingActions');
      setPendingCount(pending.length);
    } catch (err) {
      console.error(err);
    }
  };

  const handleReconnectSync = async () => {
    const token = getToken();
    if (!token) return;

    setIsSyncing(true);
    try {
      const res = await synchronizePendingActions(BACKEND_URL, token, (processed, total, type) => {
        setSyncProgress({ processed, total, type });
      });
      
      if (res.success && res.count > 0) {
        console.log(`[Sync Engine] Replayed ${res.count} transactions successfully.`);
      } else if (!res.success) {
        console.error('[Sync Engine] Synced aborted due to:', res.error);
      }
    } catch (err) {
      console.error('[Sync Engine] Sync failed:', err);
    } finally {
      setIsSyncing(false);
      await updatePendingCount();
    }
  };

  const fetchReports = async () => {
    try {
      const token = getToken();
      const response = await fetch(`${BACKEND_URL}/api/reports`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setReports(data.reports || []);
      }
    } catch (err) {
      console.error('Failed to fetch historical reports:', err);
    }
  };

  const fetchNotificationLogs = async () => {
    try {
      const token = getToken();
      const response = await fetch(`${BACKEND_URL}/api/notifications/logs`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setNotificationLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Failed to fetch notification logs:', err);
    }
  };

  useEffect(() => {
    // Auth Guard
    const token = getToken();
    const user = getUser();
    if (!token || user.role !== 'receptionist') {
      navigate('/login');
      return;
    }

    // Initialize Local DB stores
    initDB().then(() => {
      updatePendingCount();
      loadCachedState();
    });

    const newSocket = io(BACKEND_URL, {
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    setSocket(newSocket);

    newSocket.on('connect', async () => {
      setIsConnected(true);
      await handleReconnectSync();
      fetchLatestState();
      fetchReports();
      fetchNotificationLogs();
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
    });

    newSocket.on('queue-updated', (newState) => {
      setQueueState(newState);
      setAvgTimeInput(newState.avgConsultationTime.toString());
      cacheSystemState(newState);
      updatePendingCount();
    });

    newSocket.on('notification-logged', (newLog) => {
      setNotificationLogs(prev => [newLog, ...prev].slice(0, 50));
    });

    return () => {
      newSocket.disconnect();
    };
  }, [navigate]);

  // Voice announcement hook on token updates
  useEffect(() => {
    const current = queueState.currentToken;
    if (voiceEnabled && current && current !== "0" && current !== 0 && current !== lastAnnouncedToken.current) {
      const servingVisit = queueState.visits.find(v => v.status === 'serving');
      const lang = servingVisit?.patientId?.preferredLanguage || 'English';
      announceToken(current, lang);
      lastAnnouncedToken.current = current;
    }
  }, [queueState.currentToken, voiceEnabled, queueState.visits]);

  // Phone lookup auto-complete with local search fallback
  useEffect(() => {
    if (phone.length === 10) {
      handleLookupPatient();
    } else {
      setPatientLookupFound(null);
      setExistingPatientObj(null);
    }
  }, [phone]);

  const handleLookupPatient = async () => {
    // 1. Try local cache lookup first
    try {
      const cachedPatients = await getAllItems('patients');
      const matched = cachedPatients.find(p => p.phone === phone);
      if (matched) {
        setName(matched.name);
        setAge(matched.age);
        setGender(matched.gender);
        setPreferredLanguage(matched.preferredLanguage || 'English');
        setNotificationPreference(matched.notificationPreference || 'sms');
        setAddress(matched.address || '');
        setEmergencyContact(matched.emergencyContact || '');
        setBloodGroup(matched.bloodGroup || 'A+');
        setExistingPatientObj(matched);
        setPatientLookupFound('found');
        return;
      }
    } catch (err) {
      console.error('Local lookup failed:', err);
    }

    // 2. Online search fallback
    if (!isConnected) {
      setPatientLookupFound('not_found');
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/register-patient`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ phone })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        if (!data.isNew) {
          setName(data.patient.name);
          setAge(data.patient.age);
          setGender(data.patient.gender);
          setPreferredLanguage(data.patient.preferredLanguage || 'English');
          setNotificationPreference(data.patient.notificationPreference || 'sms');
          setAddress(data.patient.address || '');
          setEmergencyContact(data.patient.emergencyContact || '');
          setBloodGroup(data.patient.bloodGroup || 'A+');
          setExistingPatientObj(data.patient);
          setPatientLookupFound('found');
          await saveItem('patients', data.patient);
        } else {
          setPatientLookupFound('not_found');
          setExistingPatientObj(null);
        }
      }
    } catch (error) {
      console.error('Phone lookup error:', error);
      setPatientLookupFound('not_found');
    }
  };

  // Register & Add visit
  const handleIntakeSubmit = async (e) => {
    e.preventDefault();
    if (!phone || !name || !age || !gender) return;

    let activePatient = existingPatientObj;
    
    // Offline / Local registration
    if (!isConnected) {
      // 1. Create or Update Patient locally
      if (!activePatient) {
        const tempPatientId = `temp-pat-${Date.now()}`;
        activePatient = {
          _id: tempPatientId,
          patientId: `QC-TEMP-${Date.now().toString().slice(-4)}`,
          name,
          age: parseInt(age, 10),
          gender,
          phone,
          address,
          emergencyContact,
          bloodGroup,
          preferredLanguage,
          notificationPreference
        };
        await saveItem('patients', activePatient);
        await addPendingAction('REGISTER_PATIENT', {
          tempId: tempPatientId,
          name,
          age: parseInt(age, 10),
          gender,
          phone,
          address,
          emergencyContact,
          bloodGroup,
          preferredLanguage,
          notificationPreference
        });
      } else {
        // Matched profile exists but might have modified preferredLanguage or notificationPreference
        activePatient.preferredLanguage = preferredLanguage;
        activePatient.notificationPreference = notificationPreference;
        await saveItem('patients', activePatient);
        await addPendingAction('REGISTER_PATIENT', {
          tempId: activePatient._id,
          name: activePatient.name,
          age: activePatient.age,
          gender: activePatient.gender,
          phone: activePatient.phone,
          address: activePatient.address,
          emergencyContact: activePatient.emergencyContact,
          bloodGroup: activePatient.bloodGroup,
          preferredLanguage,
          notificationPreference
        });
      }

      // 2. Create Visit locally
      const tempVisitId = `temp-visit-${Date.now()}`;
      const localVisits = await getAllItems('visits');
      const maxTokenSeq = localVisits.reduce((max, v) => (v.tokenSeq || 0) > max ? (v.tokenSeq || 0) : max, 0);
      const nextSeq = maxTokenSeq + 1;
      const nextTokenStr = "A" + (100 + nextSeq);

      const localVisit = {
        _id: tempVisitId,
        visitId: tempVisitId,
        patientId: activePatient,
        tokenNumber: nextTokenStr,
        tokenSeq: nextSeq,
        reasonForVisit,
        priority: priority === 'Urgent' ? 'Normal' : 'Normal', // emergency overrides pending doctor approval
        priorityPendingApproval: priority,
        status: 'waiting',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await saveItem('visits', localVisit);
      await addPendingAction('ADD_VISIT', {
        tempId: tempVisitId,
        patientId: activePatient._id,
        reasonForVisit,
        priority
      });

      // Update local state immediately
      setQueueState(prev => ({
        ...prev,
        visits: [...prev.visits, localVisit]
      }));

      // Show receipt
      setActiveReceipt({
        patient: activePatient,
        visit: localVisit
      });

      // Auto-trigger WhatsApp dispatch immediately after registered
      try {
        const phoneNum = activePatient.phone;
        if (phoneNum) {
          const formattedPhone = phoneNum.startsWith('+') || (phoneNum.startsWith('91') && phoneNum.length > 10)
            ? phoneNum 
            : '91' + phoneNum;
          const lang = activePatient.preferredLanguage || 'English';
          const templates = TRANSLATIONS[lang] || TRANSLATIONS['English'];
          const template = templates.tokenCreated || TRANSLATIONS['English'].tokenCreated || '';
          
          const waitTime = localVisit.predictedWaitTime || queueState.avgConsultationTime || 10;
          const msg = template
            .replace(/{{name}}/g, activePatient.name || 'Patient')
            .replace(/{{token}}/g, localVisit.tokenNumber)
            .replace(/{{reason}}/g, reasonForVisit || 'General Checkup')
            .replace(/{{wait}}/g, waitTime);
            
          window.open(`https://web.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(msg)}`, '_blank');
        }
      } catch (err) {
        console.error('Failed to auto-open WhatsApp:', err);
      }

      // Reset fields
      resetIntakeForm();
      updatePendingCount();
      return;
    }

    // Online registration path
    try {
      // 1. Register or update profile
      const response = await fetch(`${BACKEND_URL}/api/register-patient`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ name, age, gender, phone, address, emergencyContact, bloodGroup, preferredLanguage, notificationPreference })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        activePatient = data.patient;
        await saveItem('patients', data.patient);
      } else {
        alert(data.error || 'Failed to register patient profile.');
        return;
      }

      // 2. Add visit
      const visitResponse = await fetch(`${BACKEND_URL}/api/add-visit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({
          patientId: activePatient._id,
          reasonForVisit,
          priority
        })
      });
      const visitData = await visitResponse.json();

      if (visitResponse.ok && visitData.success) {
        setActiveReceipt({
          patient: activePatient,
          visit: visitData.visit
        });

        // Auto-trigger WhatsApp dispatch immediately after registered
        try {
          const phoneNum = activePatient.phone;
          if (phoneNum) {
            const formattedPhone = phoneNum.startsWith('+') || (phoneNum.startsWith('91') && phoneNum.length > 10)
              ? phoneNum 
              : '91' + phoneNum;
            const lang = activePatient.preferredLanguage || 'English';
            const templates = TRANSLATIONS[lang] || TRANSLATIONS['English'];
            const template = templates.tokenCreated || TRANSLATIONS['English'].tokenCreated || '';
            
            const waitTime = visitData.visit.predictedWaitTime || queueState.avgConsultationTime || 10;
            const msg = template
              .replace(/{{name}}/g, activePatient.name || 'Patient')
              .replace(/{{token}}/g, visitData.visit.tokenNumber)
              .replace(/{{reason}}/g, reasonForVisit || 'General Checkup')
              .replace(/{{wait}}/g, waitTime);

            window.open(`https://web.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(msg)}`, '_blank');
          }
        } catch (err) {
          console.error('Failed to auto-open WhatsApp:', err);
        }

        resetIntakeForm();
      } else {
        alert(visitData.error || 'Failed to queue patient visit.');
      }
    } catch (error) {
      console.error('Submit intake error:', error);
      alert('Local network connection failure.');
    }
  };

  const resetIntakeForm = () => {
    setPhone('');
    setName('');
    setAge('');
    setGender('Male');
    setAddress('');
    setEmergencyContact('');
    setBloodGroup('A+');
    setPreferredLanguage('English');
    setNotificationPreference('sms');
    setReasonForVisit('');
    setPriority('Normal');
    setPatientLookupFound(null);
    setExistingPatientObj(null);
  };

  const handleCallNext = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/call-next`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        }
      });
      const data = await response.json();
      if (!response.ok) {
        alert(data.error || 'Failed to call next patient.');
      }
    } catch (error) {
      console.error('Call next error:', error);
    }
  };

  const handleSkipActive = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/skip-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        }
      });
      const data = await response.json();
      if (!response.ok) {
        alert(data.error || 'Failed to skip active patient.');
      }
    } catch (error) {
      console.error('Skip active error:', error);
    }
  };

  const handleCompleteActive = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/complete-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        }
      });
      const data = await response.json();
      if (!response.ok) {
        alert(data.error || 'Failed to complete active patient.');
      }
    } catch (error) {
      console.error('Complete active error:', error);
    }
  };

  const handleUpdateAvgTime = async (e) => {
    e.preventDefault();
    const time = parseInt(avgTimeInput, 10);
    if (isNaN(time) || time < 1) return;

    try {
      const response = await fetch(`${BACKEND_URL}/api/set-time`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ avgConsultationTime: time })
      });
      if (!response.ok) {
        alert('Failed to update average duration settings.');
      }
    } catch (error) {
      console.error('Settings update error:', error);
    }
  };

  const handlePrintSlip = () => {
    window.print();
  };

  // Metric aggregates
  const waitingVisits = queueState.visits.filter(v => v.status === 'waiting');
  const servingVisit = queueState.visits.find(v => v.status === 'serving');
  const completedCount = queueState.visits.filter(v => v.status === 'completed').length;
  
  let nextUpVisit = waitingVisits.find(v => v.priority === 'Urgent');
  if (!nextUpVisit) {
    nextUpVisit = waitingVisits.find(v => v.priority === 'Normal');
  }

  // Predictive Wait Time Calculation
  const estWaitTime = waitingVisits.reduce((acc, v) => acc + (v.predictedWaitTime || queueState.avgConsultationTime), 0);

  // SVG Chart Computations
  const getHourlyLoadData = () => {
    const hours = Array(9).fill(0); // 9am - 5pm
    queueState.visits.forEach(v => {
      const createdHour = new Date(v.createdAt).getHours();
      if (createdHour >= 9 && createdHour <= 17) {
        hours[createdHour - 9]++;
      }
    });
    return hours;
  };

  const getTriageDistribution = () => {
    let urgent = 0;
    let normal = 0;
    queueState.visits.forEach(v => {
      if (v.priority === 'Urgent' || v.priorityPendingApproval === 'Urgent') urgent++;
      else normal++;
    });
    return { urgent, normal };
  };

  const getScannedUrl = (visitId) => {
    const origin = window.location.origin;
    const localIp = queueState.localIp;
    if (localIp && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      return origin.replace('localhost', localIp).replace('127.0.0.1', localIp) + '/patient-queue/' + visitId;
    }
    return origin + '/patient-queue/' + visitId;
  };

  const hourlyData = getHourlyLoadData();
  const triageData = getTriageDistribution();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col bg-grid-pattern relative">
      <Navbar />

      {/* Local Print Slip View */}
      {activeReceipt && (
        <div className="hidden print:block print:p-8 text-black bg-white min-h-screen text-center font-mono">
          <div className="border-4 border-black p-6 rounded-md">
            <h1 className="text-3xl font-extrabold tracking-wider">QUEUE CURE</h1>
            <p className="text-sm mt-1">OFFLINE CLINIC SYSTEM</p>
            <hr className="border-black border-dashed my-4" />
            <p className="text-lg">PRIORITY: <strong>{activeReceipt.visit.priorityPendingApproval || activeReceipt.visit.priority}</strong></p>
            <p className="text-xl">YOUR TOKEN NUMBER</p>
            <div className="text-8xl font-black my-4">#{activeReceipt.visit.tokenNumber}</div>
            <hr className="border-black border-dashed my-4" />
            <div className="text-left space-y-1">
              <p><strong>PATIENT ID:</strong> {activeReceipt.patient.patientId}</p>
              <p><strong>NAME:</strong> {activeReceipt.patient.name}</p>
              <p><strong>LANG:</strong> {activeReceipt.patient.preferredLanguage || 'English'}</p>
              <p><strong>PHONE:</strong> {activeReceipt.patient.phone}</p>
              <p><strong>DATE:</strong> {new Date(activeReceipt.visit.createdAt).toLocaleDateString()}</p>
              <p><strong>EST. WAIT:</strong> ~{activeReceipt.visit.predictedWaitTime || queueState.avgConsultationTime} mins</p>
            </div>
            <hr className="border-black border-dashed my-4" />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', margin: '15px 0' }}>
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(getScannedUrl(activeReceipt.visit._id))}`}
                alt="Dashboard QR Code"
                style={{ width: '100px', height: '100px', border: '1px solid black', padding: '4px' }}
              />
              <p style={{ fontSize: '10px', marginTop: '4px', fontWeight: 'bold' }}>Scan to track your live queue status</p>
            </div>
            <hr className="border-black border-dashed my-4" />
            <p className="text-xs">Watch the TV display board in the OPD lobby.</p>
          </div>
        </div>
      )}

      {/* Tab Navigation header */}
      <div className="bg-slate-900/60 border-b border-slate-850 px-6 py-2 flex items-center justify-between gap-4 print:hidden">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeTab === 'dashboard'
                ? 'bg-blue-600 text-white shadow-lg'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            Dashboard
          </button>
          <button
            onClick={() => {
              setActiveTab('analytics');
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
              activeTab === 'analytics'
                ? 'bg-blue-600 text-white shadow-lg'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Analytics View
          </button>
          <button
            onClick={() => {
              setActiveTab('reports');
              fetchReports();
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
              activeTab === 'reports'
                ? 'bg-blue-600 text-white shadow-lg'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Archived Reports
          </button>
        </div>

        {/* Sync Indicator */}
        <div className="flex items-center gap-4">
          {pendingCount > 0 && (
            <span className="bg-amber-950 text-amber-400 border border-amber-500/20 text-[10px] px-2.5 py-1 rounded-full font-bold uppercase animate-pulse">
              {pendingCount} offline actions pending
            </span>
          )}
          
          {/* Audio Activation Button */}
          <button
            type="button"
            onClick={voiceEnabled ? () => setVoiceEnabled(false) : enableAudioAnnouncements}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-bold text-[10px] uppercase tracking-wider transition shadow-sm border ${
              voiceEnabled
                ? 'bg-blue-900/50 text-blue-400 border-blue-500/30'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-850'
            }`}
          >
            {voiceEnabled ? (
              <>
                <Volume2 className="w-3.5 h-3.5 text-blue-400" />
                <span>Audio Enabled</span>
              </>
            ) : (
              <>
                <VolumeX className="w-3.5 h-3.5 text-slate-500" />
                <span>Activate Audio</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`} />
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              {isConnected ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
      </div>

      {isSyncing && (
        <div className="bg-blue-900/40 border-b border-blue-500/30 px-6 py-2.5 text-center text-xs text-blue-300 font-medium flex items-center justify-center gap-2 animate-pulse print:hidden">
          <span>Reconnecting to Server: Replaying {syncProgress.processed}/{syncProgress.total} transactions ({syncProgress.type})...</span>
        </div>
      )}

      {/* Main Tab Views */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 print:hidden">
        
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left Column (7 cols): Registration & Controllers */}
            <div className="lg:col-span-7 flex flex-col gap-6">
              
              <StatCards 
                total={queueState.visits.length} 
                waiting={waitingVisits.length} 
                completed={completedCount} 
              />

              {/* Triage Controller */}
              <div className="glass-premium rounded-2xl p-6 relative overflow-hidden">
                <div className="absolute right-0 top-0 -mt-6 -mr-6 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl" />
                <h2 className="text-slate-400 text-xs font-semibold tracking-wider uppercase mb-3">Triage Controller</h2>
                
                <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                  <div>
                    <div className="text-slate-400 text-sm">Currently serving token</div>
                    <div className="flex items-center gap-3 mt-1">
                      <div className="text-5xl font-black text-blue-500 glow-blue font-mono">
                        {servingVisit ? `#${servingVisit.tokenNumber}` : 'None'}
                      </div>
                      {servingVisit && (
                        <button
                          type="button"
                          onClick={() => {
                            if (!voiceEnabled) {
                              setVoiceEnabled(true);
                            }
                            announceToken(servingVisit.tokenNumber, servingVisit.patientId?.preferredLanguage || 'English');
                          }}
                          title="Call/Announce Patient"
                          className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-blue-400 hover:text-blue-300 transition-colors shadow-sm"
                        >
                          <Volume2 className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                    {servingVisit && (
                      <p className="text-xs text-slate-300 mt-2">
                        Patient: <strong className="text-white">{servingVisit.patientId?.name}</strong>
                      </p>
                    )}
                    {nextUpVisit ? (
                      <p className="text-xs text-slate-400 mt-1.5">
                        Next in line: <strong className="text-white">{nextUpVisit.patientId?.name}</strong> 
                        {nextUpVisit.priority === 'Urgent' ? (
                          <span className="ml-2 bg-red-950 text-red-400 border border-red-500/30 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">Urgent</span>
                        ) : (
                          <span className="ml-2 bg-slate-800 text-slate-400 text-[10px] px-2 py-0.5 rounded-full font-semibold">Normal</span>
                        )}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500 mt-2">No other patients waiting</p>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto items-center">
                    {servingVisit && (
                      <>
                        <button
                          onClick={handleSkipActive}
                          className="w-full sm:w-auto px-5 py-3.5 rounded-xl font-bold text-sm bg-rose-950/70 text-rose-400 border border-rose-500/20 shadow-lg transition-all hover:scale-[1.01] active:scale-[0.99]"
                        >
                          Skip Active
                        </button>
                        <button
                          onClick={handleCompleteActive}
                          className="w-full sm:w-auto px-5 py-3.5 rounded-xl font-bold text-sm bg-emerald-950/70 text-emerald-400 border border-emerald-500/20 shadow-lg transition-all hover:scale-[1.01] active:scale-[0.99]"
                        >
                          Complete
                        </button>
                      </>
                    )}
                    
                    <button
                      onClick={handleCallNext}
                      disabled={waitingVisits.length === 0}
                      className={`w-full sm:w-auto px-8 py-5 rounded-xl font-bold text-lg flex items-center justify-center gap-3 shadow-lg transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] ${
                        waitingVisits.length === 0
                          ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                          : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/20'
                      }`}
                    >
                      <Play className="w-5 h-5 fill-current" />
                      Call Next Patient
                    </button>
                  </div>
                </div>
              </div>

              {/* Registration intake form */}
              <div className="glass-premium rounded-2xl p-6">
                <h2 className="text-white text-lg font-bold flex items-center gap-2 mb-4">
                  <UserPlus className="w-5 h-5 text-blue-500" />
                  Patient Registration & Intake
                </h2>

                <form onSubmit={handleIntakeSubmit} className="space-y-4">
                  
                  {/* Phone and autocomplete check */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-slate-400 text-xs font-semibold uppercase mb-1.5">Mobile Number *</label>
                      <div className="relative">
                        <input
                          type="tel"
                          required
                          maxLength="10"
                          placeholder="Enter 10-digit phone"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition font-mono"
                        />
                        {patientLookupFound === 'found' && (
                          <span className="absolute right-3 top-3.5 bg-emerald-950 text-emerald-400 text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/20 font-bold uppercase animate-pulse">
                            Matched profile
                          </span>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-slate-400 text-xs font-semibold uppercase mb-1.5">Patient Name *</label>
                      <input
                        type="text"
                        required
                        placeholder="Enter patient full name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={patientLookupFound === 'found'}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 disabled:opacity-60 transition"
                      />
                    </div>
                  </div>

                  {/* Demographics row */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-slate-400 text-xs font-semibold uppercase mb-1.5">Age *</label>
                      <input
                        type="number"
                        required
                        min="1"
                        max="120"
                        placeholder="Enter age"
                        value={age}
                        onChange={(e) => setAge(e.target.value)}
                        disabled={patientLookupFound === 'found'}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 disabled:opacity-60 transition"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-400 text-xs font-semibold uppercase mb-1.5">Gender *</label>
                      <select
                        value={gender}
                        onChange={(e) => setGender(e.target.value)}
                        disabled={patientLookupFound === 'found'}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-blue-500 disabled:opacity-60 transition"
                      >
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-slate-400 text-xs font-semibold uppercase mb-1.5">Blood Group</label>
                      <select
                        value={bloodGroup}
                        onChange={(e) => setBloodGroup(e.target.value)}
                        disabled={patientLookupFound === 'found'}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-blue-500 disabled:opacity-60 transition"
                      >
                        <option value="A+">A+</option>
                        <option value="A-">A-</option>
                        <option value="B+">B+</option>
                        <option value="B-">B-</option>
                        <option value="AB+">AB+</option>
                        <option value="AB-">AB-</option>
                        <option value="O+">O+</option>
                        <option value="O-">O-</option>
                      </select>
                    </div>
                  </div>

                  {/* preferred language + emergency contact */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-slate-400 text-xs font-semibold uppercase mb-1.5">Preferred Language *</label>
                      <select
                        value={preferredLanguage}
                        onChange={(e) => setPreferredLanguage(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-blue-500 disabled:opacity-60 transition"
                      >
                        <option value="English">English</option>
                        <option value="Tamil">Tamil (தமிழ்)</option>
                        <option value="Hindi">Hindi (हिन्दी)</option>
                        <option value="Telugu">Telugu (తెలుగు)</option>
                        <option value="Kannada">Kannada (ಕನ್ನಡ)</option>
                        <option value="Malayalam">Malayalam (മലയാളം)</option>
                      </select>
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-slate-400 text-xs font-semibold uppercase mb-1.5">Emergency Contact</label>
                      <input
                        type="tel"
                        placeholder="Emergency contact phone"
                        value={emergencyContact}
                        onChange={(e) => setEmergencyContact(e.target.value)}
                        disabled={patientLookupFound === 'found'}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 disabled:opacity-60 transition font-mono"
                      />
                    </div>
                  </div>

                  {/* Address */}
                  <div>
                    <label className="block text-slate-400 text-xs font-semibold uppercase mb-1.5">Home Address</label>
                    <input
                      type="text"
                      placeholder="Enter patient full residential address"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      disabled={patientLookupFound === 'found'}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 disabled:opacity-60 transition"
                    />
                  </div>

                  <hr className="border-slate-850 my-4" />

                  {/* Visit Details */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-slate-400 text-xs font-semibold uppercase mb-1.5">Reason for Visit</label>
                      <input
                        type="text"
                        placeholder="Symptoms or checkup reason (e.g. fever, headache)"
                        value={reasonForVisit}
                        onChange={(e) => setReasonForVisit(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-400 text-xs font-semibold uppercase mb-1.5">Triage Priority *</label>
                      <select
                        value={priority}
                        onChange={(e) => setPriority(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-blue-500 transition font-bold"
                      >
                        <option value="Normal">Normal Queue</option>
                        <option value="Urgent">🔴 Urgent (Pending Approval)</option>
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3.5 px-4 rounded-xl shadow-lg shadow-blue-600/20 transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2"
                  >
                    <Plus className="w-5 h-5" />
                    Register & Print Token Slip
                  </button>

                </form>
              </div>

            </div>

            {/* Right Column (5 cols): Live queue list & settings */}
            <div className="lg:col-span-5 flex flex-col gap-6">
              
              {/* Settings */}
              <div className="glass-premium rounded-2xl p-6">
                <h2 className="text-white text-lg font-bold flex items-center gap-2 mb-3">
                  <Settings className="w-5 h-5 text-slate-400" />
                  Clinic Settings
                </h2>
                <form onSubmit={handleUpdateAvgTime} className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-slate-400 text-xs font-semibold uppercase mb-1">Avg Consultation (Mins)</label>
                    <input
                      type="number"
                      min="1"
                      value={avgTimeInput}
                      onChange={(e) => setAvgTimeInput(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500 transition font-mono"
                    />
                  </div>
                  <button
                    type="submit"
                    className="self-end bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-750 font-medium py-2.5 px-5 rounded-xl transition"
                  >
                    Apply
                  </button>
                </form>
              </div>

              {/* Active Queue Line Board */}
              <div className="glass-premium rounded-2xl p-6 flex-1 flex flex-col overflow-hidden max-h-[500px]">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-white text-lg font-bold">Live Patient Queue Line</h2>
                  <span className="text-xs text-yellow-500 font-bold font-mono">~{estWaitTime} mins wait total</span>
                </div>
                
                <div className="overflow-y-auto flex-1 pr-1 space-y-2.5 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
                  {queueState.visits.length === 0 ? (
                    <div className="h-32 flex flex-col items-center justify-center text-slate-500 text-sm">
                      <span>Queue is currently empty.</span>
                    </div>
                  ) : (
                    queueState.visits.map((visit) => {
                      const isCurrentlyServing = visit.status === 'serving';
                      const isCalled = visit.status === 'completed' || visit.status === 'absent' || visit.status === 'skipped';
                      const isPendingEmergency = visit.priorityPendingApproval === 'Urgent' && visit.priority !== 'Urgent';

                      return (
                        <div 
                          key={visit._id}
                          className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                            isCurrentlyServing 
                              ? 'bg-blue-950/40 border-blue-500/40' 
                              : isCalled 
                                ? 'bg-slate-900/40 border-slate-850/40 opacity-50' 
                                : 'bg-slate-900/60 border-slate-850'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm font-mono ${
                              isCurrentlyServing 
                                ? 'bg-blue-600 text-white' 
                                : isCalled 
                                  ? 'bg-slate-800 text-slate-400' 
                                  : 'bg-slate-800 text-blue-400'
                            }`}>
                              #{visit.tokenNumber}
                            </div>
                            <div>
                              <p className="font-bold text-slate-200 text-sm">{visit.patientId?.name}</p>
                              <p className="text-[10px] text-slate-500 font-mono">
                                ID: {visit.patientId?.patientId} • Lang: {visit.patientId?.preferredLanguage || 'English'}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2.5">
                            {/* WhatsApp Direct Dispatch Icon */}
                            {visit.patientId?.phone && !isCalled && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const phoneNum = visit.patientId.phone;
                                  const formattedPhone = phoneNum.startsWith('+') || (phoneNum.startsWith('91') && phoneNum.length > 10)
                                    ? phoneNum 
                                    : '91' + phoneNum;
                                  const lang = visit.patientId.preferredLanguage || 'English';
                                  const templates = TRANSLATIONS[lang] || TRANSLATIONS['English'];
                                  const template = templates.approaching || TRANSLATIONS['English'].approaching || '';
                                  
                                  const ahead = Math.max(1, (visit.tokenSeq || 0) - (queueState.currentTokenSeq || 0));
                                  const msg = template
                                    .replace(/{{name}}/g, visit.patientId.name || 'Patient')
                                    .replace(/{{token}}/g, visit.tokenNumber)
                                    .replace(/{{ahead}}/g, ahead);

                                  window.open(`https://web.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(msg)}`, '_blank');
                                }}
                                title="Send live WhatsApp queue update"
                                className="p-1 text-emerald-500 hover:text-emerald-400 hover:scale-105 active:scale-95 transition-all"
                              >
                                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.513 2.262 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.825 1.451 5.436 0 9.86-4.37 9.864-9.799.002-2.63-1.023-5.101-2.885-6.965C16.528 2.01 14.069.988 11.99 1.002c-5.438 0-9.863 4.37-9.867 9.8-.001 1.787.478 3.53 1.387 5.078l-1.087 3.97 4.137-1.077z" />
                                </svg>
                              </button>
                            )}

                            {isPendingEmergency && (
                              <span className="bg-amber-950 text-amber-400 border border-amber-500/20 text-[8px] px-1.5 py-0.5 rounded font-bold uppercase animate-pulse">
                                Pending Triage Approval
                              </span>
                            )}
                            {visit.priority === 'Urgent' && !isCalled && (
                              <span className="bg-red-950 text-red-400 border border-red-500/20 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase animate-pulse">
                                Urgent
                              </span>
                            )}
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase border ${
                              isCurrentlyServing 
                                ? 'bg-blue-950 text-blue-400 border-blue-500/20' 
                                : isCalled 
                                  ? 'bg-slate-950 text-slate-500 border-slate-800' 
                                  : 'bg-amber-950 text-amber-400 border-amber-500/20'
                            }`}>
                              {visit.status}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>

          </div>
        )}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-black text-white">OPD Operating Analytics</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              
              {/* Daily Statistics */}
              <div className="md:col-span-4 bg-slate-900/60 border border-slate-850 rounded-2xl p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Patient Queue Ratios</h3>
                  
                  <div className="flex justify-between items-center py-3 border-b border-slate-850">
                    <span className="text-slate-400 text-xs">Waiting Patients</span>
                    <span className="font-bold text-white text-sm font-mono">{waitingVisits.length}</span>
                  </div>
                  <div className="flex justify-between items-center py-3 border-b border-slate-850">
                    <span className="text-slate-400 text-xs">Served Today</span>
                    <span className="font-bold text-emerald-400 text-sm font-mono">{completedCount}</span>
                  </div>
                  <div className="flex justify-between items-center py-3 border-b border-slate-850">
                    <span className="text-slate-400 text-xs">Urgent / Emergency Cases</span>
                    <span className="font-bold text-red-400 text-sm font-mono">{triageData.urgent}</span>
                  </div>
                  <div className="flex justify-between items-center py-3">
                    <span className="text-slate-400 text-xs">Avg Consulting Duration</span>
                    <span className="font-bold text-yellow-500 text-sm font-mono">{queueState.avgConsultationTime} mins</span>
                  </div>
                </div>

                {/* Donut Chart SVG */}
                <div className="mt-6 flex items-center justify-center">
                  <svg width="150" height="150" viewBox="0 0 36 36" className="w-32 h-32">
                    <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#1e293b" strokeWidth="3" />
                    {queueState.visits.length > 0 ? (
                      <>
                        {/* Urgent segment */}
                        <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#ef4444" strokeWidth="4" 
                                strokeDasharray={`${Math.round((triageData.urgent / queueState.visits.length) * 100)} ${100 - Math.round((triageData.urgent / queueState.visits.length) * 100)}`} 
                                strokeDashoffset="25" />
                        {/* Normal segment */}
                        <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#3b82f6" strokeWidth="3.2" 
                                strokeDasharray={`${Math.round((triageData.normal / queueState.visits.length) * 100)} ${100 - Math.round((triageData.normal / queueState.visits.length) * 100)}`} 
                                strokeDashoffset={25 - Math.round((triageData.urgent / queueState.visits.length) * 100)} />
                      </>
                    ) : null}
                    <g className="text-center">
                      <text x="18" y="16.5" className="text-[5px] fill-slate-400 font-bold" textAnchor="middle">Total Visits</text>
                      <text x="18" y="23.5" className="text-[8px] fill-white font-black font-mono" textAnchor="middle">{queueState.visits.length}</text>
                    </g>
                  </svg>
                  <div className="ml-4 space-y-1.5 text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded bg-blue-500" />
                      <span className="text-slate-400">Normal Priority ({triageData.normal})</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded bg-red-500" />
                      <span className="text-slate-400">Urgent Priority ({triageData.urgent})</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Hourly Patient Load (Bar Chart SVG) */}
              <div className="md:col-span-8 bg-slate-900/60 border border-slate-850 rounded-2xl p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2">Hourly Patient Load</h3>
                  <p className="text-xs text-slate-500 mb-6">Patient registration counts grouped by business hour (9:00 AM - 5:00 PM).</p>
                </div>

                <div className="h-64 flex items-end justify-between gap-2 px-4 border-b border-slate-800 pb-2">
                  {hourlyData.map((count, idx) => {
                    const maxVal = Math.max(...hourlyData, 1);
                    const pct = (count / maxVal) * 80; // max height 80%
                    
                    return (
                      <div key={idx} className="flex-1 flex flex-col items-center group relative">
                        <span className="text-[10px] text-blue-400 font-bold font-mono opacity-0 group-hover:opacity-100 transition absolute -top-6">{count}</span>
                        <div 
                          className="w-full bg-gradient-to-t from-blue-600 to-cyan-500 rounded-t-lg transition-all duration-500 group-hover:from-blue-500 group-hover:to-cyan-400 group-hover:shadow-[0_0_15px_-3px_rgba(59,130,246,0.5)]" 
                          style={{ height: `${Math.max(4, pct)}%` }} 
                        />
                        <span className="text-[9px] text-slate-500 font-bold mt-2 font-mono uppercase truncate">{9 + idx}h</span>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>

            {/* Live Notifications Audit Feed */}
            <div className="bg-slate-900/60 border border-slate-850 rounded-2xl p-6 mt-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Live Notifications Audit Log</h3>
                  <p className="text-xs text-slate-500 mt-1">Real-time status of localized messages, WhatsApp alerts, and automated voice dispatches.</p>
                </div>
                <button
                  onClick={fetchNotificationLogs}
                  className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-750 font-medium rounded-xl text-xs transition"
                >
                  Refresh Feed
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 uppercase font-semibold text-[10px] tracking-wider">
                      <th className="py-3 px-4">Time</th>
                      <th className="py-3 px-4">Token</th>
                      <th className="py-3 px-4">Patient</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">Channel</th>
                      <th className="py-3 px-4">Message</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850/60">
                    {notificationLogs.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="py-8 text-center text-slate-500">
                          No notification log entries found.
                        </td>
                      </tr>
                    ) : (
                      notificationLogs.map((log) => {
                        const channelColors = {
                          sms: 'bg-indigo-950 text-indigo-400 border-indigo-500/20',
                          whatsapp: 'bg-emerald-950 text-emerald-400 border-emerald-500/20',
                          voice: 'bg-purple-950 text-purple-400 border-purple-500/20'
                        };
                        const typeColors = {
                          tokenCreated: 'text-blue-400 bg-blue-950/40 border-blue-500/20',
                          approaching: 'text-amber-400 bg-amber-950/40 border-amber-500/20',
                          nowServing: 'text-emerald-400 bg-emerald-950/40 border-emerald-500/20',
                          delayed: 'text-rose-400 bg-rose-950/40 border-rose-500/20',
                          completed: 'text-slate-400 bg-slate-950 border-slate-800',
                          reminder: 'text-fuchsia-400 bg-fuchsia-950/40 border-fuchsia-500/20'
                        };

                        return (
                          <tr key={log._id} className="hover:bg-slate-900/40 transition">
                            <td className="py-3.5 px-4 text-slate-400 font-mono">
                              {new Date(log.sentAt || log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </td>
                            <td className="py-3.5 px-4 font-mono font-bold text-slate-300">
                              #{log.tokenNumber}
                            </td>
                            <td className="py-3.5 px-4">
                              <span className="font-bold text-slate-200 block">{log.patientId?.name || 'Unknown Patient'}</span>
                              <span className="text-[10px] text-slate-500 font-mono">{log.patientId?.phone || 'No phone'}</span>
                            </td>
                            <td className="py-3.5 px-4">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase ${typeColors[log.type] || 'text-slate-400 bg-slate-950 border-slate-800'}`}>
                                {log.type === 'tokenCreated' ? 'Token Gen' : log.type === 'nowServing' ? 'Serving' : log.type}
                              </span>
                            </td>
                            <td className="py-3.5 px-4">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase ${channelColors[log.channel] || 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                                {log.channel}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-slate-300 font-medium max-w-xs truncate" title={log.message}>
                              {log.message}
                            </td>
                            <td className="py-3.5 px-4 flex items-center gap-2">
                              {log.channel === 'whatsapp' ? (
                                <button
                                  onClick={() => {
                                    const phoneNum = log.patientId?.phone || '';
                                    const formattedPhone = phoneNum.startsWith('+') || (phoneNum.startsWith('91') && phoneNum.length > 10)
                                      ? phoneNum 
                                      : '91' + phoneNum;
                                    window.open(`https://web.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(log.message)}`, '_blank');
                                  }}
                                  className="bg-emerald-950 hover:bg-emerald-900 text-emerald-400 border border-emerald-500/30 px-2 py-1 rounded text-[10px] font-bold uppercase transition flex items-center gap-1"
                                >
                                  Send
                                </button>
                              ) : log.channel === 'sms' ? (
                                <button
                                  onClick={() => {
                                    const phoneNum = log.patientId?.phone || '';
                                    const formattedPhone = phoneNum.startsWith('+') || (phoneNum.startsWith('91') && phoneNum.length > 10)
                                      ? phoneNum 
                                      : '91' + phoneNum;
                                    window.open(`sms:${formattedPhone}?body=${encodeURIComponent(log.message)}`, '_blank');
                                  }}
                                  className="bg-blue-950 hover:bg-blue-900 text-blue-400 border border-blue-500/30 px-2 py-1 rounded text-[10px] font-bold uppercase transition flex items-center gap-1"
                                >
                                  Send SMS
                                </button>
                              ) : (
                                <span className="flex items-center gap-1.5 text-slate-400">
                                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                                  <span className="text-[10px] font-bold uppercase tracking-wider">Logged</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* Reports Tab */}
        {activeTab === 'reports' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-black text-white">Clinic Session Archives</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              
              {/* Reports list */}
              <div className="md:col-span-4 bg-slate-900/60 border border-slate-850 rounded-2xl p-5 overflow-hidden max-h-[600px] flex flex-col">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Daily Reports</h3>
                
                <div className="overflow-y-auto flex-1 space-y-2.5 pr-1">
                  {reports.length === 0 ? (
                    <div className="h-32 flex items-center justify-center text-slate-500 text-sm">
                      <span>No archived reports found.</span>
                    </div>
                  ) : (
                    reports.map((report) => (
                      <button
                        key={report._id}
                        onClick={() => setSelectedReport(report)}
                        className={`w-full text-left p-3.5 rounded-xl border transition flex items-center justify-between ${
                          selectedReport && selectedReport._id === report._id
                            ? 'bg-blue-950/40 border-blue-500/40 text-white'
                            : 'bg-slate-900/40 border-slate-850 text-slate-300 hover:bg-slate-900'
                        }`}
                      >
                        <div>
                          <div className="text-sm font-bold flex items-center gap-1.5">
                            <Calendar className="w-4 h-4 text-blue-400" />
                            <span>{report.date}</span>
                          </div>
                          <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                            Served: {report.patientsServed} • Wait: {report.avgWaitTime}m
                          </p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-slate-500" />
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Selected Report details */}
              <div className="md:col-span-8 bg-slate-900/40 border border-slate-850 rounded-2xl p-6 min-h-[400px] flex flex-col justify-between">
                {selectedReport ? (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                      <div>
                        <h3 className="text-xl font-bold text-white">Daily Operational Summary</h3>
                        <p className="text-xs text-slate-500">Archive session date: {selectedReport.date}</p>
                      </div>
                      
                      <button
                        onClick={() => {
                          // Trigger window print of report content specifically
                          const printWindow = window.open('', '_blank');
                          printWindow.document.write(`
                            <html>
                              <head>
                                <title>Daily Clinic Summary - ${selectedReport.date}</title>
                                <style>
                                  body { font-family: monospace; padding: 40px; color: black; line-height: 1.6; }
                                  .border { border: 4px solid black; padding: 25px; border-radius: 8px; }
                                  h1 { text-align: center; font-size: 24px; margin-bottom: 5px; }
                                  h2 { text-align: center; font-size: 14px; margin-top: 0; }
                                  hr { border: 1px dashed black; margin: 20px 0; }
                                  .metric { display: flex; justify-content: space-between; font-size: 15px; margin: 10px 0; }
                                </style>
                              </head>
                              <body>
                                <div class="border">
                                  <h1>QUEUE CURE Daily report</h1>
                                  <h2>Date: ${selectedReport.date}</h2>
                                  <hr />
                                  <div class="metric"><strong>PATIENTS SERVED:</strong> <span>${selectedReport.patientsServed}</span></div>
                                  <div class="metric"><strong>AVERAGE WAITING TIME:</strong> <span>${selectedReport.avgWaitTime} mins</span></div>
                                  <div class="metric"><strong>EMERGENCY OVERRIDES LOGGED:</strong> <span>${selectedReport.emergencyCases}</span></div>
                                  <div class="metric"><strong>DOCTOR CONSULTATION COUNT:</strong> <span>${selectedReport.consultationCount}</span></div>
                                  <div class="metric"><strong>DOCTOR WORKDAY UTILIZATION:</strong> <span>${selectedReport.doctorUtilization}%</span></div>
                                  <hr />
                                  <div style="text-align: center; font-size: 10px; margin-top: 40px;">
                                    Queue Cure Clinic Analytics Audit Slip. Archive saved historically.
                                  </div>
                                </div>
                                <script>window.print();</script>
                              </body>
                            </html>
                          `);
                          printWindow.document.close();
                        }}
                        className="bg-slate-800 hover:bg-slate-700 text-white border border-slate-750 font-semibold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        Print Audit Slip
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="bg-slate-900/60 border border-slate-850 p-4 rounded-xl text-center">
                        <span className="text-slate-500 text-[10px] uppercase font-bold block">Patients Served</span>
                        <span className="text-3xl font-black text-white block mt-1.5 font-mono">{selectedReport.patientsServed}</span>
                      </div>
                      <div className="bg-slate-900/60 border border-slate-850 p-4 rounded-xl text-center">
                        <span className="text-slate-500 text-[10px] uppercase font-bold block">Average Wait Time</span>
                        <span className="text-3xl font-black text-yellow-500 block mt-1.5 font-mono">{selectedReport.avgWaitTime} <span className="text-sm font-semibold text-slate-400">mins</span></span>
                      </div>
                      <div className="bg-slate-900/60 border border-slate-850 p-4 rounded-xl text-center">
                        <span className="text-slate-500 text-[10px] uppercase font-bold block">Emergency Override Cases</span>
                        <span className="text-3xl font-black text-rose-500 block mt-1.5 font-mono">{selectedReport.emergencyCases}</span>
                      </div>
                    </div>

                    <div className="bg-slate-900/60 border border-slate-850 rounded-xl p-5 space-y-3.5 text-xs text-slate-300">
                      <div className="flex justify-between items-center border-b border-slate-850/60 pb-2.5">
                        <span>Total Consultation Files Written:</span>
                        <strong className="text-white font-mono">{selectedReport.consultationCount}</strong>
                      </div>
                      <div className="flex justify-between items-center border-b border-slate-850/60 pb-2.5">
                        <span>Doctor Utilization Rating:</span>
                        <strong className="text-emerald-400 font-mono">{selectedReport.doctorUtilization}%</strong>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Session reset performed:</span>
                        <strong className="text-slate-400 font-mono">Archive Success (Secure)</strong>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm">
                    <BookOpen className="w-10 h-10 text-slate-700 mb-2" />
                    <span>Select an archived session date from the sidebar to inspect clinic report statistics.</span>
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

      </main>

      {/* Slip Print Modal popup */}
      {activeReceipt && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
            <button 
              onClick={() => setActiveReceipt(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="text-center">
              <div className="w-12 h-12 bg-emerald-950 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-3 border border-emerald-500/20">
                <CheckCircle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Registration Successful</h3>
              <p className="text-xs text-slate-400">Queue token ticket generated.</p>
              
              <div className="my-6 bg-slate-950 border border-slate-800 rounded-xl p-5 text-left font-mono relative overflow-hidden">
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-3.5 h-6 bg-slate-900 rounded-r-full border-r border-y border-slate-800 -ml-0.5" />
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-6 bg-slate-900 rounded-l-full border-l border-y border-slate-800 -mr-0.5" />
                
                <h4 className="text-center font-bold text-slate-400 text-xs tracking-wider uppercase">PATIENT VISIT SLIP</h4>
                <hr className="border-slate-800 border-dashed my-3" />
                <div className="text-center my-4">
                  <span className="text-slate-500 text-[10px] uppercase block mb-1">Queue Token</span>
                  <div className="text-5xl font-black text-white">#{activeReceipt.visit.tokenNumber}</div>
                  <span className="mt-1 inline-block bg-blue-950 text-blue-400 text-[9px] px-2 py-0.5 rounded border border-blue-500/25 uppercase font-bold">
                    {activeReceipt.visit.priorityPendingApproval || activeReceipt.visit.priority} Priority
                  </span>
                </div>
                <hr className="border-slate-800 border-dashed my-3" />
                <div className="space-y-1 text-xs text-slate-400">
                  <p><strong className="text-slate-200">Patient ID:</strong> {activeReceipt.patient.patientId}</p>
                  <p><strong className="text-slate-200">Name:</strong> {activeReceipt.patient.name}</p>
                  <p><strong className="text-slate-200">Lang:</strong> {activeReceipt.patient.preferredLanguage || 'English'}</p>
                  <p><strong className="text-slate-200">Phone:</strong> {activeReceipt.patient.phone}</p>
                  <p><strong className="text-slate-200">Reason:</strong> {activeReceipt.visit.reasonForVisit || 'Regular checkup'}</p>
                  <p><strong className="text-slate-200">Est. Wait:</strong> ~{activeReceipt.visit.predictedWaitTime || queueState.avgConsultationTime} mins</p>
                </div>
                <hr className="border-slate-850 border-dashed my-3" />
                <div className="flex flex-col items-center justify-center my-3">
                  <img 
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(getScannedUrl(activeReceipt.visit._id))}`}
                    alt="Dashboard QR Code"
                    className="w-24 h-24 border border-slate-800 p-1 bg-white"
                  />
                  <p className="text-[9px] text-slate-500 mt-1 uppercase tracking-wider font-semibold">Scan to track your live queue status</p>
                </div>
              </div>

              <div className="flex gap-3">
                {activeReceipt.patient.phone && (
                  <button
                    onClick={() => {
                      const phoneNum = activeReceipt.patient.phone;
                      const formattedPhone = phoneNum.startsWith('+') || (phoneNum.startsWith('91') && phoneNum.length > 10)
                        ? phoneNum 
                        : '91' + phoneNum;
                      const lang = activeReceipt.patient.preferredLanguage || 'English';
                      const templates = TRANSLATIONS[lang] || TRANSLATIONS['English'];
                      const template = templates.tokenCreated || TRANSLATIONS['English'].tokenCreated || '';
                      
                      const waitTime = activeReceipt.visit.predictedWaitTime || queueState.avgConsultationTime || 10;
                      const msg = template
                        .replace(/{{name}}/g, activeReceipt.patient.name || 'Patient')
                        .replace(/{{token}}/g, activeReceipt.visit.tokenNumber)
                        .replace(/{{reason}}/g, activeReceipt.visit.reasonForVisit || activeReceipt.patient.reasonForVisit || 'General Checkup')
                        .replace(/{{wait}}/g, waitTime);

                      window.open(`https://web.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(msg)}`, '_blank');
                    }}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 px-4 rounded-xl shadow-lg transition flex items-center justify-center gap-2"
                  >
                    Send
                  </button>
                )}
                <button
                  onClick={handlePrintSlip}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-medium py-2.5 px-4 rounded-xl border border-slate-750 transition flex items-center justify-center gap-2"
                >
                  <Printer className="w-4 h-4" />
                  Print Slip
                </button>
                <button
                  onClick={() => setActiveReceipt(null)}
                  className="bg-slate-700 hover:bg-slate-600 text-white font-semibold py-2.5 px-4 rounded-xl transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
