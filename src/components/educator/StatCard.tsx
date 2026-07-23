import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  color: string;
}

/**
 * The summary-tile idiom used on the student dashboard, lifted so both portals
 * read the same at a glance.
 */
export default function StatCard({ label, value, hint, icon: Icon, color }: StatCardProps) {
  return (
    <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-5 transition-colors hover:bg-white/[0.04]">
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center mb-4"
        style={{ backgroundColor: `${color}1a`, color }}
      >
        <Icon className="w-4.5 h-4.5" />
      </div>
      <p className="font-display text-2xl font-bold text-white tracking-tight">{value}</p>
      <p className="font-sans text-sm text-slate-300 font-medium mt-0.5">{label}</p>
      {hint && <p className="font-sans text-xs text-slate-500 mt-0.5">{hint}</p>}
    </div>
  );
}
