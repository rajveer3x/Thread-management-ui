import { useEffect, useRef } from 'react';

/**
 * Props for the TerminalStream component.
 * @param logs Array of string logs to display.
 * @param onClear Callback to clear the logs.
 */
interface TerminalStreamProps {
  logs: string[];
  onClear: () => void;
}

export function TerminalStream({ logs, onClear }: TerminalStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom whenever logs change
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="p-5 bg-black/40 backdrop-blur-sm border border-slate-800/50 rounded-2xl overflow-hidden h-72 flex flex-col shadow-inner relative">
      <div className="flex justify-between items-center border-b border-slate-800/50 pb-3 mb-3 shrink-0">
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">
          Terminal Stream
        </h2>
        <button
          onClick={onClear}
          className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 hover:text-slate-300 transition-colors bg-slate-800/40 hover:bg-slate-700/50 px-2.5 py-1 rounded-md"
        >
          Clear Logs
        </button>
      </div>
      <div 
        ref={containerRef}
        className="space-y-1.5 text-[13px] text-emerald-400/90 flex-1 overflow-y-auto font-mono pb-2 pr-2 scroll-smooth"
      >
        {logs.map((log, index) => (
          <div key={index} className="whitespace-pre">
            <span className="text-slate-600 mr-3">{'>'}</span>{log}
          </div>
        ))}
        {logs.length === 0 && (
          <div className="text-slate-600 italic">Listening on ws://localhost:3001...</div>
        )}
      </div>
    </div>
  );
}
