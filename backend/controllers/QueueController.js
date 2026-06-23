import Patient from '../models/Patient.js';
import Visit from '../models/Visit.js';
import ClinicState from '../models/ClinicState.js';
import DailyReport from '../models/DailyReport.js';
import NotificationLog from '../models/NotificationLog.js';
import NotificationService from '../services/NotificationService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { io } from '../server.js';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backupPath = path.resolve(__dirname, '../backup.json');

// Helper to resolve host machine's LAN IP address
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const interfaceName in interfaces) {
    for (const iface of interfaces[interfaceName]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Helper to write transaction backups to disk
export const writeBackupLog = (event, details) => {
  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event,
      details
    };
    fs.appendFileSync(backupPath, JSON.stringify(logEntry) + '\n', 'utf8');
  } catch (error) {
    console.error('Backup write failed:', error.message);
  }
};

// Heuristic AI wait-time prediction algorithm
export const computeWaitTimes = (visits, avgConsultationTime) => {
  const servingVisit = visits.find(v => v.status === 'serving');
  let currentServingRemaining = 0;
  if (servingVisit) {
    const elapsedMs = Date.now() - new Date(servingVisit.updatedAt).getTime();
    const elapsedMins = elapsedMs / 60000;
    currentServingRemaining = Math.max(1, Math.round(avgConsultationTime - elapsedMins));
    if (currentServingRemaining <= 0 || elapsedMins > avgConsultationTime) {
      currentServingRemaining = 2; // expected to wrap up soon
    }
  }

  const waitingVisits = visits.filter(v => v.status === 'waiting');
  // Sort waiting visits in chronological service order: Urgent first, then Normal
  const orderedWaiting = [...waitingVisits].sort((a, b) => {
    if (a.priority === 'Urgent' && b.priority !== 'Urgent') return -1;
    if (a.priority !== 'Urgent' && b.priority === 'Urgent') return 1;
    return a.tokenSeq - b.tokenSeq;
  });

  let accumulatedWait = currentServingRemaining;
  const predictions = {};

  for (const visit of orderedWaiting) {
    predictions[visit._id.toString()] = accumulatedWait;
    const durationFactor = visit.priority === 'Urgent' ? 1.3 : 1.0;
    accumulatedWait += Math.round(avgConsultationTime * durationFactor);
  }

  return predictions;
};

// Automatic Midnight Archive & Daily report generator
export const checkAndPerformDailyReset = async () => {
  try {
    let config = await ClinicState.findOne({ id: 'GLOBAL_CONFIG' });
    const todayStr = new Date().toISOString().split('T')[0];

    if (!config) {
      config = await ClinicState.create({ 
        id: 'GLOBAL_CONFIG', 
        currentToken: 0, 
        avgConsultationTime: 10,
        lastResetDate: todayStr
      });
      return;
    }

    const lastResetStr = config.lastResetDate || todayStr;

    if (todayStr !== lastResetStr) {
      console.log(`[Daily Reset] Date shifted from ${lastResetStr} to ${todayStr}. Running archival...`);

      // Retrieve all active, non-archived visits of the yesterday session
      const activeVisits = await Visit.find({ archived: false });

      if (activeVisits.length > 0) {
        const completedVisits = activeVisits.filter(v => v.status === 'completed');
        const emergencyVisits = activeVisits.filter(v => v.priority === 'Urgent');

        let totalWaitTimeMs = 0;
        let countForWaitTime = 0;

        for (const v of completedVisits) {
          const waitTimeMs = new Date(v.updatedAt).getTime() - new Date(v.createdAt).getTime();
          if (waitTimeMs > 0) {
            totalWaitTimeMs += waitTimeMs;
            countForWaitTime++;
          }
        }
        
        const avgWaitTimeMins = countForWaitTime > 0 ? Math.round((totalWaitTimeMs / countForWaitTime) / 60000) : 0;
        const totalMinutesActive = completedVisits.length * config.avgConsultationTime;
        const utilizationPercent = Math.min(100, Math.round((totalMinutesActive / 480) * 100)); // base 8-hour workday

        await DailyReport.create({
          date: lastResetStr,
          patientsServed: completedVisits.length,
          avgWaitTime: avgWaitTimeMins,
          emergencyCases: emergencyVisits.length,
          doctorUtilization: utilizationPercent,
          consultationCount: completedVisits.length
        });

        // Set active visits to archived
        await Visit.updateMany({ archived: false }, { $set: { archived: true } });
      }

      config.currentToken = 0;
      config.lastResetDate = todayStr;
      await config.save();

      writeBackupLog('DAILY_RESET', { date: lastResetStr, today: todayStr });
    }
  } catch (error) {
    console.error('[Daily Reset Error]:', error.message);
  }
};

// Heuristic check to trigger approaching and delay alerts dynamically
export const triggerQueueStateNotifications = async (currentToken, visits) => {
  try {
    let config = await ClinicState.findOne({ id: 'GLOBAL_CONFIG' });
    if (!config) return;

    const currentSeq = config.currentTokenSeq || 0;

    for (const visit of visits) {
      if (!visit.patientId) continue;
      const patient = visit.patientId;

      if (visit.status === 'waiting') {
        const patientsAhead = visit.tokenSeq - currentSeq;

        // Rule 1: 5 Patients Ahead
        if (patientsAhead === 5 && !visit.alert5Sent) {
          try {
            await NotificationService.sendRule5Ahead(patient, visit.tokenNumber);
            await Visit.findByIdAndUpdate(visit._id, { $set: { alert5Sent: true } });
            visit.alert5Sent = true;
          } catch (nErr) {
            console.error('[Notification Trigger Error] Rule 1 (5 ahead):', nErr.message);
          }
        }

        // Rule 2: 2 Patients Ahead
        if (patientsAhead === 2 && !visit.alert2Sent) {
          try {
            await NotificationService.sendRule2Ahead(patient, visit.tokenNumber);
            await Visit.findByIdAndUpdate(visit._id, { $set: { alert2Sent: true } });
            visit.alert2Sent = true;
          } catch (nErr) {
            console.error('[Notification Trigger Error] Rule 2 (2 ahead):', nErr.message);
          }
        }

        // Delay Alert (delay >= 15 mins)
        const delay = (visit.predictedWaitTime || 0) - (visit.initialPredictedWaitTime || 0);
        if (delay >= 15 && !visit.delayAlertSent) {
          try {
            await NotificationService.sendDelayed(patient, delay, visit.tokenNumber);
            await Visit.findByIdAndUpdate(visit._id, { $set: { delayAlertSent: true } });
            visit.delayAlertSent = true;
          } catch (nErr) {
            console.error('[Notification Trigger Error] Delay Alert:', nErr.message);
          }
        }
      } else if (visit.status === 'serving') {
        // Rule 3: Current Token Called (Now Serving)
        if (!visit.alertServingSent) {
          try {
            await NotificationService.sendNowServing(patient, visit.tokenNumber);
            await Visit.findByIdAndUpdate(visit._id, { $set: { alertServingSent: true } });
            visit.alertServingSent = true;
          } catch (nErr) {
            console.error('[Notification Trigger Error] Rule 3 (Now serving):', nErr.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('[Queue Notifications Error]:', err.message);
  }
};

// Helper to fetch global system status
export const fetchSystemState = async () => {
  await checkAndPerformDailyReset();

  let config = await ClinicState.findOne({ id: 'GLOBAL_CONFIG' });
  if (!config) {
    config = await ClinicState.create({ 
      id: 'GLOBAL_CONFIG', 
      currentToken: "0", 
      currentTokenSeq: 0,
      avgConsultationTime: 10, 
      lastResetDate: new Date().toISOString().split('T')[0] 
    });
  }

  const visits = await Visit.find({ archived: { $ne: true } })
    .populate('patientId')
    .sort({ tokenSeq: 1 });

  const predictions = computeWaitTimes(visits, config.avgConsultationTime);
  const visitsWithWaitTime = visits.map(v => {
    const obj = v.toObject();
    obj.predictedWaitTime = predictions[v._id.toString()] || config.avgConsultationTime;
    return obj;
  });

  // Asynchronously trigger alerts to prevent blocking
  process.nextTick(() => {
    triggerQueueStateNotifications(config.currentToken, visitsWithWaitTime);
  });

  return {
    currentToken: config.currentToken,
    currentTokenSeq: config.currentTokenSeq || 0,
    avgConsultationTime: config.avgConsultationTime,
    visits: visitsWithWaitTime,
    localIp: getLocalIpAddress()
  };
};

// Register Patient
export const registerPatient = async (req, res) => {
  const { name, age, gender, phone, address, emergencyContact, bloodGroup, preferredLanguage, notificationPreference, deviceToken } = req.body;
  
  if (!phone) {
    return res.status(400).json({ success: false, error: 'Phone number is required.' });
  }

  try {
    const existingPatient = await Patient.findOne({ phone });
    if (existingPatient) {
      let changed = false;
      if (preferredLanguage && preferredLanguage !== existingPatient.preferredLanguage) {
        existingPatient.preferredLanguage = preferredLanguage;
        changed = true;
      }
      if (notificationPreference && notificationPreference !== existingPatient.notificationPreference) {
        existingPatient.notificationPreference = notificationPreference;
        changed = true;
      }
      if (deviceToken && deviceToken !== existingPatient.deviceToken) {
        existingPatient.deviceToken = deviceToken;
        changed = true;
      }
      if (changed) {
        await existingPatient.save();
      }
      return res.json({ success: true, isNew: false, patient: existingPatient });
    }

    if (!name || !age || !gender) {
      return res.status(400).json({ 
        success: false, 
        needsFields: true, 
        message: 'Patient profile not found. Please provide name, age, and gender.' 
      });
    }

    const patientCount = await Patient.countDocuments();
    const formattedId = `QC-2026-${String(patientCount + 1).padStart(4, '0')}`;

    const newPatient = await Patient.create({
      patientId: formattedId,
      name,
      age,
      gender,
      phone,
      address,
      emergencyContact,
      bloodGroup,
      preferredLanguage: preferredLanguage || 'English',
      notificationPreference: notificationPreference || 'sms',
      deviceToken
    });

    res.json({ success: true, isNew: true, patient: newPatient });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Add Visit
export const addVisit = async (req, res) => {
  const { patientId, reasonForVisit, priority } = req.body;

  if (!patientId) {
    return res.status(400).json({ success: false, error: 'Patient ID is required.' });
  }

  try {
    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Patient profile not found.' });
    }

    // Filter token increments by active, non-archived visits
    const maxVisit = await Visit.findOne({ archived: { $ne: true } }).sort({ tokenSeq: -1 });
    let nextSeq = 1;
    if (maxVisit) {
      const lastSeq = maxVisit.tokenSeq || parseInt(String(maxVisit.tokenNumber).replace(/\D/g, ''), 10) || 0;
      nextSeq = lastSeq + 1;
    }
    const nextTokenStr = "A" + (100 + nextSeq); // Generates A101, A102...
    const uniqueVisitId = `V-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const isUrgent = priority === 'Urgent';
    const isDoctor = req.user && req.user.role === 'doctor';

    const newVisit = await Visit.create({
      visitId: uniqueVisitId,
      patientId: patient._id,
      tokenNumber: nextTokenStr,
      tokenSeq: nextSeq,
      reasonForVisit,
      priority: (isUrgent && isDoctor) ? 'Urgent' : 'Normal',
      priorityPendingApproval: isUrgent ? 'Urgent' : 'Normal',
      status: 'waiting',
      archived: false,
      deviceToken: patient.deviceToken || null
    });

    writeBackupLog('ADD_VISIT', { visitId: uniqueVisitId, tokenNumber: nextTokenStr, name: patient.name });

    const state = await fetchSystemState();
    
    // Retrieve AI-predicted wait time for this visit to store as baseline
    const matchedVisit = state.visits.find(v => v._id.toString() === newVisit._id.toString());
    const predictedWait = matchedVisit ? matchedVisit.predictedWaitTime : 10;
    
    newVisit.initialPredictedWaitTime = predictedWait;
    await newVisit.save();

    // Trigger token created notification safely (non-blocking)
    try {
      NotificationService.sendTokenCreated(patient, nextTokenStr, reasonForVisit, predictedWait);
    } catch (err) {
      console.error('[Notification Trigger Error] Token Created:', err.message);
    }

    const waitingCount = state.visits.filter(v => v.status === 'waiting').length;

    // Real-Time Multi-Screen Sockets Broadcasts (Double Emit for custom events)
    io.emit('patient-added', { patient, visit: newVisit });
    io.emit('patientAdded', { patient, visit: newVisit });
    
    io.emit('token-generated', { tokenNumber: nextTokenStr, visit: newVisit });
    
    io.emit('queue-updated', state);
    io.emit('queueUpdated', state);
    
    io.emit('estimated-wait-updated', { estWaitTime: waitingCount * state.avgConsultationTime });

    res.status(201).json({ success: true, visit: newVisit });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Call Next Patient
export const callNext = async (req, res) => {
  try {
    let nextVisit = await Visit.findOne({ status: 'waiting', priority: 'Urgent', archived: { $ne: true } }).sort({ tokenSeq: 1 });
    if (!nextVisit) {
      nextVisit = await Visit.findOne({ status: 'waiting', priority: 'Normal', archived: { $ne: true } }).sort({ tokenSeq: 1 });
    }

    if (!nextVisit) {
      return res.status(404).json({ success: false, error: 'No patients waiting in queue.' });
    }

    // Set currently serving to completed
    await Visit.updateMany(
      { status: 'serving', archived: { $ne: true } },
      { $set: { status: 'completed' } }
    );

    nextVisit.status = 'serving';
    await nextVisit.save();

    const populatedVisit = await nextVisit.populate('patientId');
    try {
      if (populatedVisit.patientId) {
        NotificationService.sendNowServing(populatedVisit.patientId, populatedVisit.tokenNumber);
      }
    } catch (nErr) {
      console.error('[Notification Trigger Error] Now Serving:', nErr.message);
    }

    let config = await ClinicState.findOne({ id: 'GLOBAL_CONFIG' });
    if (!config) {
      config = new ClinicState({ id: 'GLOBAL_CONFIG' });
    }
    config.currentToken = nextVisit.tokenNumber;
    config.currentTokenSeq = nextVisit.tokenSeq;
    await config.save();

    writeBackupLog('CALL_NEXT', { tokenNumber: nextVisit.tokenNumber, visitId: nextVisit.visitId });

    const state = await fetchSystemState();
    const waitingCount = state.visits.filter(v => v.status === 'waiting').length;

    // Real-Time Multi-Screen Sockets Broadcasts (Double Emit for compatibility)
    io.emit('call-next', { tokenNumber: nextVisit.tokenNumber, visit: nextVisit });
    io.emit('tokenCalled', { tokenNumber: nextVisit.tokenNumber, visit: nextVisit });
    
    io.emit('queue-updated', state);
    io.emit('queueUpdated', state);
    
    io.emit('estimated-wait-updated', { estWaitTime: waitingCount * state.avgConsultationTime });

    res.json({ success: true, currentToken: nextVisit.tokenNumber, visit: nextVisit });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Skip Active Serving Patient
export const skipVisit = async (req, res) => {
  try {
    const activeServing = await Visit.findOne({ status: 'serving', archived: { $ne: true } }).populate('patientId');
    if (!activeServing) {
      return res.status(404).json({ success: false, error: 'No patient is currently being served to skip.' });
    }

    activeServing.status = 'skipped';
    await activeServing.save();

    writeBackupLog('SKIP_PATIENT', { tokenNumber: activeServing.tokenNumber, name: activeServing.patientId?.name });

    const state = await fetchSystemState();
    const waitingCount = state.visits.filter(v => v.status === 'waiting').length;

    // Real-Time Multi-Screen Sockets Broadcasts
    io.emit('queue-updated', state);
    io.emit('estimated-wait-updated', { estWaitTime: waitingCount * state.avgConsultationTime });

    res.json({ success: true, message: `Token #${activeServing.tokenNumber} marked as skipped.` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Complete Active Serving Patient
export const completeVisit = async (req, res) => {
  try {
    const activeServing = await Visit.findOne({ status: 'serving', archived: { $ne: true } }).populate('patientId');
    if (!activeServing) {
      return res.status(404).json({ success: false, error: 'No patient is currently being served to complete.' });
    }

    activeServing.status = 'completed';
    await activeServing.save();

    // Trigger consultation completed notification safely (non-blocking)
    try {
      if (activeServing.patientId) {
        NotificationService.sendCompleted(activeServing.patientId, activeServing.tokenNumber);
      }
    } catch (nErr) {
      console.error('[Notification Trigger Error] Consultation Completed:', nErr.message);
    }

    // Recalculate rolling average consultation time
    const startTime = new Date(activeServing.updatedAt).getTime();
    const endTime = Date.now();
    const durationMins = Math.max(1, Math.round((endTime - startTime) / 60000));

    const recentCompletedVisits = await Visit.find({ status: 'completed' })
      .sort({ updatedAt: -1 })
      .limit(10);

    let totalDuration = 0;
    let validCount = 0;
    for (const v of recentCompletedVisits) {
      const diffMs = new Date(v.updatedAt).getTime() - new Date(v.createdAt).getTime();
      const mins = Math.max(1, Math.round(diffMs / 60000));
      totalDuration += mins;
      validCount++;
    }

    const newAvgTime = validCount > 0 ? Math.round(totalDuration / validCount) : 10;

    let config = await ClinicState.findOne({ id: 'GLOBAL_CONFIG' });
    if (!config) {
      config = new ClinicState({ id: 'GLOBAL_CONFIG' });
    }
    config.avgConsultationTime = Math.max(1, newAvgTime);
    await config.save();

    writeBackupLog('COMPLETE_PATIENT', { tokenNumber: activeServing.tokenNumber, name: activeServing.patientId?.name });

    const state = await fetchSystemState();
    const waitingCount = state.visits.filter(v => v.status === 'waiting').length;

    // Real-Time Multi-Screen Sockets Broadcasts
    io.emit('consultation-completed', { tokenNumber: activeServing.tokenNumber });
    io.emit('queue-updated', state);
    io.emit('estimated-wait-updated', { estWaitTime: waitingCount * state.avgConsultationTime });

    res.json({ success: true, message: `Token #${activeServing.tokenNumber} marked as completed.` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Set average consultation time manually
export const setTime = async (req, res) => {
  const { avgConsultationTime } = req.body;
  const parsedTime = parseInt(avgConsultationTime, 10);

  if (isNaN(parsedTime) || parsedTime < 1) {
    return res.status(400).json({ success: false, error: 'Invalid average consultation time.' });
  }

  try {
    let config = await ClinicState.findOne({ id: 'GLOBAL_CONFIG' });
    if (!config) {
      config = new ClinicState({ id: 'GLOBAL_CONFIG' });
    }
    config.avgConsultationTime = parsedTime;
    await config.save();

    writeBackupLog('SET_TIME', { avgConsultationTime: parsedTime });

    const state = await fetchSystemState();
    const waitingCount = state.visits.filter(v => v.status === 'waiting').length;

    io.emit('queue-updated', state);
    io.emit('estimated-wait-updated', { estWaitTime: waitingCount * state.avgConsultationTime });

    res.json({ success: true, avgConsultationTime: parsedTime });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Fallback sync endpoint
export const getCurrentState = async (req, res) => {
  try {
    const state = await fetchSystemState();
    res.json({ success: true, ...state });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Doctor Emergency Overrides Approval API
export const approveEmergency = async (req, res) => {
  const { id } = req.params;
  try {
    const visit = await Visit.findById(id).populate('patientId');
    if (!visit) {
      return res.status(404).json({ success: false, error: 'Visit override record not found.' });
    }

    visit.priority = 'Urgent';
    visit.priorityPendingApproval = 'Normal'; // Clear request state
    await visit.save();

    writeBackupLog('APPROVE_EMERGENCY', { visitId: visit.visitId, tokenNumber: visit.tokenNumber, name: visit.patientId?.name });

    const state = await fetchSystemState();
    io.emit('queue-updated', state);

    res.json({ success: true, visit });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Doctor Emergency Overrides Decline API
export const declineEmergency = async (req, res) => {
  const { id } = req.params;
  try {
    const visit = await Visit.findById(id).populate('patientId');
    if (!visit) {
      return res.status(404).json({ success: false, error: 'Visit override record not found.' });
    }

    visit.priorityPendingApproval = 'Normal'; // Cancel request state
    await visit.save();

    writeBackupLog('DECLINE_EMERGENCY', { visitId: visit.visitId, tokenNumber: visit.tokenNumber, name: visit.patientId?.name });

    const state = await fetchSystemState();
    io.emit('queue-updated', state);

    res.json({ success: true, visit });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Fetch Historical Daily Reports
export const getDailyReports = async (req, res) => {
  try {
    const reports = await DailyReport.find().sort({ date: -1 });
    res.json({ success: true, reports });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Fetch Live Audit Notification Logs
export const getNotificationLogs = async (req, res) => {
  try {
    const logs = await NotificationLog.find()
      .populate('patientId')
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Scheduler: Scan for serving patients unanswered for 3+ minutes
export const startMissedPatientScanner = () => {
  console.log('[Scheduler] Missed Patient Reminder background scanner started.');
  setInterval(async () => {
    try {
      const activeServingVisits = await Visit.find({ status: 'serving', archived: { $ne: true } }).populate('patientId');
      
      for (const visit of activeServingVisits) {
        if (!visit.patientId) continue;
        
        const elapsedMs = Date.now() - new Date(visit.updatedAt).getTime();
        const elapsedMins = elapsedMs / 60000;
        
        if (elapsedMins >= 3) {
          // Check if reminder was already dispatched for this session/token
          const alreadyReminded = await NotificationLog.findOne({
            patientId: visit.patientId._id,
            tokenNumber: visit.tokenNumber,
            type: 'reminder'
          });

          if (!alreadyReminded) {
            console.log(`[Scheduler] Patient ${visit.patientId.name} (Token #${visit.tokenNumber}) serving time > 3m. Dispatched reminder.`);
            try {
              await NotificationService.sendReminder(visit.patientId, visit.tokenNumber);
            } catch (nErr) {
              console.error('[Notification Trigger Error] Missed Patient Reminder:', nErr.message);
            }
          }
        }
      }
    } catch (err) {
      console.error('[Scheduler Error] Missed patient scan failed:', err.message);
    }
  }, 30000); // scan every 30 seconds
};

// Register FCM Device Token for a Patient / Visit
export const registerDeviceToken = async (req, res) => {
  const { visitId, deviceToken } = req.body;
  if (!visitId || !deviceToken) {
    return res.status(400).json({ success: false, error: 'Visit ID and device token are required.' });
  }

  try {
    const visit = await Visit.findById(visitId).populate('patientId');
    if (!visit) {
      return res.status(404).json({ success: false, error: 'Visit record not found.' });
    }

    visit.deviceToken = deviceToken;
    await visit.save();

    if (visit.patientId) {
      visit.patientId.deviceToken = deviceToken;
      await visit.patientId.save();
    }

    console.log(`[Firebase FCM] Device token registered for Token #${visit.tokenNumber} (${visit.patientId?.name || 'Patient'})`);
    res.json({ success: true, message: 'Device token registered successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Rejoin Queue after being skipped
export const rejoinQueue = async (req, res) => {
  const { id } = req.params;
  try {
    const visit = await Visit.findById(id).populate('patientId');
    if (!visit) {
      return res.status(404).json({ success: false, error: 'Visit not found.' });
    }

    if (visit.status !== 'skipped' && visit.status !== 'absent') {
      return res.status(400).json({ success: false, error: 'Only skipped or absent patients can rejoin the queue.' });
    }

    // Assign the patient to the end of the queue by incrementing sequence
    const maxVisit = await Visit.findOne({ archived: { $ne: true } }).sort({ tokenSeq: -1 });
    let nextSeq = 1;
    if (maxVisit) {
      const lastSeq = maxVisit.tokenSeq || parseInt(String(maxVisit.tokenNumber).replace(/\D/g, ''), 10) || 0;
      nextSeq = lastSeq + 1;
    }
    const nextTokenStr = "A" + (100 + nextSeq);

    // Reset visit states and sequence details
    visit.status = 'waiting';
    visit.tokenSeq = nextSeq;
    visit.tokenNumber = nextTokenStr;
    visit.alert5Sent = false;
    visit.alert2Sent = false;
    visit.alertServingSent = false;
    visit.approachingAlertSent = false;
    visit.delayAlertSent = false;
    await visit.save();

    writeBackupLog('REJOIN_QUEUE', { visitId: visit.visitId, tokenNumber: nextTokenStr, name: visit.patientId?.name });

    const state = await fetchSystemState();

    // Broadcast Socket.IO events (Double Emit for compatibility)
    io.emit('queue-updated', state);
    io.emit('queueUpdated', state);
    
    io.emit('patient-rejoined', { visit, state });
    io.emit('patientRejoined', { visit, state });

    console.log(`[Queue Rejoin] Patient ${visit.patientId?.name} rejoined with new Token #${nextTokenStr}`);
    res.json({ success: true, visit, message: `Successfully rejoined queue with new token #${nextTokenStr}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Retrieve notification history for a specific visit
export const getVisitNotifications = async (req, res) => {
  const { id } = req.params;
  try {
    const visit = await Visit.findById(id);
    if (!visit) {
      return res.status(404).json({ success: false, error: 'Visit record not found.' });
    }
    const logs = await NotificationLog.find({ 
      patientId: visit.patientId, 
      tokenNumber: visit.tokenNumber 
    }).sort({ createdAt: -1 });
    
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
