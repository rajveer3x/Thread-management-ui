import { motion } from 'framer-motion';

/**
 * Props for the ThreadCard component.
 * @param id The unique identifier of the thread (e.g., '1', '2').
 * @param state The current execution state of the thread.
 */
interface ThreadCardProps {
  id: string;
  state: 'active' | 'ready' | 'blocked';
}

export function ThreadCard({ id, state }: ThreadCardProps) {
  // Define styles based on the thread's state
  const getStyles = () => {
    switch (state) {
      case 'active':
        return 'w-24 h-24 flex items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-900/40 border border-emerald-500/40 text-5xl font-black text-emerald-300 shadow-[inset_0_0_15px_rgba(16,185,129,0.2)]';
      case 'ready':
        return 'w-14 h-14 flex items-center justify-center bg-slate-800 border border-slate-700/80 rounded-xl text-slate-200 text-lg font-bold shadow-sm';
      case 'blocked':
        return 'w-14 h-14 flex items-center justify-center bg-rose-950/40 border border-rose-900/50 rounded-xl text-rose-300 text-lg font-bold shadow-sm';
      default:
        return 'w-14 h-14 bg-gray-500';
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.8, y: state === 'active' ? 10 : 0 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      whileHover={{ scale: 1.05 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className={getStyles()}
    >
      T{id}
    </motion.div>
  );
}
