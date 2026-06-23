import mongoose from 'mongoose';

const PatientSchema = new mongoose.Schema({
  patientId: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  age: { type: Number, required: true },
  gender: { type: String, enum: ['Male', 'Female', 'Other'], required: true },
  phone: { type: String, required: true, index: true },
  address: String,
  emergencyContact: String,
  bloodGroup: String,
  preferredLanguage: { 
    type: String, 
    enum: ['English', 'Tamil', 'Hindi', 'Telugu', 'Kannada', 'Malayalam'], 
    default: 'English' 
  },
  notificationPreference: {
    type: String,
    enum: ['sms', 'whatsapp', 'voice'],
    default: 'sms'
  },
  deviceToken: { type: String }
}, { timestamps: true });

export default mongoose.model('Patient', PatientSchema);
