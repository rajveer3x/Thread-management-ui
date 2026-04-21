'use client';

import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion } from 'framer-motion';

// Define the shape of incoming OS events emitted by our Node bridge
interface OsEvent {
  type: 'CPU_ACTIVE' | 'BLOCKED' | 'MUTEX_ACQUIRED' | 'EXITED' | 'LOG';
  text: string;
  threadId: string | null;
}

export default function Dashboard() {
  // === UI State Management ===
  // These variables mirror the internal Rust Thread Control Blocks (TCBs) and scheduler
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [readyQueue, setReadyQueue] = useState<string[]>([]);
  const [blockedQueue, setBlockedQueue] = useState<string[]>([]);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  
  // === Simulation Mode ===
  const [isSimulating, setIsSimulating] = useState(false);

  // Centralized dispatcher for state reduction
  const dispatchOsEvent = useCallback((event: OsEvent) => {
    // Append every log line to keep an audit trail. Limit to 20 lines.
    setTerminalLogs(prev => {
      const newLogs = [...prev, event.text];
      return newLogs.slice(-20);
    });

    if (!event.threadId) return;

    switch (event.type) {
      case 'CPU_ACTIVE':
      case 'MUTEX_ACQUIRED':
        setActiveThread(event.threadId);
        // Ensure thread isn't stranded in waiting queues
        setReadyQueue(prev => prev.filter(id => id !== event.threadId));
        setBlockedQueue(prev => prev.filter(id => id !== event.threadId));
        break;
        
      case 'BLOCKED':
        setBlockedQueue(prev => {
          if (!prev.includes(event.threadId!)) return [...prev, event.threadId!];
          return prev;
        });
        setActiveThread(prev => (prev === event.threadId ? null : prev));
        // Hardened State Fix: Clean up ready queue as well if it blocked
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

    // Attach our robust React state dispatcher
    socket.on('os_event', dispatchOsEvent);

    return () => {
      socket.disconnect();
    };
  }, [dispatchOsEvent]);

  // === Simulation Mode (Mock Data Generator) ===
  useEffect(() => {
    if (!isSimulating) return;

    let tick = 0;
    const interval = setInterval(() => {
      tick = (tick % 4) + 1;
      
      switch (tick) {
        case 1:
          dispatchOsEvent({ type: 'CPU_ACTIVE', threadId: '1', text: '[thread 1] running...' });
          // Ensure mutual exclusivity even when manually seeding the ready queue
          setReadyQueue(prev => Array.from(new Set([...prev, '2', '3'])).filter(id => id !== '1'));
          break;
        case 2:
          dispatchOsEvent({ type: 'CPU_ACTIVE', threadId: '2', text: '[thread 1] yielding to [thread 2]' });
          setReadyQueue(prev => Array.from(new Set([...prev, '1'])).filter(id => id !== '2' && id !== '3'));
          break;
        case 3:
          dispatchOsEvent({ type: 'BLOCKED', threadId: '3', text: '[thread 3] requesting lock...' });
          break;
        case 4:
          dispatchOsEvent({ type: 'EXITED', threadId: '2', text: '[thread 2] thread_exit()' });
          dispatchOsEvent({ type: 'CPU_ACTIVE', threadId: '1', text: '[thread 1] resumed processing' });
          break;
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [isSimulating, dispatchOsEvent]);

  return (
    <div className="bg-neutral-950 text-neutral-300 min-h-screen p-8 font-mono overflow-x-hidden">
      <div className="flex justify-between items-center mb-8 border-b border-neutral-800 pb-4">
        <h1 className="text-4xl font-bold text-neutral-100">uthreads Visualizer</h1>
        <button 
          onClick={() => setIsSimulating(!isSimulating)}
          className={`border px-3 py-1 text-xs font-bold uppercase tracking-wider rounded transition-colors ${
            isSimulating 
              ? 'border-red-500 text-red-500 hover:bg-red-950/50' 
              : 'border-emerald-500 text-emerald-500 hover:bg-emerald-950/50'
          }`}
        >
          {isSimulating ? 'Stop Simulation' : 'Run Simulation'}
        </button>
      </div>
      
      <div className="flex flex-col lg:flex-row gap-6 mb-8">
        
        {/* === CPU Execution Zone === */}
        {/* We use framer-motion's 'layout' prop here and below so that threads glide cleanly between queues visually upon state change. */}
        <div className={`flex flex-col justify-center items-center p-8 rounded-xl border-2 transition-all duration-300 w-full lg:w-1/3 ${activeThread ? 'border-emerald-500 bg-emerald-950/20 shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'border-neutral-800 bg-neutral-900 shadow-inner'}`}>
          <h2 className={`text-xl font-semibold mb-4 tracking-wider ${activeThread ? 'text-emerald-400' : 'text-neutral-500'}`}>CPU EXECUTION</h2>
          <div className="h-24 flex items-center justify-center">
            {activeThread ? (
              <motion.div 
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                key={`active-${activeThread}`}
                className="text-6xl font-black text-emerald-300 drop-shadow-md"
              >
                T{activeThread}
              </motion.div>
            ) : (
              <div className="text-6xl font-black text-neutral-700">IDLE</div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6 w-full lg:w-2/3">
          {/* === Ready Queue Zone === */}
          <div className="p-6 bg-neutral-900 border border-neutral-800 rounded-xl shadow-md">
            <h2 className="text-lg font-semibold text-blue-400 mb-4 uppercase tracking-widest border-b border-neutral-800 pb-2">Ready Queue</h2>
            <div className="flex flex-row overflow-x-auto gap-4 py-2 min-h-[5.5rem]">
              {readyQueue.length > 0 ? (
                readyQueue.map((id) => (
                  <motion.div 
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    key={`t-${id}`} 
                    className="shrink-0 w-20 h-20 flex items-center justify-center bg-blue-950/40 border border-blue-800 rounded-lg text-blue-300 text-2xl font-bold shadow-sm"
                  >
                    T{id}
                  </motion.div>
                ))
              ) : (
                <div className="text-neutral-600 italic py-4">Queue is empty</div>
              )}
            </div>
          </div>

          {/* === Blocked Queue Zone === */}
          <div className="p-6 bg-neutral-900 border border-red-900 rounded-xl shadow-md bg-red-950/10">
            <h2 className="text-lg font-semibold text-red-500 mb-4 uppercase tracking-widest border-b border-red-950 pb-2">Blocked (Mutex Wait)</h2>
            <div className="flex flex-row overflow-x-auto gap-4 py-2 min-h-[5.5rem]">
              {blockedQueue.length > 0 ? (
                blockedQueue.map((id) => (
                  <motion.div 
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    key={`t-${id}`} 
                    className="shrink-0 w-20 h-20 flex items-center justify-center bg-red-950/40 border border-red-900 rounded-lg text-red-400 text-2xl font-bold shadow-sm opacity-80"
                  >
                    T{id}
                  </motion.div>
                ))
              ) : (
                <div className="text-neutral-600 italic py-4">No blocked threads</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* === Stdout Log Zone === */}
      <div className="p-4 bg-black border border-neutral-800 rounded-xl overflow-hidden h-64 flex flex-col shadow-inner">
        <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-500 border-b border-neutral-800 pb-2 mb-3 shrink-0">
          Terminal Stream
        </h2>
        <div className="space-y-1 text-sm text-green-400 flex-1 overflow-y-auto font-mono pb-2">
          {terminalLogs.map((log, index) => (
            <div key={index} className="whitespace-pre">
              <span className="text-neutral-600 mr-2">{'>'}</span>{log}
            </div>
          ))}
          {terminalLogs.length === 0 && <div className="text-neutral-600 italic">Listening on ws://localhost:3001...</div>}
        </div>
      </div>
    </div>
  );
}
