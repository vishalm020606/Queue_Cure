import mongoose from 'mongoose';
import Patient from './models/Patient.js';
import Visit from './models/Visit.js';
import ClinicState from './models/ClinicState.js';
import DailyReport from './models/DailyReport.js';
import NotificationLog from './models/NotificationLog.js';
import Consultation from './models/Consultation.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/queue_cure';

async function clearDatabase() {
  try {
    console.log('Connecting to database...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB.');

    console.log('Clearing Patient collection...');
    await Patient.deleteMany({});
    
    console.log('Clearing Visit collection...');
    await Visit.deleteMany({});

    console.log('Clearing NotificationLog collection...');
    await NotificationLog.deleteMany({});

    console.log('Clearing Consultation collection...');
    await Consultation.deleteMany({});

    console.log('Clearing DailyReport collection...');
    await DailyReport.deleteMany({});

    console.log('Resetting ClinicState (GLOBAL_CONFIG)...');
    await ClinicState.findOneAndUpdate(
      { id: 'GLOBAL_CONFIG' },
      { currentToken: "0", currentTokenSeq: 0 },
      { upsert: true }
    );

    console.log('==================================================');
    console.log(' Database cleared successfully! Queue is now empty.');
    console.log('==================================================');

  } catch (error) {
    console.error('Error clearing database:', error.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

clearDatabase();
