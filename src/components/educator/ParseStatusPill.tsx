import type { CSSProperties } from 'react';
import { Clock, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { ParsedStatus } from '../../data/mockEducator';

/**
 * parsed_status values in lifecycle order. Educator labels are the enum value, title-cased, so educators
 * and developers share one vocabulary. The student side uses friendlier wording on purpose.
 */
const STATUS_STYLE: Record<
  ParsedStatus,
  { label: string; color: string; icon: typeof Clock; spin?: boolean; hint: string }
> = {
  pending: {
    label: 'Pending',
    color: '#94a3b8',
    icon: Clock,
    hint: 'Queued — waiting for concept extraction to start',
  },
  processing: {
    label: 'Processing',
    color: '#22d3ee',
    icon: Loader2,
    spin: true,
    hint: 'Extracting concepts and generating embeddings',
  },
  completed: {
    label: 'Completed',
    color: '#34d399',
    icon: CheckCircle2,
    hint: 'Concepts extracted — students can study this material',
  },
  failed: {
    label: 'Failed',
    color: '#fb7185',
    icon: AlertTriangle,
    hint: 'Concept extraction did not finish — see the reason on the material',
  },
};

interface ParseStatusPillProps {
  status: ParsedStatus;
  className?: string;
}

export default function ParseStatusPill({ status, className = '' }: ParseStatusPillProps) {
  const style = STATUS_STYLE[status];
  const Icon = style.icon;

  // .tone-chip + --tone (not inline colours) so the light theme can fix contrast. See index.css TINTED CHIPS.
  return (
    <span
      title={style.hint}
      className={`tone-chip inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border font-sans text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${className}`}
      style={{ '--tone': style.color } as CSSProperties}
    >
      <Icon className={`w-3 h-3 shrink-0 ${style.spin ? 'animate-spin' : ''}`} />
      {style.label}
    </span>
  );
}
