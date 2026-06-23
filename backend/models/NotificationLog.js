import mongoose from 'mongoose';

const NotificationLogSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  tokenNumber: { type: String, required: true },
  type: { type: String, required: true }, // TOKEN_CREATED, APPROACHING_ALERT, NOW_SERVING, DELAYED, COMPLETED, REMINDER
  channel: { type: String, enum: ['sms', 'whatsapp', 'voice', 'push'], required: true },
  message: { type: String, required: true },
  status: { type: String, enum: ['sent', 'failed', 'queued'], default: 'sent' },
  sentAt: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.model('NotificationLog', NotificationLogSchema);
