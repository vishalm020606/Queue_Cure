import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import Navbar from '../components/Navbar';
import { 
  Heart, 
  Stethoscope, 
  History, 
  Plus, 
  Trash2, 
  CheckCircle,
  FileText,
  Calendar,
  AlertCircle,
  Printer,
  X,
  Share2,
  AlertTriangle
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

export default function DoctorDashboard() {
  const navigate = useNavigate();
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [queueState, setQueueState] = useState({
    currentToken: 0,
    avgConsultationTime: 10,
    visits: []
  });

  // Current active patient details
  const [activeVisit, setActiveVisit] = useState(null);
  const [patientHistory, setPatientHistory] = useState([]);

  // Medical Consultation Form State
  const [symptomsInput, setSymptomsInput] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [notes, setNotes] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [prescription, setPrescription] = useState([]);
  
  // Single Prescription Line Inputs
  const [medName, setMedName] = useState('');
  const [medDosage, setMedDosage] = useState('');
  const [medFrequency, setMedFrequency] = useState('1-0-1');
  const [medDuration, setMedDuration] = useState('');

  // Active prescription slip modal
  const [showPrescriptionModal, setShowPrescriptionModal] = useState(false);
  const [completedConsultationObj, setCompletedConsultationObj] = useState(null);

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const getToken = () => localStorage.getItem('token');
  const getUser = () => JSON.parse(localStorage.getItem('user') || '{}');

  const cacheSystemState = async (state) => {
    try {
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
      console.error(err);
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
          visits: data.visits
        });
        await cacheSystemState(data);
      } else {
        await loadCachedState();
      }
    } catch (error) {
      console.error('Failed to fetch state. Using local database:', error);
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
      const res = await synchronizePendingActions(BACKEND_URL, token);
      if (res.success && res.count > 0) {
        console.log(`[Sync Engine] Doctor replayed ${res.count} transactions successfully.`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSyncing(false);
      await updatePendingCount();
    }
  };

  useEffect(() => {
    // Auth Guard
    const token = getToken();
    const user = getUser();
    if (!token || user.role !== 'doctor') {
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
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
    });

    newSocket.on('queue-updated', (newState) => {
      setQueueState(newState);
      cacheSystemState(newState);
      updatePendingCount();
    });

    return () => {
      newSocket.disconnect();
    };
  }, [navigate]);

  // Synchronize the currently serving visit
  useEffect(() => {
    const serving = queueState.visits.find(v => v.status === 'serving');
    if (serving) {
      setActiveVisit(serving);
      fetchPatientHistory(serving.patientId?._id);
    } else {
      setActiveVisit(null);
      setPatientHistory([]);
    }
  }, [queueState.visits]);

  // Fetch patient medical record logs
  const fetchPatientHistory = async (patientId) => {
    if (!patientId) return;

    // First lookup locally in consultations cache
    try {
      const cachedConsultations = await getAllItems('consultations');
      const filtered = cachedConsultations
        .filter(c => c.patientId === patientId || (c.patientId && c.patientId._id === patientId))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      if (filtered.length > 0) {
        setPatientHistory(filtered);
      }
    } catch (err) {
      console.error(err);
    }

    if (!isConnected) return;

    try {
      const response = await fetch(`${BACKEND_URL}/api/patient/${patientId}/history`, {
        headers: {
          'Authorization': `Bearer ${getToken()}`
        }
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setPatientHistory(data.history);
        // Cache history records in local IndexedDB
        for (const cons of data.history) {
          await saveItem('consultations', cons);
        }
      }
    } catch (error) {
      console.error('Error fetching patient history:', error);
    }
  };

  // Add prescription item to list
  const handleAddMedicine = () => {
    if (!medName.trim() || !medDosage.trim() || !medFrequency.trim() || !medDuration.trim()) return;
    
    setPrescription([
      ...prescription,
      { medicine: medName, dosage: medDosage, frequency: medFrequency, duration: medDuration }
    ]);
    
    setMedName('');
    setMedDosage('');
    setMedDuration('');
  };

  // Remove prescription item
  const handleRemoveMedicine = (index) => {
    setPrescription(prescription.filter((_, i) => i !== index));
  };

  // Submit diagnosis chart
  const handleSubmitConsultation = async (e) => {
    e.preventDefault();
    if (!activeVisit || !diagnosis.trim()) return;

    const symptomsList = symptomsInput
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const submitData = {
      visitId: activeVisit._id,
      patientId: activeVisit.patientId?._id || activeVisit.patientId,
      symptoms: symptomsList,
      diagnosis,
      prescription,
      notes,
      followUpDate: followUpDate || null
    };

    // 1. Offline Mode Submission
    if (!isConnected) {
      const tempConsId = `temp-cons-${Date.now()}`;
      const localConsultation = {
        _id: tempConsId,
        consultationId: `QC-TEMP-CONS-${Date.now().toString().slice(-4)}`,
        visitId: activeVisit,
        patientId: activeVisit.patientId,
        symptoms: symptomsList,
        diagnosis,
        prescription,
        notes,
        followUpDate: followUpDate || null,
        createdAt: new Date().toISOString()
      };

      await saveItem('consultations', localConsultation);
      await addPendingAction('SUBMIT_CONSULTATION', submitData);

      // Update visit status locally
      const updatedVisit = { ...activeVisit, status: 'completed' };
      await saveItem('visits', updatedVisit);

      // Update local state immediately
      setQueueState(prev => ({
        ...prev,
        visits: prev.visits.map(v => v._id === activeVisit._id ? updatedVisit : v)
      }));

      setCompletedConsultationObj(localConsultation);
      setShowPrescriptionModal(true);

      // Reset Form fields
      setSymptomsInput('');
      setDiagnosis('');
      setNotes('');
      setFollowUpDate('');
      setPrescription([]);
      updatePendingCount();
      return;
    }

    // 2. Online Mode Path
    try {
      const response = await fetch(`${BACKEND_URL}/api/consultation/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify(submitData)
      });
      const data = await response.json();
      
      if (response.ok && data.success) {
        // Save the generated consultation to local IndexedDB cache
        await saveItem('consultations', data.consultation);
        
        // Load completed data and open print popup
        setCompletedConsultationObj({
          ...data.consultation,
          visitId: activeVisit,
          patientId: activeVisit.patientId
        });
        setShowPrescriptionModal(true);

        // Reset form
        setSymptomsInput('');
        setDiagnosis('');
        setNotes('');
        setFollowUpDate('');
        setPrescription([]);
      } else {
        alert(data.error || 'Failed to submit consultation.');
      }
    } catch (error) {
      console.error('Submit consultation error:', error);
      alert('Local network error.');
    }
  };

  // Emergency prioritize actions
  const handleApproveEmergency = async (visitId) => {
    if (!isConnected) {
      // Offline support: approve locally in DB, add sync queue task
      try {
        const visit = await getAllItems('visits');
        const matched = visit.find(v => v._id === visitId);
        if (matched) {
          matched.priority = 'Urgent';
          matched.priorityPendingApproval = 'Normal';
          await saveItem('visits', matched);
          await addPendingAction('APPROVE_EMERGENCY', { id: visitId });
          
          setQueueState(prev => ({
            ...prev,
            visits: prev.visits.map(v => v._id === visitId ? matched : v)
          }));
          updatePendingCount();
        }
      } catch (err) {
        console.error(err);
      }
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/visit/${visitId}/approve-emergency`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        }
      });
      if (!response.ok) {
        alert('Failed to approve emergency override.');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeclineEmergency = async (visitId) => {
    if (!isConnected) {
      try {
        const visit = await getAllItems('visits');
        const matched = visit.find(v => v._id === visitId);
        if (matched) {
          matched.priorityPendingApproval = 'Normal';
          await saveItem('visits', matched);
          await addPendingAction('DECLINE_EMERGENCY', { id: visitId });
          
          setQueueState(prev => ({
            ...prev,
            visits: prev.visits.map(v => v._id === visitId ? matched : v)
          }));
          updatePendingCount();
        }
      } catch (err) {
        console.error(err);
      }
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/visit/${visitId}/decline-emergency`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        }
      });
      if (!response.ok) {
        alert('Failed to decline emergency override.');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Printable layout triggers
  const triggerPrintPrescription = () => {
    window.print();
  };

  // WhatsApp click to chat construction
  const getWhatsAppShareLink = () => {
    if (!completedConsultationObj) return '#';
    const patient = completedConsultationObj.patientId || {};
    const phoneDigits = (patient.phone || '').replace(/\D/g, '');
    const formattedPhone = phoneDigits.length === 10 ? '91' + phoneDigits : phoneDigits;

    const medsText = completedConsultationObj.prescription.map((m, idx) => 
      `${idx + 1}. ${m.medicine} - ${m.dosage} (${m.frequency}) x ${m.duration}`
    ).join('%0A');

    const msg = `*QUEUE CURE CLINIC PRESCRIPTION*%0A` +
      `--------------------------------------%0A` +
      `*Prescription ID:* ${completedConsultationObj.consultationId}%0A` +
      `*Patient Name:* ${patient.name}%0A` +
      `*Diagnosis:* ${completedConsultationObj.diagnosis}%0A` +
      `*Notes:* ${completedConsultationObj.notes || 'Regular rest'}%0A%0A` +
      `*Medicines:*%0A${medsText}%0A%0A` +
      `*Follow-Up Date:* ${completedConsultationObj.followUpDate ? new Date(completedConsultationObj.followUpDate).toLocaleDateString() : 'N/A'}`;

    return `https://wa.me/${formattedPhone}?text=${msg}`;
  };

  const getSMSShareLink = () => {
    if (!completedConsultationObj) return '#';
    const patient = completedConsultationObj.patientId || {};
    const phoneDigits = (patient.phone || '').replace(/\D/g, '');

    const medsText = completedConsultationObj.prescription.map((m, idx) => 
      `${idx + 1}. ${m.medicine} (${m.dosage} - ${m.frequency})`
    ).join(', ');

    const body = `Queue Cure prescription summary for ${patient.name}. Diagnosis: ${completedConsultationObj.diagnosis}. Medicines: ${medsText}. Follow-up: ${completedConsultationObj.followUpDate ? new Date(completedConsultationObj.followUpDate).toLocaleDateString() : 'N/A'}`;
    
    // Dynamic OS separator handling for body query parameter
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '');
    const separator = isIOS ? '&' : '?';

    return `sms:${phoneDigits}${separator}body=${encodeURIComponent(body)}`;
  };

  const waitingCount = queueState.visits.filter(v => v.status === 'waiting').length;

  // Filter urgent prioritization override requests
  const pendingEmergencyRequests = queueState.visits.filter(
    v => v.priorityPendingApproval === 'Urgent' && v.priority !== 'Urgent'
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col bg-grid-pattern relative">
      <Navbar />

      {/* Printable Area (Prescription Sheet) */}
      {completedConsultationObj && (
        <div className="hidden print:block print:p-12 text-black bg-white min-h-screen text-left font-mono">
          <div className="border-4 border-black p-8 rounded-xl max-w-4xl mx-auto space-y-6">
            <div className="text-center pb-4 border-b-2 border-black">
              <h1 className="text-4xl font-black tracking-wider">QUEUE CURE SMART CLINIC</h1>
              <p className="text-sm mt-1">REAL-TIME OPD DIGITAL CONSULTATION RECORDS</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <p><strong>PATIENT ID:</strong> {completedConsultationObj.patientId?.patientId}</p>
                <p><strong>NAME:</strong> {completedConsultationObj.patientId?.name}</p>
                <p><strong>AGE / GENDER:</strong> {completedConsultationObj.patientId?.age} Yrs / {completedConsultationObj.patientId?.gender}</p>
                <p><strong>BLOOD GROUP:</strong> {completedConsultationObj.patientId?.bloodGroup || 'Not specified'}</p>
              </div>
              <div className="text-right">
                <p><strong>PRESCRIPTION ID:</strong> {completedConsultationObj.consultationId}</p>
                <p><strong>DATE:</strong> {new Date(completedConsultationObj.createdAt).toLocaleDateString()}</p>
                <p><strong>DOCTOR:</strong> {getUser().username} (OPD Doctor)</p>
                <p><strong>PHONE:</strong> {completedConsultationObj.patientId?.phone}</p>
              </div>
            </div>

            <hr className="border-black" />

            <div>
              <p className="text-sm"><strong>SYMPTOMS:</strong></p>
              <p className="text-xs italic pl-4">{completedConsultationObj.symptoms?.join(', ') || 'No symptoms registered'}</p>
            </div>

            <div>
              <p className="text-sm"><strong>CLINICAL IMPRESSION / DIAGNOSIS:</strong></p>
              <p className="text-xs font-bold pl-4 uppercase">{completedConsultationObj.diagnosis}</p>
            </div>

            <hr className="border-black border-dashed" />

            <div>
              <p className="text-sm font-bold mb-3">Rx - MEDICATION SHEET</p>
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-black font-bold">
                    <th className="py-2">Medicine Name</th>
                    <th className="py-2">Dosage</th>
                    <th className="py-2">Frequency</th>
                    <th className="py-2">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {completedConsultationObj.prescription?.map((med, index) => (
                    <tr key={index} className="border-b border-gray-300">
                      <td className="py-2 font-bold">{med.medicine}</td>
                      <td className="py-2">{med.dosage}</td>
                      <td className="py-2 font-bold">{med.frequency}</td>
                      <td className="py-2">{med.duration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <hr className="border-black border-dashed" />

            {completedConsultationObj.notes && (
              <div>
                <p className="text-sm"><strong>DIETARY & CLINICAL ADVICE:</strong></p>
                <p className="text-xs pl-4 italic">"{completedConsultationObj.notes}"</p>
              </div>
            )}

            {completedConsultationObj.followUpDate && (
              <div>
                <p className="text-xs text-black">
                  <strong>FOLLOW UP VISIT DATE:</strong> {new Date(completedConsultationObj.followUpDate).toLocaleDateString()}
                </p>
              </div>
            )}

            <div className="pt-16 flex justify-between text-xs">
              <div>
                <p>Digital Prescription ID</p>
                <span className="text-[10px] font-mono text-gray-500">{completedConsultationObj._id}</span>
              </div>
              <div className="text-center w-48 border-t border-black pt-2">
                <p>AUTHORIZED DOCTOR</p>
                <p className="font-bold uppercase font-sans mt-1 text-[10px]">{getUser().username}</p>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Main Screen layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 print:hidden">
        
        {/* Emergency prioritized request banner list */}
        {pendingEmergencyRequests.length > 0 && (
          <div className="mb-6 space-y-3">
            {pendingEmergencyRequests.map(req => (
              <div 
                key={req._id}
                className="bg-red-950/70 border border-red-500/30 text-red-300 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl shadow-red-950/20"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-red-900 flex items-center justify-center text-white border border-red-500/35 font-mono font-bold animate-pulse">
                    #{req.tokenNumber}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      Urgent Priority Override Request
                    </h3>
                    <p className="text-xs text-red-400 mt-0.5">
                      Patient: <strong className="text-white">{req.patientId?.name}</strong> is requesting emergency priority triage.
                    </p>
                  </div>
                </div>

                <div className="flex gap-2.5 w-full sm:w-auto">
                  <button
                    onClick={() => handleDeclineEmergency(req._id)}
                    className="flex-1 sm:flex-initial px-4 py-2 text-xs font-bold bg-slate-900 border border-slate-800 hover:bg-slate-800 hover:text-white text-slate-400 rounded-xl transition"
                  >
                    Maintain Normal
                  </button>
                  <button
                    onClick={() => handleApproveEmergency(req._id)}
                    className="flex-1 sm:flex-initial px-5 py-2 text-xs font-bold bg-red-600 hover:bg-red-500 text-white rounded-xl shadow-lg transition-all hover:scale-[1.01]"
                  >
                    Approve Urgent
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column (7 cols): Consultation Terminal */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            
            {/* Sync bar */}
            <div className="flex justify-between items-center text-xs">
              <div className="flex items-center gap-2">
                <div className={`w-3.5 h-3.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`} />
                <span className="text-slate-400 font-semibold">
                  {isConnected ? '🟢 Server Connected' : '🔴 Server Offline - Saving Locally'}
                </span>
              </div>
              
              {pendingCount > 0 && (
                <span className="bg-amber-950 text-amber-400 border border-amber-500/20 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase animate-pulse">
                  {pendingCount} consultation sync actions pending
                </span>
              )}
            </div>

            {/* Active Serving Panel */}
            {activeVisit ? (
              <div className="glass-premium rounded-2xl p-6 relative overflow-hidden">
                <div className="absolute right-0 top-0 -mt-6 -mr-6 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl" />
                
                <div className="flex items-center gap-3 mb-4">
                  <Stethoscope className="w-6 h-6 text-blue-500" />
                  <h2 className="text-white text-lg font-bold">Active Consultation Terminal</h2>
                  {activeVisit.priority === 'Urgent' && (
                    <span className="bg-red-950 text-red-400 border border-red-500/20 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase animate-pulse">
                      Urgent Case
                    </span>
                  )}
                </div>

                {/* Patient Profile Specs */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-900/60 p-4 rounded-xl border border-slate-850 text-xs">
                  <div>
                    <span className="text-slate-500 block uppercase font-semibold text-[10px]">Token</span>
                    <span className="text-xl font-bold text-blue-400 font-mono">#{activeVisit.tokenNumber}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block uppercase font-semibold text-[10px]">Patient Name</span>
                    <span className="text-sm font-bold text-white block truncate">{activeVisit.patientId?.name}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block uppercase font-semibold text-[10px]">Age / Gender</span>
                    <span className="text-sm font-semibold text-slate-300 block">{activeVisit.patientId?.age} yrs / {activeVisit.patientId?.gender}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block uppercase font-semibold text-[10px]">Lang / Blood</span>
                    <span className="text-sm font-semibold text-slate-300 block">{activeVisit.patientId?.preferredLanguage || 'English'} • {activeVisit.patientId?.bloodGroup || 'A+'}</span>
                  </div>
                </div>

                <div className="mt-3 text-xs text-slate-400">
                  <strong>Intake Reason:</strong> {activeVisit.reasonForVisit || 'Regular medical checkup'}
                </div>

                {/* Consultation Input Form */}
                <form onSubmit={handleSubmitConsultation} className="space-y-4 mt-6">
                  
                  {/* Symptoms and diagnosis */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-slate-400 text-xs font-semibold uppercase mb-1.5">Symptoms (Comma Separated)</label>
                      <input
                        type="text"
                        placeholder="e.g. Fever, Cough, Headache"
                        value={symptomsInput}
                        onChange={(e) => setSymptomsInput(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-400 text-xs font-semibold uppercase mb-1.5">Diagnosis / Clinic Impression *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Viral Fever, Bronchitis"
                        value={diagnosis}
                        onChange={(e) => setDiagnosis(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition font-bold"
                      />
                    </div>
                  </div>

                  {/* Prescription Manager */}
                  <div className="bg-slate-900/40 border border-slate-850 p-4 rounded-xl space-y-3">
                    <h3 className="text-white text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                      <Heart className="w-3.5 h-3.5 text-blue-500" />
                      Prescription Builder
                    </h3>
                    
                    {/* Medicine Row Builder */}
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <input
                        type="text"
                        placeholder="Medicine (e.g. Paracetamol)"
                        value={medName}
                        onChange={(e) => setMedName(e.target.value)}
                        className="bg-slate-900 border border-slate-800 text-xs rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
                      />
                      <input
                        type="text"
                        placeholder="Dosage (e.g. 500 mg)"
                        value={medDosage}
                        onChange={(e) => setMedDosage(e.target.value)}
                        className="bg-slate-900 border border-slate-800 text-xs rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
                      />
                      <select
                        value={medFrequency}
                        onChange={(e) => setMedFrequency(e.target.value)}
                        className="bg-slate-900 border border-slate-800 text-xs rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
                      >
                        <option value="1-0-0">1-0-0 (Once daily morning)</option>
                        <option value="0-1-0">0-1-0 (Once daily afternoon)</option>
                        <option value="0-0-1">0-0-1 (Once daily night)</option>
                        <option value="1-0-1">1-0-1 (Twice daily after food)</option>
                        <option value="1-1-1">1-1-1 (Three times daily)</option>
                        <option value="SOS">SOS (As and when needed)</option>
                      </select>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Duration (e.g. 5 days)"
                          value={medDuration}
                          onChange={(e) => setMedDuration(e.target.value)}
                          className="flex-1 bg-slate-900 border border-slate-800 text-xs rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
                        />
                        <button
                          type="button"
                          onClick={handleAddMedicine}
                          className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg p-2.5 transition flex items-center justify-center"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Medicine List Display */}
                    {prescription.length > 0 && (
                      <div className="mt-3 border-t border-slate-800 pt-3">
                        <table className="w-full text-left text-xs text-slate-300">
                          <thead>
                            <tr className="border-b border-slate-850 text-slate-500 font-bold uppercase text-[10px]">
                              <th className="py-2">Medicine</th>
                              <th className="py-2">Dosage</th>
                              <th className="py-2">Frequency</th>
                              <th className="py-2">Duration</th>
                              <th className="py-2 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {prescription.map((med, index) => (
                              <tr key={index} className="border-b border-slate-850/60">
                                <td className="py-2 font-semibold text-white">{med.medicine}</td>
                                <td className="py-2">{med.dosage}</td>
                                <td className="py-2 font-semibold text-blue-400">{med.frequency}</td>
                                <td className="py-2">{med.duration}</td>
                                <td className="py-2 text-right">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveMedicine(index)}
                                    className="text-slate-500 hover:text-red-400 p-1 rounded transition"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Additional Clinical Notes */}
                  <div>
                    <label className="block text-slate-400 text-xs font-semibold uppercase mb-1.5">Clinical Notes / Comments</label>
                    <textarea
                      placeholder="Enter patient logs, diet advice, or recommendations..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows="3"
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
                    />
                  </div>

                  {/* Follow up row */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                    <div>
                      <label className="block text-slate-400 text-xs font-semibold uppercase mb-1.5">Follow-Up Date</label>
                      <input
                        type="date"
                        value={followUpDate}
                        onChange={(e) => setFollowUpDate(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-blue-500 transition text-xs"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full self-end bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3.5 rounded-xl shadow-lg transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2"
                    >
                      <CheckCircle className="w-5 h-5" />
                      Complete Consultation RX
                    </button>
                  </div>

                </form>

              </div>
            ) : (
              <div className="glass-premium rounded-2xl p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
                <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-600 mb-4">
                  <Stethoscope className="w-8 h-8" />
                </div>
                <h2 className="text-xl font-bold text-white">No Active Patient</h2>
                <p className="text-sm text-slate-400 max-w-sm mt-1">
                  Waiting for the receptionist terminal to call the next patient.
                </p>
                {waitingCount > 0 && (
                  <div className="mt-4 bg-blue-950/60 border border-blue-500/25 px-4 py-2 rounded-xl text-blue-400 text-xs font-semibold flex items-center gap-2 animate-pulse">
                    <AlertCircle className="w-4 h-4" />
                    <span>{waitingCount} patient(s) waiting in queue line.</span>
                  </div>
                )}
              </div>
            )}

          </div>

          {/* Right Column (5 cols): History logs */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            
            {/* Timeline of patient checkups */}
            <div className="glass-premium rounded-2xl p-6 flex-1 flex flex-col overflow-hidden max-h-[600px]">
              <h2 className="text-white text-lg font-bold flex items-center gap-2 mb-4">
                <History className="w-5 h-5 text-blue-500" />
                Patient Clinical History
              </h2>

              <div className="overflow-y-auto flex-1 pr-1 space-y-4 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
                {!activeVisit ? (
                  <div className="h-full flex items-center justify-center text-slate-500 text-sm text-center">
                    <span>No active patient loaded.</span>
                  </div>
                ) : patientHistory.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-600 text-xs text-center">
                    <span>First time visit. No prior clinical logs found.</span>
                  </div>
                ) : (
                  patientHistory.map((cons) => (
                    <div key={cons._id} className="relative pl-5 border-l-2 border-slate-800 space-y-2">
                      <div className="absolute -left-1.5 top-1.5 w-3 h-3 bg-blue-500 rounded-full border-2 border-slate-950" />
                      
                      <div className="bg-slate-900/60 border border-slate-850 rounded-xl p-4 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between text-slate-400 text-[10px]">
                          <span className="font-mono text-blue-400">{cons.consultationId}</span>
                          <span>{new Date(cons.createdAt).toLocaleDateString()}</span>
                        </div>
                        
                        <div>
                          <strong className="text-white block">Diagnosis:</strong>
                          <p className="text-slate-300 font-bold">{cons.diagnosis}</p>
                        </div>

                        {cons.symptoms?.length > 0 && (
                          <div>
                            <strong className="text-slate-400 block text-[10px]">Symptoms:</strong>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {cons.symptoms.map((s, i) => (
                                <span key={i} className="bg-slate-800 text-slate-300 text-[9px] px-1.5 py-0.5 rounded border border-slate-750">
                                  {s}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {cons.prescription?.length > 0 && (
                          <div className="bg-slate-950 border border-slate-850 p-2.5 rounded-lg space-y-1 mt-1 text-[10px]">
                            <strong className="text-slate-400 block mb-1">Prescription:</strong>
                            {cons.prescription.map((p, idx) => (
                              <div key={idx} className="flex justify-between border-b border-slate-850/60 pb-1 last:border-0 last:pb-0 text-slate-300">
                                <span>💊 {p.medicine}</span>
                                <span className="text-slate-400 font-mono">{p.dosage} - <strong className="text-blue-400">{p.frequency}</strong> ({p.duration})</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {cons.notes && (
                          <div>
                            <strong className="text-slate-400 block text-[10px]">Doctor Notes:</strong>
                            <p className="text-slate-400 italic">"{cons.notes}"</p>
                          </div>
                        )}
                        
                        {cons.followUpDate && (
                          <div className="text-[10px] text-amber-500 font-semibold flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5" />
                            <span>Follow up: {new Date(cons.followUpDate).toLocaleDateString()}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

        </div>

      </main>

      {/* Prescription Share/Print Modal popup */}
      {showPrescriptionModal && completedConsultationObj && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center z-50 p-4 print:hidden">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-xl w-full p-6 shadow-2xl relative flex flex-col max-h-[90vh]">
            <button 
              onClick={() => setShowPrescriptionModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="text-center mb-4">
              <div className="w-12 h-12 bg-emerald-950 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-2 border border-emerald-500/20">
                <CheckCircle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Consultation File Saved</h3>
              <p className="text-xs text-slate-400">Digital prescription compiled successfully.</p>
            </div>

            {/* Scrollable Preview Container */}
            <div className="flex-1 overflow-y-auto bg-slate-950 border border-slate-800 rounded-xl p-5 font-mono text-[11px] text-slate-400 space-y-4">
              <div className="text-center pb-2 border-b border-slate-800">
                <h4 className="font-black text-white text-sm tracking-wider">QUEUE CURE DIGITAL RX</h4>
                <span className="text-[9px] text-slate-500 font-sans">Queue Cure LAN Stack 2.0</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <p><strong className="text-slate-200">Patient:</strong> {completedConsultationObj.patientId?.name}</p>
                  <p><strong className="text-slate-200">Age/Gen:</strong> {completedConsultationObj.patientId?.age} / {completedConsultationObj.patientId?.gender}</p>
                </div>
                <div className="text-right">
                  <p><strong className="text-slate-200">Date:</strong> {new Date(completedConsultationObj.createdAt).toLocaleDateString()}</p>
                  <p><strong className="text-slate-200">RX ID:</strong> {completedConsultationObj.consultationId}</p>
                </div>
              </div>

              <div className="border-t border-b border-slate-800 border-dashed py-2 space-y-1">
                <p><strong className="text-slate-200">Diagnosis:</strong> {completedConsultationObj.diagnosis}</p>
                <p><strong className="text-slate-200">Symptoms:</strong> {completedConsultationObj.symptoms?.join(', ')}</p>
              </div>

              <div className="space-y-2">
                <p className="font-bold text-white text-[10px] uppercase tracking-wider">Rx - Medication Sheet</p>
                {completedConsultationObj.prescription?.map((p, idx) => (
                  <div key={idx} className="flex justify-between border-b border-slate-850/60 pb-1.5 text-slate-300">
                    <span className="font-bold">💊 {p.medicine}</span>
                    <span>{p.dosage} - <strong className="text-blue-400">{p.frequency}</strong> ({p.duration})</span>
                  </div>
                ))}
              </div>

              {completedConsultationObj.notes && (
                <p className="italic text-slate-500"><strong className="text-slate-300 font-sans block text-[9px] not-italic uppercase tracking-wider">Notes/Advice</strong>"{completedConsultationObj.notes}"</p>
              )}
            </div>

            {/* Action Bar */}
            <div className="mt-5 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={triggerPrintPrescription}
                  className="bg-slate-800 hover:bg-slate-700 text-white font-medium py-3 rounded-xl border border-slate-750 transition flex items-center justify-center gap-1.5 text-xs"
                >
                  <Printer className="w-4 h-4" />
                  Print RX
                </button>
                <a
                  href={getWhatsAppShareLink()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-emerald-650 hover:bg-emerald-600 text-white font-medium py-3 rounded-xl transition flex items-center justify-center gap-1.5 text-xs"
                >
                  <Share2 className="w-4 h-4" />
                  WhatsApp
                </a>
                <a
                  href={getSMSShareLink()}
                  className="bg-blue-650 hover:bg-blue-600 text-white font-medium py-3 rounded-xl transition flex items-center justify-center gap-1.5 text-xs"
                >
                  <FileText className="w-4 h-4" />
                  Send SMS
                </a>
              </div>
              <button
                onClick={() => setShowPrescriptionModal(false)}
                className="w-full bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-750 font-bold py-3 rounded-xl text-xs transition"
              >
                Close Prescription Panel
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
