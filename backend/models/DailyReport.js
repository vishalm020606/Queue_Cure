import mongoose from 'mongoose';

const DailyReportSchema = new mongoose.Schema({
  date: { type: String, unique: true, required: true }, // Format: YYYY-MM-DD
  patientsServed: { type: Number, default: 0 },
  avgWaitTime: { type: Number, default: 0 }, // in minutes
  emergencyCases: { type: Number, default: 0 },
  doctorUtilization: { type: Number, default: 0 }, // consultation count or consultation average duration
  consultationCount: { type: Number, default: 0 }
}, { timestamps: true });

export default mongoose.model('DailyReport', DailyReportSchema);
