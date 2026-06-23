import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HeartPulse, Key, User, AlertCircle } from 'lucide-react';

import { BACKEND_URL } from '../config';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      const data = await response.json();
      if (response.ok && data.success) {
        // Cache JWT token and user info
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        
        // Redirect based on role
        if (data.user.role === 'doctor') {
          navigate('/doctor');
        } else {
          navigate('/receptionist');
        }
      } else {
        setError(data.error || 'Invalid credentials.');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('Connection failed. Is the backend server running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center bg-grid-pattern p-4 relative">
      <div className="absolute top-0 right-0 -mt-16 -mr-16 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 -mb-16 -ml-16 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />

      <div className="max-w-md w-full glass-premium rounded-3xl p-8 relative z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/25 mb-4">
            <HeartPulse className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">Staff Portal Login</h1>
          <p className="text-xs text-slate-400 mt-1">Queue Cure '26 Offline-First System</p>
        </div>

        {error && (
          <div className="bg-rose-950/50 border border-rose-500/30 text-rose-300 rounded-xl p-3.5 flex items-center gap-3 text-xs mb-6">
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-slate-400 text-xs font-semibold uppercase mb-1.5">Username</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                <User className="w-4 h-4" />
              </span>
              <input
                type="text"
                required
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 text-xs font-semibold uppercase mb-1.5">Password</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500">
                <Key className="w-4 h-4" />
              </span>
              <input
                type="password"
                required
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-blue-500/25 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

        {/* Demo Credentials Help Card */}
        <div className="mt-8 pt-6 border-t border-slate-850 text-[11px] text-slate-400 space-y-2">
          <p className="font-bold text-slate-300">Default Accounts (LAN Demo):</p>
          <div className="grid grid-cols-2 gap-2 font-mono">
            <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-850">
              <p className="text-blue-400 font-bold">Receptionist</p>
              <p className="mt-0.5">U: receptionist</p>
              <p>P: receptionist123</p>
            </div>
            <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-850">
              <p className="text-emerald-400 font-bold">Doctor</p>
              <p className="mt-0.5">U: doctor</p>
              <p>P: doctor123</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
