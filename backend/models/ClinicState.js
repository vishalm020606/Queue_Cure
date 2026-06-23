import mongoose from 'mongoose';

const ClinicStateSchema = new mongoose.Schema({
  id: { type: String, default: "GLOBAL_CONFIG", unique: true },
  currentToken: { type: String, default: "0" },
  currentTokenSeq: { type: Number, default: 0 },
  avgConsultationTime: { type: Number, default: 10 },
  lastResetDate: { type: String }
}, { timestamps: true });

export default mongoose.model('ClinicState', ClinicStateSchema);
