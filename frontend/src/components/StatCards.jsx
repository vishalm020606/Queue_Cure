import React from 'react';
import { Users, Clock, CheckCircle } from 'lucide-react';

export default function StatCards({ total, waiting, completed }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Total Registered */}
      <div className="glass rounded-xl p-5 flex items-center justify-between border border-slate-800 relative overflow-hidden">
        <div className="absolute right-0 top-0 -mt-6 -mr-6 w-24 h-24 bg-blue-500/5 rounded-full blur-xl" />
        <div>
          <span className="text-slate-400 text-xs font-bold uppercase tracking-wider block">Total Registered</span>
          <span className="text-3xl font-black text-white block mt-1 font-mono">{total}</span>
        </div>
        <div className="w-12 h-12 bg-blue-950 text-blue-400 rounded-xl flex items-center justify-center border border-blue-500/15">
          <Users className="w-6 h-6" />
        </div>
      </div>
      
      {/* In Waiting List */}
      <div className="glass rounded-xl p-5 flex items-center justify-between border border-slate-800 relative overflow-hidden">
        <div className="absolute right-0 top-0 -mt-6 -mr-6 w-24 h-24 bg-yellow-500/5 rounded-full blur-xl" />
        <div>
          <span className="text-slate-400 text-xs font-bold uppercase tracking-wider block">In Waiting List</span>
          <span className="text-3xl font-black text-white block mt-1 font-mono">{waiting}</span>
        </div>
        <div className="w-12 h-12 bg-yellow-950 text-yellow-400 rounded-xl flex items-center justify-center border border-yellow-500/15">
          <Clock className="w-6 h-6" />
        </div>
      </div>

      {/* Completed Checkups */}
      <div className="glass rounded-xl p-5 flex items-center justify-between border border-slate-800 relative overflow-hidden">
        <div className="absolute right-0 top-0 -mt-6 -mr-6 w-24 h-24 bg-emerald-500/5 rounded-full blur-xl" />
        <div>
          <span className="text-slate-400 text-xs font-bold uppercase tracking-wider block">Completed</span>
          <span className="text-3xl font-black text-white block mt-1 font-mono">{completed}</span>
        </div>
        <div className="w-12 h-12 bg-emerald-950 text-emerald-400 rounded-xl flex items-center justify-center border border-emerald-500/15">
          <CheckCircle className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}
