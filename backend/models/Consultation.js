import mongoose from 'mongoose';

const ConsultationSchema = new mongoose.Schema({
  consultationId: { type: String, unique: true, required: true },
  visitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Visit', required: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  symptoms: [String],
  diagnosis: String,
  prescription: [{ 
    medicine: { type: String, required: true }, 
    dosage: { type: String, required: true }, 
    frequency: { type: String, required: true }, 
    duration: { type: String, required: true } 
  }],
  notes: String,
  followUpDate: Date
}, { timestamps: true });

export default mongoose.model('Consultation', ConsultationSchema);
