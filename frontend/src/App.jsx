import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import ReceptionistDashboard from './pages/ReceptionistDashboard';
import DoctorDashboard from './pages/DoctorDashboard';
import PatientRoomView from './pages/PatientRoomView';
import PatientQueue from './pages/PatientQueue';

// Route guards to prevent deep-linking without tokens
const ProtectedRoute = ({ children, allowedRole }) => {
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRole && user.role !== allowedRole) {
    // If mismatch, send to login (or other view)
    return <Navigate to="/login" replace />;
  }

  return children;
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route 
          path="/receptionist" 
          element={
            <ProtectedRoute allowedRole="receptionist">
              <ReceptionistDashboard />
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/doctor" 
          element={
            <ProtectedRoute allowedRole="doctor">
              <DoctorDashboard />
            </ProtectedRoute>
          } 
        />
        
        <Route path="/waiting-room" element={<PatientRoomView />} />
        <Route path="/patient-queue/:visitId" element={<PatientQueue />} />
        
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
