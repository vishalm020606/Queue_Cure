import NotificationLog from '../models/NotificationLog.js';
import Patient from '../models/Patient.js';
import Visit from '../models/Visit.js';
import TRANSLATIONS from '../utils/translations.js';
import { getMessaging } from '../config/firebase.js';
import { io } from '../server.js';

// Specific Rule Wording Helper
const getCustomRuleMessage = (type, lang, tokenNumber, placeholders) => {
  const translations = {
    English: {
      rule5: "Your turn is approaching. Only 5 patients are ahead of you.",
      rule2: "Please proceed towards the clinic. Only 2 patients are ahead.",
      rule3: `Token ${tokenNumber} is now being called. Please enter Consultation Room 1.`
    },
    Tamil: {
      rule5: "உங்கள் முறை நெருங்குகிறது. இன்னும் 5 பேர் மட்டுமே உங்களுக்கு முன் உள்ளனர்.",
      rule2: "தயவுசெய்து மருத்துவமனைக்கு அருகில் தயாராக இருக்கவும். இன்னும் 2 பேர் மட்டுமே முன் உள்ளனர்.",
      rule3: `டோக்கன் ${tokenNumber} தற்போது அழைக்கப்படுகிறது. தயவுசெய்து ஆலோசனை அறைக்குள் வரவும்.`
    },
    Hindi: {
      rule5: "आपकी बारी आने वाली है। आपके आगे केवल 5 मरीज बचे हैं।",
      rule2: "कृपया क्लिनिक की ओर बढ़ें। केवल 2 मरीज आगे हैं।",
      rule3: `टोकन ${tokenNumber} को अब बुलाया जा रहा है। कृपया परामर्श कक्ष 1 में प्रवेश करें।`
    }
  };

  const selectedLang = translations[lang] || translations['English'];

  if (type === 'approaching') {
    if (placeholders.ahead === 5) {
      return selectedLang.rule5;
    }
    if (placeholders.ahead === 2) {
      return selectedLang.rule2;
    }
  } else if (type === 'nowServing') {
    return selectedLang.rule3;
  }

  return null;
};

const formatMessage = (template, placeholders = {}) => {
  let message = template;
  for (const key in placeholders) {
    message = message.replace(new RegExp(`{{${key}}}`, 'g'), placeholders[key]);
  }
  return message;
};


// Dispatch normal channel + simultaneously FCM push + WhatsApp
const dispatchMultiNotification = async (patient, tokenNumber, type, placeholders) => {
  try {
    const lang = patient.preferredLanguage || 'English';
    const templates = TRANSLATIONS[lang] || TRANSLATIONS['English'];
    const template = templates[type] || TRANSLATIONS['English'][type] || '';
    
    // Check if there is a custom rule text
    let message = getCustomRuleMessage(type, lang, tokenNumber, placeholders);
    if (!message) {
      // Fallback to standard translation templates
      const enrichedPlaceholders = {
        name: patient.name || 'Patient',
        ...placeholders
      };
      message = formatMessage(template, enrichedPlaceholders);
    }

    const prefChannel = patient.notificationPreference || 'sms';

    // 1. Log Normal Message to console in original format (SMS / WhatsApp / Voice)
    const logPrefix = `[${prefChannel.toUpperCase()} ${type}] To: ${patient.phone} (${patient.name})`;
    console.log(`${logPrefix} => "${message}"`);

    // Record the normal notification in the audit log database
    const normalLog = await NotificationLog.create({
      patientId: patient._id,
      tokenNumber: String(tokenNumber || 0),
      type,
      channel: prefChannel,
      message,
      status: 'sent',
      sentAt: new Date()
    });
    const populatedNormalLog = await normalLog.populate('patientId');
    io.emit('notification-logged', populatedNormalLog);

    // 2. Simultaneously send FCM Push Notification (if deviceToken is present)
    const deviceToken = patient.deviceToken || null;
    if (deviceToken) {
      let pushStatus = 'sent';
      const messaging = getMessaging();
      if (messaging) {
        try {
          const payload = {
            notification: {
              title: `Queue Cure - Token #${tokenNumber}`,
              body: message
            },
            token: deviceToken
          };
          await messaging.send(payload);
          console.log(`[PUSH ${type}] To: ${patient.name} (${deviceToken.slice(0, 10)}...) => "${message}"`);
        } catch (error) {
          console.error(`[PUSH Fail] To: ${patient.name}:`, error.message);
          pushStatus = 'failed';

          // Invalid token cleanup
          const isInvalid = error.code === 'messaging/invalid-registration-token' ||
                             error.code === 'messaging/registration-token-not-registered' ||
                             error.message.includes('registration-token-not-registered') ||
                             error.message.includes('not-registered');
          if (isInvalid) {
            console.log(`[Firebase] Clearing invalid device token for patient "${patient.name}"`);
            await Patient.findByIdAndUpdate(patient._id, { $unset: { deviceToken: 1 } });
            await Visit.updateMany({ patientId: patient._id }, { $unset: { deviceToken: 1 } });
          }
        }
      } else {
        console.log(`[PUSH ${type}] (Simulated) To: ${patient.name} => "${message}"`);
      }

      // Log push notification to DB
      const pushLog = await NotificationLog.create({
        patientId: patient._id,
        tokenNumber: String(tokenNumber || 0),
        type,
        channel: 'push',
        message,
        status: pushStatus,
        sentAt: new Date()
      });
      const populatedPushLog = await pushLog.populate('patientId');
      io.emit('notification-logged', populatedPushLog);
      io.emit('notification-triggered', { channel: 'push', log: populatedPushLog });
    }

    // 3. Simultaneously send WhatsApp Message (if the preferred channel was NOT already WhatsApp)
    if (prefChannel !== 'whatsapp') {
      console.log(`[WHATSAPP ${type}] To: ${patient.phone} (${patient.name}) => "${message}"`);

      // Log WhatsApp notification to DB
      const waLog = await NotificationLog.create({
        patientId: patient._id,
        tokenNumber: String(tokenNumber || 0),
        type,
        channel: 'whatsapp',
        message,
        status: 'sent',
        sentAt: new Date()
      });
      const populatedWaLog = await waLog.populate('patientId');
      io.emit('notification-logged', populatedWaLog);
      io.emit('notification-triggered', { channel: 'whatsapp', log: populatedWaLog });
    }

  } catch (error) {
    console.error(`[Notification Service Fail] Event ${type} failed to dispatch:`, error.message);
  }
};

export const NotificationService = {
  sendTokenCreated: async (patient, tokenNumber, reason, wait) => {
    await dispatchMultiNotification(patient, tokenNumber, 'tokenCreated', { 
      token: tokenNumber,
      reason: reason || 'General Checkup',
      wait: wait || 10
    });
  },

  // Rule 1: 5 Patients Ahead
  sendRule5Ahead: async (patient, tokenNumber) => {
    await dispatchMultiNotification(patient, tokenNumber, 'approaching', { 
      ahead: 5, 
      token: tokenNumber 
    });
  },

  // Rule 2: 2 Patients Ahead
  sendRule2Ahead: async (patient, tokenNumber) => {
    await dispatchMultiNotification(patient, tokenNumber, 'approaching', { 
      ahead: 2, 
      token: tokenNumber 
    });
  },

  // Rule 3: Current Token Called
  sendNowServing: async (patient, tokenNumber) => {
    await dispatchMultiNotification(patient, tokenNumber, 'nowServing', { 
      token: tokenNumber 
    });
  },

  sendDelayed: async (patient, delayMins, tokenNumber) => {
    await dispatchMultiNotification(patient, tokenNumber, 'delayed', { 
      mins: delayMins, 
      token: tokenNumber 
    });
  },

  sendCompleted: async (patient, tokenNumber) => {
    await dispatchMultiNotification(patient, tokenNumber, 'completed', { 
      token: tokenNumber 
    });
  },

  sendReminder: async (patient, tokenNumber) => {
    await dispatchMultiNotification(patient, tokenNumber, 'reminder', { 
      token: tokenNumber 
    });
  }
};

export default NotificationService;
