import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

let firebaseApp = null;
const credentialsPath = path.resolve(process.cwd(), 'firebase-credentials.json');

try {
  if (fs.existsSync(credentialsPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('[Firebase] Admin SDK initialized successfully using local credentials file.');
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('[Firebase] Admin SDK initialized successfully using environment variable credentials.');
  } else {
    console.log('[Firebase] Credentials file not found at:', credentialsPath);
    console.log('[Firebase] Running in SIMULATED mode. Push notifications will be logged to server console.');
  }
} catch (err) {
  console.error('[Firebase] Failed to initialize Firebase Admin SDK:', err.message);
  console.log('[Firebase] Falling back to SIMULATED mode.');
}

export const getMessaging = () => {
  if (firebaseApp) {
    return admin.messaging();
  }
  return null;
};

export default firebaseApp;
