import Consultation from '../models/Consultation.js';
import Visit from '../models/Visit.js';
import ClinicState from '../models/ClinicState.js';
import { fetchSystemState, writeBackupLog } from './QueueController.js';
import NotificationService from '../services/NotificationService.js';
import { io } from '../server.js';

// GET /api/patient/:id/history: Fetch historic consultations matching patient MongoDB Object ID
export const getPatientHistory = async (req, res) => {
  const { id } = req.params;

  try {
    const history = await Consultation.find({ patientId: id })
      .populate('visitId')
      .populate('patientId')
      .sort({ createdAt: -1 });

    res.json({ success: true, history });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// POST /api/consultation/submit: Doctor submits clinical record, updates Visit to completed
export const submitConsultation = async (req, res) => {
  const { visitId, patientId, symptoms, diagnosis, prescription, notes, followUpDate } = req.body;

  if (!visitId || !patientId || !diagnosis) {
    return res.status(400).json({ success: false, error: 'Visit ID, Patient ID, and Diagnosis are required.' });
  }

  try {
    const visit = await Visit.findById(visitId).populate('patientId');
    if (!visit) {
      return res.status(404).json({ success: false, error: 'Visit not found.' });
    }

    // Generate unique Consultation ID
    const consultationCount = await Consultation.countDocuments();
    const formattedId = `CONS-${Date.now()}-${String(consultationCount + 1).padStart(3, '0')}`;

    const newConsultation = await Consultation.create({
      consultationId: formattedId,
      visitId,
      patientId,
      symptoms: symptoms || [],
      diagnosis,
      prescription: prescription || [],
      notes,
      followUpDate
    });

    // Calculate active serving duration for this patient visit
    const startTime = new Date(visit.updatedAt).getTime(); // Time marked as 'serving'
    const endTime = Date.now();
    const durationMins = Math.max(1, Math.round((endTime - startTime) / 60000)); // Minimum 1 minute

    // Mark visit status completed
    visit.status = 'completed';
    await visit.save();

    // Trigger consultation completed notification safely (non-blocking)
    try {
      if (visit.patientId) {
        NotificationService.sendCompleted(visit.patientId, visit.tokenNumber);
      }
    } catch (nErr) {
      console.error('[Notification Trigger Error] Consultation Completed:', nErr.message);
    }

    // Recalculate average consultation time dynamically (using the last 10 completed visits)
    const recentCompletedVisits = await Visit.find({ status: 'completed' })
      .sort({ updatedAt: -1 })
      .limit(10);

    let totalDuration = 0;
    let validCount = 0;

    for (const v of recentCompletedVisits) {
      // Calculate duration between createdAt and updatedAt as a fallback if serving start wasn't recorded,
      // but since updatedAt was set at serving and completed, this is accurate.
      // Let's assume average duration is captured by the difference in timestamps
      const durationMs = new Date(v.updatedAt).getTime() - new Date(v.createdAt).getTime();
      const mins = Math.max(1, Math.round(durationMs / 60000));
      totalDuration += mins;
      validCount++;
    }

    const newAvgTime = validCount > 0 ? Math.round(totalDuration / validCount) : 10;

    // Save to ClinicState
    let config = await ClinicState.findOne({ id: 'GLOBAL_CONFIG' });
    if (!config) {
      config = new ClinicState({ id: 'GLOBAL_CONFIG' });
    }
    config.avgConsultationTime = Math.max(1, newAvgTime);
    await config.save();

    // Write backup logs
    writeBackupLog('SUBMIT_CONSULTATION', { 
      consultationId: formattedId, 
      visitId, 
      durationMinutes: durationMins,
      newAvgConsultationTime: config.avgConsultationTime 
    });

    // Broadcast updated queue state
    const state = await fetchSystemState();
    io.emit('queue-updated', state);

    res.status(201).json({ success: true, consultation: newConsultation });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
