import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['receptionist', 'doctor'], required: true }
}, { timestamps: true });

export default mongoose.model('User', UserSchema);
