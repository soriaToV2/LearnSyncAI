import { Clock, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { ParsedStatus } from '../../data/mockEducator';

/**
 * The four values of the parsed_status enum, in the order a material moves
 * through them: pending -> processing -> completed, or -> failed.
 *
 * ⚠️ THE LABEL IS THE ENUM VALUE, title-cased. It used to be friendlier wording
 * ('Queued', 'Ready'), which meant an educator reporting a problem and a
 * developer reading `materials.parsed_status` were using different vocabularies
 * for the same four states. Keep them identical — if a new status is ever added
 * to the enum, its label is its name.
 *
 * The STUDENT side deliberately does NOT follow this rule: `ResourcesTab` says
 * "Being prepared" / "Ready" / "Not available", because a student seeing
 * "Failed" on their lesson learns something alarming they cannot act on.
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
