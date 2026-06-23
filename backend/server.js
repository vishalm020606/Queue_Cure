import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import os from 'os';
import connectDB from './config/db.js';
import { authenticateJWT, authorizeRoles } from './middleware/auth.js';

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);

// Initialize and export Socket.io first to prevent import racing
export const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Import controllers after Socket.io is exported
import { 
  register, 
  login, 
  seedDefaultUsers 
} from './controllers/AuthController.js';
import { 
  registerPatient, 
  addVisit, 
  callNext, 
  skipVisit,
  completeVisit,
  setTime, 
  getCurrentState,
  fetchSystemState,
  approveEmergency,
  declineEmergency,
  getDailyReports,
  startMissedPatientScanner,
  getNotificationLogs,
  registerDeviceToken,
  rejoinQueue,
  getVisitNotifications
} from './controllers/QueueController.js';
import { 
  getPatientHistory, 
  submitConsultation 
} from './controllers/MedicalController.js';

// Resolve local LAN IP
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const interfaceName in interfaces) {
    for (const iface of interfaces[interfaceName]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Connect to local MongoDB instance
connectDB().then(() => {
  // Seed default admin/doctor users
  seedDefaultUsers();
  // Start background missed patient scanner
  startMissedPatientScanner();
});

// ==========================================
// Authentication Routes (Public)
// ==========================================
app.post('/api/auth/register', register);
app.post('/api/auth/login', login);

// ==========================================
// Public Routes
// ==========================================
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: "Queue Cure backend server is running successfully.",
    status: "online",
    database: "connected",
    endpoints: {
      publicState: "/api/current-state"
    }
  });
});

// Patient waiting room needs to sync without requiring authorization headers
app.get('/api/current-state', getCurrentState);
app.post('/api/register-device-token', registerDeviceToken);
app.post('/api/visit/:id/rejoin', rejoinQueue);
app.get('/api/visit/:id/notifications', getVisitNotifications);

// ==========================================
// Receptionist & Doctor Routes (Secured)
// ==========================================
app.post(
  '/api/register-patient', 
  authenticateJWT, 
  authorizeRoles('receptionist', 'doctor'), 
  registerPatient
);

app.post(
  '/api/add-visit', 
  authenticateJWT, 
  authorizeRoles('receptionist', 'doctor'), 
  addVisit
);

app.post(
  '/api/call-next', 
  authenticateJWT, 
  authorizeRoles('receptionist', 'doctor'), 
  callNext
);

app.post(
  '/api/set-time', 
  authenticateJWT, 
  authorizeRoles('receptionist', 'doctor'), 
  setTime
);

app.post(
  '/api/skip-token',
  authenticateJWT,
  authorizeRoles('receptionist', 'doctor'),
  skipVisit
);

app.post(
  '/api/complete-token',
  authenticateJWT,
  authorizeRoles('receptionist', 'doctor'),
  completeVisit
);

// Emergency Prioritization Overrides
app.post(
  '/api/visit/:id/approve-emergency',
  authenticateJWT,
  authorizeRoles('doctor'),
  approveEmergency
);

app.post(
  '/api/visit/:id/decline-emergency',
  authenticateJWT,
  authorizeRoles('doctor'),
  declineEmergency
);

// Historical Daily Reports
app.get(
  '/api/reports',
  authenticateJWT,
  authorizeRoles('receptionist', 'doctor'),
  getDailyReports
);

// Live Audit Notification Logs
app.get(
  '/api/notifications/logs',
  authenticateJWT,
  authorizeRoles('receptionist', 'doctor'),
  getNotificationLogs
);

// ==========================================
// Doctor Specific Routes (Secured)
// ==========================================
app.get(
  '/api/patient/:id/history', 
  authenticateJWT, 
  authorizeRoles('doctor'), 
  getPatientHistory
);

app.post(
  '/api/consultation/submit', 
  authenticateJWT, 
  authorizeRoles('doctor'), 
  submitConsultation
);

// Real-Time Socket Connection Bindings
io.on('connection', async (socket) => {
  console.log(`Socket client connected: ${socket.id}`);
  
  try {
    const state = await fetchSystemState();
    socket.emit('queue-updated', state);
  } catch (error) {
    console.error('Socket state sending error:', error.message);
  }

  socket.on('disconnect', () => {
    console.log(`Socket client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
const LOCAL_IP = getLocalIpAddress();

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log(` Queue Cure '26 Enterprise Stack Started.`);
  console.log(` Local Admin Console: http://localhost:${PORT}`);
  console.log(` Clinic LAN Broadcast: http://${LOCAL_IP}:${PORT}`);
  console.log('====================================================');
});
