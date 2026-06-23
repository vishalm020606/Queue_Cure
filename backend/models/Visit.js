import mongoose from 'mongoose';

const VisitSchema = new mongoose.Schema({
  visitId: { type: String, unique: true, required: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  tokenNumber: { type: String, required: true },
  tokenSeq: { type: Number },
  reasonForVisit: String,
  priority: { type: String, enum: ['Normal', 'Urgent'], default: 'Normal' },
  status: { 
    type: String, 
    enum: ['waiting', 'serving', 'completed', 'absent', 'skipped'], 
    default: 'waiting' 
  },
  priorityPendingApproval: { type: String, enum: ['Normal', 'Urgent'], default: 'Normal' },
  archived: { type: Boolean, default: false },
  approachingAlertSent: { type: Boolean, default: false },
  initialPredictedWaitTime: { type: Number, default: 0 },
  delayAlertSent: { type: Boolean, default: false },
  alert5Sent: { type: Boolean, default: false },
  alert2Sent: { type: Boolean, default: false },
  alertServingSent: { type: Boolean, default: false },
  deviceToken: { type: String }
}, { timestamps: true });

export default mongoose.model('Visit', VisitSchema);
