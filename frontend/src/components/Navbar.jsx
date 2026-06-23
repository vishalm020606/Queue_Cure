import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { LogOut, User, LayoutDashboard, Monitor, HeartPulse } from 'lucide-react';

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const isActive = (path) => location.pathname === path;

  return (
    <nav className="glass border-b border-slate-800 px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4 print:hidden sticky top-0 z-45">
      <div className="flex items-center space-x-3">
        <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <HeartPulse className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            Queue Cure <span className="text-xs font-semibold text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">v2.0 LAN</span>
          </h1>
          <p className="text-[10px] text-slate-400">Offline-First Medical Queue Management</p>
        </div>
      </div>

      {/* Role Navigation Links */}
      <div className="flex items-center gap-2 text-sm">
        {token && user.role === 'receptionist' && (
          <Link
            to="/receptionist"
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition ${
              isActive('/receptionist')
                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                : 'text-slate-300 hover:bg-slate-900 hover:text-white border border-transparent'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>Receptionist Dashboard</span>
          </Link>
        )}

        {token && user.role === 'doctor' && (
          <Link
            to="/doctor"
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition ${
              isActive('/doctor')
                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                : 'text-slate-300 hover:bg-slate-900 hover:text-white border border-transparent'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>Doctor Dashboard</span>
          </Link>
        )}

        <Link
          to="/waiting-room"
          className={`flex items-center gap-2 px-4 py-2 rounded-xl transition ${
            isActive('/waiting-room')
              ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
              : 'text-slate-300 hover:bg-slate-900 hover:text-white border border-transparent'
          }`}
        >
          <Monitor className="w-4 h-4" />
          <span>Patient Board</span>
        </Link>
      </div>

      {/* User Actions */}
      <div className="flex items-center gap-4">
        {token ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full text-slate-400">
              <User className="w-3.5 h-3.5 text-blue-400" />
              <span>{user.username} ({user.role})</span>
            </div>
            <button
              onClick={handleLogout}
              className="bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-red-400 border border-slate-800 p-2.5 rounded-xl transition"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <Link
            to="/login"
            className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition"
          >
            Staff Login
          </Link>
        )}
      </div>
    </nav>
  );
}
