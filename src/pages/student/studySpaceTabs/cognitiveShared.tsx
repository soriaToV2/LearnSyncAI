import { type ReactNode } from 'react';
import { History, PenTool, ChevronDown, BookOpen } from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
import { CARD, LABEL, SECTION, toneText, scoreTone, type Tone } from '../../../components/ui/surfaces';
import MeterBar from '../../../components/ui/MeterBar';

/** Result layout shared by the Free Recall and Feynman tabs only, so the two stay consistent. */

export type ViewMode = 'study' | 'history';

/** Style tokens live in components/ui/surfaces.ts; re-exported here. */
export { CARD, LABEL, SECTION, toneText, scoreTone };
export type { Tone };

// Tab shell: header plus the changing body

export function CognitiveTabShell({
  icon,
  title,
  subtitle,
  viewMode,
  onViewModeChange,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  children: ReactNode;
}) {
  const tab = (mode: ViewMode) =>
    `flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-sans text-xs font-semibold transition-colors ${
      viewMode === mode ? 'bg-surface-container-high text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
    }`;

  return (
    // h-full inherits <main>'s definite height (a fixed calc() matched no layout).
    <div className="fade-in duration-300 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-5 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/10 flex items-center justify-center shrink-0">
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold text-white tracking-tight truncate">{title}</h2>
            <p className="font-sans text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>
          </div>
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-surface-container-lowest/60 rounded-xl self-start sm:self-auto shrink-0">
          <button onClick={() => onViewModeChange('study')} className={tab('study')}>
            <PenTool className="w-3.5 h-3.5" /> Study
          </button>
          <button onClick={() => onViewModeChange('history')} className={tab('history')}>
            <History className="w-3.5 h-3.5" /> History
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 pt-6">{children}</div>
    </div>
  );
}

// Glance layer: score, verdict, one sentence

function Ring({ value, tone, suffix }: { value: number; tone: Tone; suffix?: string }) {
  const CIRCUMFERENCE = 226.2; // 2π · 36
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="relative shrink-0 w-[88px] h-[88px]">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r="36" fill="none" stroke="currentColor" strokeWidth="6" className="text-white/5" />
        <circle
          cx="44" cy="44" r="36"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE - CIRCUMFERENCE * (clamped / 100)}
          className={toneText[tone]}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-display text-2xl font-bold text-white">
          {Math.round(value)}
          {suffix && <span className="text-sm text-slate-400">{suffix}</span>}
        </span>
      </div>
    </div>
  );
}

/** Score and verdict side by side. `secondary` adds a second measure (Feynman simplicity) that doesn't drive the verdict. */
export function VerdictBanner({
  score,
  scoreSuffix,
  tone,
  verdictLabel,
  description,
  descriptionTone,
  secondary,
}: {
  score: number;
  scoreSuffix?: string;
  tone: Tone;
  verdictLabel: string;
  description: string;
  /** Colours the sentence instead of the ring (Free Recall's ring % isn't comparable across materials). */
  descriptionTone?: Tone;
  secondary?: { label: string; value: number };
}) {
  return (
    <div className={`${CARD} p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-6`}>
      <Ring value={score} tone={tone} suffix={scoreSuffix} />

      <div className="min-w-0 flex-1">
        <p className={`font-display text-lg font-bold tracking-tight ${toneText[tone]}`}>{verdictLabel}</p>
        <p className={`font-sans text-sm mt-1 leading-relaxed ${
          descriptionTone && descriptionTone !== 'neutral' ? toneText[descriptionTone] : 'text-slate-400'
        }`}>
          {description}
        </p>

        {secondary && (
          <div className="mt-4 pt-4 border-t border-white/5">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <span className={LABEL}>{secondary.label}</span>
              <span className={`font-display text-sm font-bold ${toneText[scoreTone(secondary.value)]}`}>
                {secondary.value}
              </span>
            </div>
            {/* MeterBar takes 0–1; secondary.value is 0–100. */}
            <MeterBar
              value={Math.max(0, Math.min(100, secondary.value)) / 100}
              tone={scoreTone(secondary.value)}
              label={secondary.label}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Feedback and collapsible detail

export function FeedbackCard({
  icon,
  label,
  tone,
  children,
}: {
  icon: ReactNode;
  label: string;
  tone: string;
  children: ReactNode;
}) {
  return (
    <div className={`${CARD} p-5`}>
      <h5 className={`font-sans text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2 ${tone}`}>
        {icon} {label}
      </h5>
      <div className="font-sans text-sm text-slate-200 leading-relaxed">{children}</div>
    </div>
  );
}

/** Collapsible detail (e.g. Free Recall's long missed list), complete but out of the way. */
export function Collapsible({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 py-2 group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]"
      >
        <span className={`${SECTION} flex items-center gap-2`}>
          {title}
          {count !== undefined && count > 0 && (
            <span className="px-1.5 py-0.5 rounded-md bg-white/5 text-[10px] font-bold text-slate-400 normal-case tracking-normal">
              {count}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5 font-sans text-xs font-semibold text-slate-500 group-hover:text-slate-300 transition-colors">
          {open ? 'Hide' : 'Show'}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && <div className="pt-3 fade-in duration-200">{children}</div>}
    </div>
  );
}

// Which material an attempt was graded against

/**
 * An attempt's material label. A material can vanish (material_ids is UUID[] with no FK), so say so
 * plainly instead of showing a blank or a raw id. Null only for attempts with no material recorded.
 */
export function materialLabel(
  materialIds: string[] | undefined,
  resources: { id: string; title: string }[]
): string | null {
  const ids = materialIds ?? [];
  if (ids.length === 0) return null;

  const known = ids
    .map((id) => resources.find((r) => r.id === id)?.title)
    .filter((t): t is string => Boolean(t));

  if (known.length === ids.length) return known.join(', ');
  if (known.length === 0) return 'Material no longer available';
  return `${known.join(', ')} · ${ids.length - known.length} no longer available`;
}

/** The material line above a result; nothing when there's none. */
export function AttemptMaterial({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <BookOpen className="w-3.5 h-3.5 text-slate-500 shrink-0" />
      <span className={`${LABEL} truncate`} title={label}>
        {label}
      </span>
    </div>
  );
}

// History view: attempts list beside the selected attempt

export interface AttemptSummary {
  id: string;
  dateLabel: string;
  scoreLabel: string;
  scoreTone: Tone;
  preview: string;
  meta?: string;
}

/** The attempts list, always visible in History. Stacks above the attempt on narrow screens. */
export function AttemptsList({
  title,
  attempts,
  activeId,
  isLoading,
  emptyLabel,
  onSelect,
  className = '',
}: {
  title: string;
  attempts: AttemptSummary[];
  activeId: string | null;
  isLoading: boolean;
  emptyLabel: string;
  onSelect: (id: string) => void;
  /** Display classes from the tab, to show list or attempt (never both) on mobile. Must include flex/hidden. */
  className?: string;
}) {
  return (
    // Two panes from lg up. h-full (not a max-height) so there's only one scroll region.
    <div className={`w-full lg:w-[300px] flex-col lg:border-r border-white/5 lg:pr-6 h-full shrink-0 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className={SECTION}>{title}</h3>
        <span className="text-slate-500 text-xs font-medium">{attempts.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1 lg:pr-2 no-scrollbar">
        {isLoading ? (
          <div className="flex items-center justify-center mt-10">
            <Spinner className="w-5 h-5 text-slate-500" />
          </div>
        ) : attempts.length === 0 ? (
          <p className="text-sm text-slate-500 font-sans text-center mt-10 px-4 animate-tab-in">{emptyLabel}</p>
        ) : (
          /* A wrapper so the rows can animate (a class can't go on an array). */
          <div className="space-y-1 animate-tab-in">
          {attempts.map((a) => (
            <button
              key={a.id}
              onClick={() => onSelect(a.id)}
              aria-current={activeId === a.id ? 'true' : undefined}
              /* ring-inset: an outward ring would be clipped by the scroll container. */
              className={`w-full text-left p-3.5 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] ${
                activeId === a.id ? 'bg-primary-fixed-dim/10' : 'hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                {/* Readable size for the date and lesson name (the lesson makes the score interpretable). */}
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {a.dateLabel}
                </span>
                <span className={`text-xs font-bold ${toneText[a.scoreTone]}`}>{a.scoreLabel}</span>
              </div>
              {a.meta && (
                <div className="text-[11px] font-semibold uppercase text-primary-fixed-dim/70 mb-1.5 line-clamp-1">{a.meta}</div>
              )}
              <p className="font-sans text-sm text-slate-400 line-clamp-2 leading-relaxed">{a.preview}</p>
            </button>
          ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Shown when the space has no lessons yet, instead of an empty dropdown. Same wording as FlashcardsTab. */
export function NoMaterialsNotice() {
  return (
    <div className="flex flex-col items-center justify-center text-center text-slate-500 py-20 fade-in">
      <BookOpen className="w-10 h-10 mb-4 opacity-20" />
      <p className="font-sans text-sm text-slate-400 mb-1">
        There are no lessons in this study space yet.
      </p>
      <p className="font-sans text-xs text-slate-600 max-w-md leading-relaxed">
        Open the Learning Resources tab to see what your teacher has published.
      </p>
    </div>
  );
}
