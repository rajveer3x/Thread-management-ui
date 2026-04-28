'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { ThreadCard } from '@/components/ThreadCard';
import { TerminalStream } from '@/components/TerminalStream';

// Define the shape of incoming OS events emitted by our Node bridge
interface OsEvent {
  type: 'CPU_ACTIVE' | 'BLOCKED' | 'MUTEX_ACQUIRED' | 'EXITED' | 'LOG';
  text: string;
  threadId: string | null;
}

export default function Dashboard() {
  // === UI State Management ===
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [readyQueue, setReadyQueue] = useState<string[]>([]);
  const [blockedQueue, setBlockedQueue] = useState<string[]>([]);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  
  // === Simulation Mode ===
  const [isSimulating, setIsSimulating] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1);
  const [numThreadsInput, setNumThreadsInput] = useState('3');
  const simStateRef = useRef({ active: null as string | null, ready: [] as string[], blocked: [] as string[], totalThreads: 0 });

  // Centralized dispatcher for state reduction (Used by actual WebSockets)
  const dispatchOsEvent = useCallback((event: OsEvent) => {
    setTerminalLogs(prev => {
      const newLogs = [...prev, event.text];
      return newLogs.slice(-20);
    });

    if (!event.threadId) return;

    switch (event.type) {
      case 'CPU_ACTIVE':
      case 'MUTEX_ACQUIRED':
        setActiveThread(event.threadId);
        setReadyQueue(prev => prev.filter(id => id !== event.threadId));
        setBlockedQueue(prev => prev.filter(id => id !== event.threadId));
        break;
        
      case 'BLOCKED':
        setBlockedQueue(prev => {
          if (!prev.includes(event.threadId!)) return [...prev, event.threadId!];
          return prev;
        });
        setActiveThread(prev => (prev === event.threadId ? null : prev));
        setReadyQueue(prev => prev.filter(id => id !== event.threadId));
        break;
        
      case 'EXITED':
        setActiveThread(prev => (prev === event.threadId ? null : prev));
        setReadyQueue(prev => prev.filter(id => id !== event.threadId));
        setBlockedQueue(prev => prev.filter(id => id !== event.threadId));
        break;
        
      default:
        break;
    }
  }, []);

  useEffect(() => {
    // === WebSocket Connection Setup ===
    const socket: Socket = io('http://localhost:3001');

    socket.on('connect', () => {
      console.log('Connected to Node Bridge on port 3001!');
    });

    socket.on('os_event', dispatchOsEvent);

    return () => {
      socket.disconnect();
    };
  }, [dispatchOsEvent]);

  // === Simulation Mode (High-Volume Load Tester) ===
  useEffect(() => {
    if (!isSimulating) return;

    // Initialization: Seed UI with configured concurrent threads
    if (simStateRef.current.ready.length === 0 && !simStateRef.current.active && simStateRef.current.blocked.length === 0) {
      const initialThreads = parseInt(numThreadsInput, 10) || 3;
      simStateRef.current = {
        active: null,
        ready: Array.from({ length: initialThreads }, (_, i) => String(i + 1)),
        blocked: [],
        totalThreads: initialThreads
      };
      
      setActiveThread(null);
      setBlockedQueue([]);
      setReadyQueue([...simStateRef.current.ready]);
      setTerminalLogs(prev => [...prev, `[Simulator] Initialized high-volume load test with ${initialThreads} threads.`]);
    }

    const interval = setInterval(() => {
      let state = simStateRef.current;
      let newLogs: string[] = [];

      if (!state.active && state.ready.length === 0 && state.blocked.length > 0) {
        state.ready = [...state.blocked];
        state.blocked = [];
        newLogs.push("[system] Deadlock detected. Force releasing mutexes...");
      }

      if (!state.active && state.ready.length === 0 && state.blocked.length === 0) {
        newLogs.push("[system] All threads terminated. CPU halting.");
        setIsSimulating(false);
      }

      // Phase A: Unblock
      if (state.blocked.length > 0) {
        const numToUnblock = Math.floor(Math.random() * 3);
        const actualToUnblock = Math.min(numToUnblock, state.blocked.length);
        for (let i = 0; i < actualToUnblock; i++) {
          const idx = Math.floor(Math.random() * state.blocked.length);
          const threadId = state.blocked[idx];
          state.blocked.splice(idx, 1);
          state.ready.push(threadId);
          newLogs.push(`[thread ${threadId}] mutex unlocked -> ready_queue`);
        }
      }

      // Phase B: Context Switch
      let needsNewActive = false;
      if (state.active) {
        const r = Math.random();
        const currentActive = state.active;
        if (r < 0.6) {
          state.active = null;
          state.ready.push(currentActive);
          needsNewActive = true;
          newLogs.push(`[thread ${currentActive}] thread_yield() -> ready_queue`);
        } else if (r < 0.9) {
          state.active = null;
          state.blocked.push(currentActive);
          needsNewActive = true;
          newLogs.push(`[thread ${currentActive}] mutex_lock() stalled -> blocked_queue`);
        } else {
          state.active = null;
          needsNewActive = true;
          newLogs.push(`[thread ${currentActive}] thread_exit() -> terminated`);
        }
      } else {
        needsNewActive = true;
      }

      // If CPU needs work, take the first thread from Ready Queue
      if (needsNewActive && state.ready.length > 0) {
        const nextActive = state.ready.shift()!;
        state.active = nextActive;
        newLogs.push(`[thread ${nextActive}] swapped into CPU...`);
      }

      // Flush to actual React UI States
      setActiveThread(state.active);
      setReadyQueue([...state.ready]);
      setBlockedQueue([...state.blocked]);
      if (newLogs.length > 0) {
        setTerminalLogs(prev => {
          const nextLogs = [...prev, ...newLogs];
          // Keep a bit more history if users scroll, but cap it to avoid memory leaks
          return nextLogs.slice(-100);
        });
      }

    }, 800 / simSpeed);

    return () => clearInterval(interval);
  }, [isSimulating, simSpeed, numThreadsInput]);

  return (
    <div className="bg-[#0B0F19] text-slate-300 min-h-screen p-8 font-sans overflow-x-hidden">
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 border-b border-slate-800/50 pb-6">
        <h1 className="text-4xl font-extrabold text-slate-100 tracking-tight mb-4 md:mb-0">uthreads<span className="text-slate-500 font-light ml-2">Visualizer</span></h1>
        
        <div className="flex items-center gap-4">
          <div className="relative flex flex-col justify-center">
            <div className="flex items-center gap-2 bg-slate-900/50 px-3 py-1.5 rounded-lg border border-slate-800/50">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest whitespace-nowrap">Number of Threads:</label>
              <input 
                type="number" 
                min="1" 
                max="20" 
                value={numThreadsInput}
                onChange={(e) => setNumThreadsInput(e.target.value)}
                disabled={isSimulating}
                className="w-20 bg-slate-800/50 border border-slate-700 rounded px-2 py-1 text-base font-medium text-center text-slate-200 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 disabled:opacity-50 transition-all"
              />
            </div>
            {/* Error Message */}
            {(() => {
              const parsed = parseInt(numThreadsInput, 10);
              const isInvalid = numThreadsInput.trim() === '' || isNaN(parsed) || parsed < 1 || parsed > 20;
              if (isInvalid && !isSimulating) {
                const errorMsg = numThreadsInput.trim() === '' ? 'Required' : isNaN(parsed) ? 'Invalid' : parsed < 1 ? 'Min: 1' : 'Max: 20';
                return <span className="absolute -bottom-5 left-1 text-[10px] text-rose-400 font-bold uppercase tracking-wider">{errorMsg}</span>;
              }
              return null;
            })()}
          </div>

          <div className="flex items-center gap-2 bg-slate-900/50 px-3 py-1.5 rounded-lg border border-slate-800/50">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Speed:</span>
            {[0.5, 1, 2].map(speed => (
              <button
                key={speed}
                onClick={() => setSimSpeed(speed)}
                className={`px-2.5 py-1 text-xs font-bold rounded transition-colors ${simSpeed === speed ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {speed}x
              </button>
            ))}
          </div>

          <button 
            onClick={() => setIsSimulating(!isSimulating)}
            disabled={!isSimulating && (numThreadsInput.trim() === '' || isNaN(parseInt(numThreadsInput, 10)) || parseInt(numThreadsInput, 10) < 1 || parseInt(numThreadsInput, 10) > 20)}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold tracking-wide rounded-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${
              isSimulating 
                ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30' 
                : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.1)]'
            }`}
          >
            {isSimulating ? '■ STOP SIMULATION' : '▶ START SIMULATION'}
          </button>
        </div>
      </div>
      
      {/* === Telemetry Header === */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 shadow-sm backdrop-blur-sm flex flex-col items-center justify-center">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Active CPU</h3>
          <div className={`text-3xl font-bold ${activeThread ? 'text-emerald-400 [text-shadow:0_0_15px_rgba(16,185,129,0.3)]' : 'text-slate-600'}`}>
            {activeThread ? `T${activeThread}` : 'IDLE'}
          </div>
        </div>
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 shadow-sm backdrop-blur-sm flex flex-col items-center justify-center">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Ready Queue Depth</h3>
          <div className="text-3xl font-bold text-blue-400 [text-shadow:0_0_15px_rgba(96,165,250,0.3)]">
            {readyQueue.length}
          </div>
        </div>
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 shadow-sm backdrop-blur-sm flex flex-col items-center justify-center">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Blocked Threads</h3>
          <div className="text-3xl font-bold text-rose-400 [text-shadow:0_0_15px_rgba(244,63,94,0.3)]">
            {blockedQueue.length}
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 mb-8">
        
        {/* === CPU Execution Zone === */}
        <div className={`flex flex-col justify-center items-center p-8 rounded-2xl transition-all duration-500 w-full lg:w-1/3 backdrop-blur-md ${activeThread ? 'border border-emerald-500/50 bg-emerald-950/20 shadow-[0_0_30px_rgba(16,185,129,0.15)]' : 'border border-slate-800/50 bg-slate-900/50 shadow-sm'}`}>
          <h2 className={`text-sm font-bold uppercase tracking-widest mb-6 ${activeThread ? 'text-emerald-400/80' : 'text-slate-500'}`}>CPU EXECUTION</h2>
          <div className="h-28 flex items-center justify-center">
            {activeThread ? (
              <ThreadCard key={`t-${activeThread}`} id={activeThread} state="active" />
            ) : (
              <div className="text-5xl font-black text-slate-800/80">IDLE</div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6 w-full lg:w-2/3">
          {/* === Ready Queue Zone === */}
          <div className="p-6 bg-slate-900/50 backdrop-blur-md border border-slate-800/50 rounded-2xl shadow-sm min-h-[13rem] flex flex-col">
            <h2 className="text-sm font-bold text-slate-400 mb-4 uppercase tracking-widest border-b border-slate-800/50 pb-3">Ready Queue</h2>
            <div className="flex flex-wrap gap-3 py-2 flex-1 items-start content-start">
              {readyQueue.length > 0 ? (
                readyQueue.map((id) => (
                  <ThreadCard key={`t-${id}`} id={id} state="ready" />
                ))
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center py-4">
                  <div className="text-slate-600 font-medium tracking-wide">Queue is empty</div>
                  <div className="text-slate-700 text-xs mt-1">Waiting for thread yields or new spawns.</div>
                </div>
              )}
            </div>
          </div>

          {/* === Blocked Queue Zone === */}
          <div className="p-6 bg-slate-900/50 backdrop-blur-md border border-slate-800/50 rounded-2xl shadow-sm min-h-[13rem] flex flex-col">
            <h2 className="text-sm font-bold text-slate-400 mb-4 uppercase tracking-widest border-b border-slate-800/50 pb-3">Blocked (Mutex Wait)</h2>
            <div className="flex flex-wrap gap-3 py-2 flex-1 items-start content-start">
              {blockedQueue.length > 0 ? (
                blockedQueue.map((id) => (
                  <ThreadCard key={`t-${id}`} id={id} state="blocked" />
                ))
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center py-4">
                  <div className="text-slate-600 font-medium tracking-wide">No blocked threads</div>
                  <div className="text-slate-700 text-xs mt-1">Mutex locks are currently clear.</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* === Stdout Log Zone === */}
      <TerminalStream logs={terminalLogs} onClear={() => setTerminalLogs([])} />
    </div>
  );
}
