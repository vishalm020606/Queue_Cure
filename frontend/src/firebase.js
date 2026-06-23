import { initializeApp } from 'firebase/app';
import { getMessaging, getToken } from 'firebase/messaging';

// Firebase configuration. In production, provide these via environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "mock-api-key",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "mock-app.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "mock-project",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "mock-app.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1234567890",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:1234567890:web:abcdef123456"
};

let messaging = null;
let isSimulated = true;

try {
  // If config is not mocked, initialize real FCM
  if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "mock-api-key") {
    const app = initializeApp(firebaseConfig);
    messaging = getMessaging(app);
    isSimulated = false;
    console.log("[Firebase] SDK initialized successfully in production mode.");
  } else {
    console.log("[Firebase] running in SIMULATED mode. Local test tokens will be generated.");
  }
} catch (error) {
  console.error("[Firebase] SDK initialization failed:", error);
}

export const requestFirebaseToken = async () => {
  if (isSimulated || !messaging) {
    console.log("[Firebase] Simulated Device Token generated.");
    // Request permission anyway to show standard browser prompt simulation
    try {
      if (window.Notification) {
        await window.Notification.requestPermission();
      }
    } catch (e) {}
    return "FCM_DEVICE_TOKEN_" + Math.random().toString(36).substring(2, 10).toUpperCase();
  }

  try {
    const permission = await window.Notification.requestPermission();
    if (permission === 'granted') {
      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY || undefined;
      const currentToken = await getToken(messaging, { vapidKey });
      if (currentToken) {
        return currentToken;
      } else {
        console.warn('[Firebase] No registration token received from FCM gateway.');
        return null;
      }
    } else {
      console.warn('[Firebase] Notifications permission denied.');
      return null;
    }
  } catch (error) {
    console.error('[Firebase] Error fetching FCM token:', error);
    return "FCM_FALLBACK_TOKEN_" + Math.random().toString(36).substring(2, 10).toUpperCase();
  }
};

export { messaging };
