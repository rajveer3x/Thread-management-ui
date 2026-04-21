'use client';

import { useEffect, useState } from 'react';
// import { io, Socket } from 'socket.io-client';

export default function Dashboard() {
  // === UI State Management ===
  // In the future, we will use state to manage the data received from the Node.js bridge.
  // 
  // Example State:
  // const [cpuState, setCpuState] = useState<any>(null); // To track what thread is currently running
  // const [readyQueue, setReadyQueue] = useState<any[]>([]); // To track blocked or queued threads
  // const [blockedQueue, setBlockedQueue] = useState<any[]>([]);
  
  useEffect(() => {
    // === WebSocket Connection Setup ===
    // We will establish a connection to our Node.js bridge running on ws://localhost:4000
    // 
    // Example:
    // const socket: Socket = io('http://localhost:4000');
    // 
    // socket.on('connect', () => {
    //   console.log('Connected to Node Bridge!');
    // });
    // 
    // socket.on('stateUpdate', (data) => {
    //   // Update UI state based on `data`
    //   // e.g. setCpuState(data.cpu);
    //   //      setReadyQueue(data.readyQueue);
    // });
    // 
    // return () => {
    //   socket.disconnect();
    // };
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center justify-center p-8">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 max-w-2xl w-full text-center shadow-2xl">
        <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
          Hello Uthreads
        </h1>
        <p className="text-gray-400 text-lg mb-8">
          The real-time visualization dashboard is currently under construction.
        </p>
        <div className="inline-flex items-center px-4 py-2 border border-blue-500/30 bg-blue-500/10 text-blue-400 rounded-full text-sm font-medium">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse mr-2"></span>
          Waiting for backend connection...
        </div>
      </div>
    </div>
  );
}
