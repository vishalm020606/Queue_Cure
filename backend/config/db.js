import mongoose from 'mongoose';
import Visit from '../models/Visit.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/queue_cure';

export const connectDB = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    const isLocal = MONGODB_URI.includes('127.0.0.1') || MONGODB_URI.includes('localhost');
    console.log(`MongoDB successfully connected to ${isLocal ? 'local instance' : 'cloud (Atlas)'}.`);

    // Auto-migrate legacy visits to set tokenSeq
    try {
      const legacyVisits = await Visit.find({ tokenSeq: { $exists: false } });
      if (legacyVisits.length > 0) {
        console.log(`[Migration] Found ${legacyVisits.length} legacy visits. Migrating...`);
        for (const v of legacyVisits) {
          const seq = parseInt(String(v.tokenNumber).replace(/\D/g, ''), 10) || 0;
          v.tokenSeq = seq;
          await v.save({ validateBeforeSave: false }); // bypass validation to save safely
        }
        console.log('[Migration] Legacy visits migration completed successfully.');
      }
    } catch (migErr) {
      console.error('[Migration Error] Failed to migrate legacy visits:', migErr.message);
    }
  } catch (error) {
    console.error('MongoDB connection failure:', error.message);
    process.exit(1);
  }
};

export default connectDB;
