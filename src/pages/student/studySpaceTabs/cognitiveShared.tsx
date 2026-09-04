import { type ReactNode } from 'react';
import { History, PenTool, ChevronDown, BookOpen } from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
import { CARD, LABEL, SECTION, toneText, scoreTone, type Tone } from '../../../components/ui/surfaces';
import MeterBar from '../../../components/ui/MeterBar';

/**
 * Layout shared by the Free Recall and Feynman tabs.
 *
 * The two were built at different times and drifted apart — same job, two
 * different ways of presenting a score, a verdict and feedback. Everything a
 * student reads after submitting now comes from here, so the tabs stay
 * siblings by construction rather than by remembering to keep them in step.
 *
 * Used by those two tabs only. Nothing here touches the global design system.
 */

export type ViewMode = 'study' | 'history';

/**
 * The style tokens and the tone scale now live in `components/ui/surfaces.ts`,
 * because Test Mode needs the same card surface and was holding a byte-identical
 * copy of the class strings. Re-exported here so every existing import through
 * this file keeps working.
 */
export { CARD, LABEL, SECTION, toneText, scoreTone };
export type { Tone };

// ─────────────────────────────────────────────────────────────────────────────
// Tab shell — header + the changing body below it
// ─────────────────────────────────────────────────────────────────────────────

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
    /*
     * `h-full`, not `h-[calc(100vh-140px)]` — the same wrong constant that was in
     * ResourcesTab, and wrong here for the same reason twice over. The parent
     * <main> is already a definite-height flex child of StudySpace's
     * `h-[calc(100vh-4rem)] md:h-screen` column AND carries its own responsive
     * padding, so 140px described no real layout; on mobile the study-space header
     * is taller still, because the tab bar collapses into a dropdown.
     *
     * Fixing it here fixes Free Recall and Feynman together, which is the point of
     * this file existing.
     */
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

// ─────────────────────────────────────────────────────────────────────────────
// The glance layer — score, verdict, one plain sentence
// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * The first thing a student sees. Score and verdict side by side so "did I do
 * well?" is answered before any detail is read.
 *
 * `secondary` carries a second measure without competing with the first — the
 * Feynman tab previously showed accuracy and simplicity as two equal rings,
 * which left no clue that only accuracy drives the verdict.
 */
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
  /**
   * Colours the sentence rather than the ring. Free Recall carries its meaning
   * there: the ring's percentage is not comparable between materials, but the
   * progress line compares one student's attempts at a single material, so the
   * colour belongs on the half that can support it. Omitted elsewhere, which
   * keeps the muted default.
   */
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
            {/* `MeterBar`, not a sixth hand-rolled bar. This one was byte-identical
                to it — same `h-1.5 rounded-full bg-white/5` track, and a ternary
                that reproduced `toneBg` exactly — which is the duplication MeterBar
                was extracted to end. It also brings the meter ARIA this had none
                of. MeterBar takes 0–1; `secondary.value` is a 0–100 score. */}
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

// ─────────────────────────────────────────────────────────────────────────────
// Feedback + collapsible detail
// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * Detail a student can open rather than scroll past.
 *
 * Free Recall's missed list runs to 60+ entries against a whole document, most
 * of it minor supporting detail. Collapsed, the useful feedback above it stays
 * on screen; the list is one tap away and still complete.
 */
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

// ─────────────────────────────────────────────────────────────────────────────
// Which material an attempt was graded against
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves an attempt's stored `material_ids` to a readable label.
 *
 * An attempt is only interpretable next to its material: the coverage
 * denominator, the missed list and the progress line all belong to one lesson,
 * and a space can hold attempts against several. Without this the History list
 * is a column of scores with nothing to attach them to.
 *
 * **A material can go missing, and that is normal rather than an error.**
 * `cognitive_logs.material_ids` is a `UUID[]`, which Postgres cannot put a
 * foreign key on, so nothing cascades: an educator deleting or archiving a
 * material leaves the attempt intact with an id that no longer resolves. The
 * student's work is deliberately preserved — say so plainly instead of
 * rendering a blank or a raw uuid.
 *
 * Returns null only when no material was recorded at all (attempts logged
 * before `material_ids` was populated).
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

/** The material line above a result. Renders nothing when there is none to name. */
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

// ─────────────────────────────────────────────────────────────────────────────
// History view — sidebar list of attempts beside the selected one
// ─────────────────────────────────────────────────────────────────────────────

export interface AttemptSummary {
  id: string;
  dateLabel: string;
  scoreLabel: string;
  scoreTone: Tone;
  preview: string;
  meta?: string;
}

/**
 * The attempts list. Always visible while History is the active view — no
 * button, nothing that slides over the page.
 *
 * On a phone the two panes stack: the list sits above the selected attempt
 * rather than beside it, since there is no room for a 300px column.
 */
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
  /**
   * Display control from the tab — used to hide this column on mobile once an
   * attempt is open, so the phone shows the list OR the attempt and never two
   * scrolling regions stacked on each other. Must supply the `flex`/`hidden`
   * state, since this root is a flex container.
   */
  className?: string;
}) {
  return (
    /*
     * The two-pane split moved from `sm:` (640px) to `lg:` (1024px).
     *
     * A fixed 300px column at 640px left roughly 340px for the attempt itself —
     * the score ring is 88px of that, and the feedback passage is the thing the
     * student actually came to read.
     *
     * ⚠️ `h-full`, NOT the old `max-h-[40vh]`. Capping the height gave this list
     * its own scrollbar *inside* a pane that also scrolled, so a phone had two
     * nested scroll regions — scroll the attempts, then scroll the attempt. Below
     * `lg` the tab now shows one or the other (see `className`), so this column
     * takes the whole height and owns the only scroll on screen.
     */
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
          /* Wrapped so the list has something to animate — `attempts.map()`
             returns an array, and a class cannot be put on an array. The rail
             shows a spinner while it loads, so the entrance belongs here rather
             than on the panel, which mounts before the fetch resolves. */
          <div className="space-y-1 animate-tab-in">
          {attempts.map((a) => (
            <button
              key={a.id}
              onClick={() => onSelect(a.id)}
              aria-current={activeId === a.id ? 'true' : undefined}
              /* `ring-inset` for the same reason as the material rows in
                 `ResourcesTab` — see the long note there. A default ring is an
                 OUTWARD box-shadow, and this is a full-width button inside an
                 `overflow-y-auto` parent with no horizontal padding to bleed
                 into, so both vertical edges of the ring are clipped flush by
                 the scroll container. The 4px `space-y-1` gap leaves it nearly
                 touching its neighbour too. */
              className={`w-full text-left p-3.5 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] ${
                activeId === a.id ? 'bg-primary-fixed-dim/10' : 'hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                {/* 10px is too small for a date and, below, for the lesson name —
                    and the lesson name is what makes the score interpretable at
                    all, since coverage denominators differ per material. */}
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

/**
 * What both tabs show when the study space holds no lessons at all.
 *
 * ══ ⚠️ THIS FIXED A REAL HOLE, IT IS NOT DECORATION ══
 * Both tabs built their material dropdown as a bare `availableResources.map(...)`
 * with no zero-length branch, so a student who opened Free Recall or Feynman
 * before their teacher had published anything got an EMPTY DROPDOWN and nothing
 * else — no message, no explanation, and no hint that Learning Resources is
 * where lessons arrive. Every other tab in the space already handled this;
 * these two were the exceptions.
 *
 * The wording deliberately matches `FlashcardsTab`'s equivalent, so a student
 * who hits the same wall in two tabs is told the same thing twice rather than
 * two different things.
 */
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
