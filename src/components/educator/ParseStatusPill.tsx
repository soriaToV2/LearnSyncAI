import { Clock, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { ParsedStatus } from '../../data/mockEducator';

/**
 * The four values of the parsed_status enum, in the order a material moves
 * through them: pending -> processing -> completed, or -> failed.
 */
const STATUS_STYLE: Record<
  ParsedStatus,
  { label: string; color: string; icon: typeof Clock; spin?: boolean; hint: string }
> = {
  pending: {
    label: 'Queued',
    color: '#94a3b8',
    icon: Clock,
    hint: 'Waiting for concept extraction to start',
  },
  processing: {
    label: 'Processing',
    color: '#22d3ee',
    icon: Loader2,
    spin: true,
    hint: 'Extracting concepts and generating embeddings',
  },
  completed: {
    label: 'Ready',
    color: '#34d399',
    icon: CheckCircle2,
    hint: 'Concepts extracted — students can study this material',
  },
  failed: {
    label: 'Failed',
    color: '#fb7185',
    icon: AlertTriangle,
    hint: 'Concept extraction did not finish',
  },
};

interface ParseStatusPillProps {
  status: ParsedStatus;
  className?: string;
}

export default function ParseStatusPill({ status, className = '' }: ParseStatusPillProps) {
  const style = STATUS_STYLE[status];
  const Icon = style.icon;

  return (
    <span
      title={style.hint}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border font-sans text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${className}`}
      style={{
        color: style.color,
        backgroundColor: `${style.color}1a`,
        borderColor: `${style.color}33`,
      }}
    >
      <Icon className={`w-3 h-3 shrink-0 ${style.spin ? 'animate-spin' : ''}`} />
      {style.label}
    </span>
  );
}
