import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileText, Loader2, AlertTriangle, Volume2, VolumeX, LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../../lib/api';
import { useMuted, setMuted } from './gameAudio';
import { MOCK_COURSES } from '../../../data/mockCourses';
import { TIER_LABEL, TIER_TONE, type DifficultyTier } from '../../../lib/mastery';
import { toneText } from '../../../components/ui/surfaces';
import {
  COURSE_DATABASE,
  CourseGameData,
  getCourseDisplayInfo,
  getCourseResources,
} from './gamesData';

export type GameTone = 'primary' | 'amber' | 'cyan';

interface ToneStyles {
  hex: string;
  text: string;
  softBg: string;
  softBorder: string;
  solid: string;
  chip: string;
}

const TONE_STYLES: Record<GameTone, ToneStyles> = {
  primary: {
    hex: '#00daf3',
    text: 'text-primary-fixed-dim',
    softBg: 'bg-primary-fixed-dim/10',
    softBorder: 'border-primary-fixed-dim/25',
    solid: 'bg-primary-fixed-dim text-on-primary-fixed hover:bg-primary-container',
    chip: 'bg-primary-fixed-dim/10 border-primary-fixed-dim/20 text-primary-fixed-dim',
  },
  amber: {
    hex: '#fbbf24',
    text: 'text-amber-400',
    softBg: 'bg-amber-400/10',
    softBorder: 'border-amber-400/25',
    solid: 'bg-amber-400 text-black hover:bg-amber-300',
    chip: 'bg-amber-400/10 border-amber-400/20 text-amber-400',
  },
  cyan: {
    hex: '#22d3ee',
    text: 'text-cyan-400',
    softBg: 'bg-cyan-400/10',
    softBorder: 'border-cyan-400/25',
    solid: 'bg-cyan-500 text-white hover:bg-cyan-400',
    chip: 'bg-cyan-400/10 border-cyan-400/20 text-cyan-400',
  },
};

export const toneStyles = (tone: GameTone) => TONE_STYLES[tone];

/* ---------------------------------------------------------------
   Audio mute toggle
   --------------------------------------------------------------- */

/** Header speaker button — mutes/unmutes all game audio (persisted). */
export function AudioToggle() {
  const muted = useMuted();
  return (
    <button
      onClick={() => setMuted(!muted)}
      aria-label={muted ? 'Unmute game audio' : 'Mute game audio'}
      aria-pressed={muted}
      className="w-9 h-9 shrink-0 rounded-xl border border-white/10 bg-white/[0.03] text-slate-400 flex items-center justify-center hover:bg-white/[0.06] hover:text-white transition-all active:scale-95"
    >
      {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
    </button>
  );
}

/* ---------------------------------------------------------------
   Screen flash
   --------------------------------------------------------------- */

export type FeedbackTone = 'correct' | 'wrong';

interface FlashState {
  tone: FeedbackTone;
  id: number;
}

/** Fires a short full-screen vignette pulse. Each call restarts the animation. */
export function useGameFlash() {
  const [flash, setFlash] = useState<FlashState | null>(null);
  const counter = useRef(0);

  const fire = useCallback((tone: FeedbackTone) => {
    counter.current += 1;
    setFlash({ tone, id: counter.current });
  }, []);

  return { flash, fire };
}

export function ScreenFlash({ flash }: { flash: FlashState | null }) {
  if (!flash) return null;

  return (
    <div
      key={flash.id}
      aria-hidden
      className={clsx(
        'game-screen-flash',
        flash.tone === 'correct' ? 'game-screen-flash--correct' : 'game-screen-flash--wrong'
      )}
    />
  );
}

/* ---------------------------------------------------------------
   Confetti
   --------------------------------------------------------------- */

const CONFETTI_COLORS = ['#22d3ee', '#fbbf24', '#34d399', '#a78bfa', '#fb7185'];

export function ConfettiBurst({ pieces = 20 }: { pieces?: number }) {
  const items = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.45,
        duration: 1.6 + Math.random() * 0.9,
        size: 5 + Math.random() * 5,
        rotate: Math.random() * 360,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      })),
    [pieces]
  );

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {items.map((p) => (
        <span
          key={p.id}
          className="game-confetti"
          style={
            {
              left: `${p.left}%`,
              width: p.size,
              height: p.size,
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              ['--confetti-rotate' as string]: `${p.rotate}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------
   HUD
   --------------------------------------------------------------- */

interface HudStatProps {
  icon?: LucideIcon;
  label: string;
  value: React.ReactNode;
  /** Re-mount key: change it to replay the pop animation when the value changes. */
  pulseKey?: string | number;
  highlight?: boolean;
}

export function HudStat({ icon: Icon, label, value, pulseKey, highlight }: HudStatProps) {
  return (
    <div
      className={clsx(
        'flex items-center gap-2.5 rounded-xl border px-3 py-1.5 transition-colors duration-300',
        highlight ? 'bg-rose-500/10 border-rose-500/30' : 'bg-white/[0.03] border-white/[0.06]'
      )}
    >
      {Icon && (
        <Icon className={clsx('w-3.5 h-3.5 shrink-0', highlight ? 'text-rose-400' : 'text-slate-500')} />
      )}
      <div className="leading-none">
        <p className="font-sans text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
        <p
          key={pulseKey}
          className={clsx(
            'font-display text-sm font-bold tabular-nums mt-1',
            pulseKey !== undefined && 'animate-pop',
            highlight ? 'text-rose-300' : 'text-white'
          )}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Timer ring
   --------------------------------------------------------------- */

export function TimerRing({
  progress,
  seconds,
  urgent,
  size = 84,
}: {
  /** 0 → 1, where 1 is a full ring. */
  progress: number;
  seconds: number;
  urgent: boolean;
  size?: number;
}) {
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-white/[0.06]"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          className={clsx('game-timer-ring', urgent ? 'stroke-rose-500' : 'stroke-cyan-400')}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={clsx(
            'font-display text-xl font-bold tabular-nums leading-none',
            urgent ? 'text-rose-400' : 'text-white'
          )}
        >
          {seconds}
        </span>
        <span className="font-sans text-[8px] font-bold uppercase tracking-[0.15em] text-slate-500 mt-1">
          sec
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Stage shell
   --------------------------------------------------------------- */

interface GameStageProps {
  tone: GameTone;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  /**
   * The mastery tier this game was generated at. Null in mock mode and on rows
   * generated before calibration existed — both render no chip rather than
   * guessing `foundational`, which would assert a calibration that never ran.
   */
  tier?: DifficultyTier | null;
  hud?: React.ReactNode;
  actions?: React.ReactNode;
  resources: string[];
  children: React.ReactNode;
}

export function GameStage({
  tone,
  icon: Icon,
  title,
  subtitle,
  tier,
  hud,
  actions,
  resources,
  children,
}: GameStageProps) {
  const navigate = useNavigate();
  const styles = TONE_STYLES[tone];

  return (
    <section
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-surface-container-lowest/60 shadow-2xl"
      style={{ ['--stage-accent' as string]: styles.hex } as React.CSSProperties}
    >
      <div className="game-stage-glow" aria-hidden />
      <div className="game-dot-grid" aria-hidden />

      {/* HUD */}
      <header className="relative flex flex-wrap items-center justify-between gap-4 border-b border-white/5 bg-white/[0.02] px-4 md:px-6 py-3.5 backdrop-blur-sm">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/student/games')}
            aria-label="Back to games"
            className="w-9 h-9 shrink-0 rounded-xl border border-white/10 bg-white/5 text-slate-400 flex items-center justify-center hover:bg-white/10 hover:text-white transition-all active:scale-95"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div
            className={clsx(
              'w-9 h-9 shrink-0 rounded-xl border flex items-center justify-center',
              styles.softBg,
              styles.softBorder,
              styles.text
            )}
          >
            <Icon className="w-4 h-4" />
          </div>

          <div className="min-w-0">
            <h1 className="font-display text-base font-bold text-white leading-tight truncate">{title}</h1>
            {/* The one place the calibration is visible while playing, and what the
                paper's Difficulty Alignment check (p. 98) is about. It sits beside
                the subtitle rather than in `hud`, which is per-game stats and is
                already tight on mobile with two HudStats plus the audio toggle. */}
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="font-sans text-[11px] text-slate-500 truncate">{subtitle}</p>
              {tier && (
                <span
                  title={`Built from your mastery on this material — ${TIER_LABEL[tier].toLowerCase()} level`}
                  className={clsx(
                    'shrink-0 px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.06]',
                    'font-sans text-[10px] font-bold uppercase tracking-widest',
                    toneText[TIER_TONE[tier]]
                  )}
                >
                  {TIER_LABEL[tier]}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hud}
          <AudioToggle />
        </div>
      </header>

      {/* Playfield */}
      <div className="relative px-4 md:px-8 py-6 md:py-8">{children}</div>

      {/* Footer: materials + actions */}
      {(resources.length > 0 || actions) && (
        <footer className="relative flex flex-wrap items-center justify-between gap-3 border-t border-white/5 bg-white/[0.01] px-4 md:px-6 py-3">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <FileText className="w-3.5 h-3.5 text-slate-600 shrink-0" />
            {resources.slice(0, 3).map((res) => (
              <span
                key={res}
                className="px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.06] text-[10px] font-sans font-medium text-slate-500 truncate max-w-[10rem]"
              >
                {res}
              </span>
            ))}
            {resources.length > 3 && (
              <span className="text-[10px] font-sans font-semibold text-slate-600">
                +{resources.length - 3} more
              </span>
            )}
          </div>

          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </footer>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------
   Results screen
   --------------------------------------------------------------- */

interface ResultScreenProps {
  tone: GameTone;
  icon: LucideIcon;
  title: string;
  message: string;
  headline: string;
  headlineLabel: string;
  stats?: { label: string; value: string }[];
  /** Replays the current content locally (same puzzle/questions). */
  onReplay: () => void;
  replayLabel?: string;
  /** Generates a fresh game from the same materials. Omitted → button hidden (mock mode). */
  onRegenerate?: () => void;
  regenerating?: boolean;
  celebrate?: boolean;
}

export function ResultScreen({
  tone,
  icon: Icon,
  title,
  message,
  headline,
  headlineLabel,
  stats,
  onReplay,
  replayLabel = 'Retry',
  onRegenerate,
  regenerating = false,
  celebrate = true,
}: ResultScreenProps) {
  const navigate = useNavigate();
  const styles = TONE_STYLES[tone];

  return (
    <section
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-surface-container-lowest/60 shadow-2xl animate-modal-in"
      style={{ ['--stage-accent' as string]: styles.hex } as React.CSSProperties}
    >
      <div className="game-stage-glow" aria-hidden />
      <div className="game-dot-grid" aria-hidden />
      {celebrate && <ConfettiBurst />}

      <div className="relative px-6 py-12 text-center">
        <div
          className={clsx(
            'w-14 h-14 rounded-2xl border flex items-center justify-center mx-auto',
            styles.softBg,
            styles.softBorder,
            styles.text
          )}
        >
          <Icon className="w-7 h-7" />
        </div>

        <h2 className="font-display text-2xl font-bold text-white mt-6">{title}</h2>
        <p className="font-sans text-sm text-slate-400 mt-2 max-w-sm mx-auto leading-relaxed">{message}</p>

        <div className="mt-8">
          <p className={clsx('font-display text-6xl font-bold tabular-nums', styles.text)}>{headline}</p>
          <p className="font-sans text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mt-2">
            {headlineLabel}
          </p>
        </div>

        {stats && stats.length > 0 && (
          <div className="mt-8 flex justify-center divide-x divide-white/5">
            {stats.map((s) => (
              <div key={s.label} className="px-6">
                <p className="font-display text-xl font-bold text-white tabular-nums">{s.value}</p>
                <p className="font-sans text-[10px] uppercase tracking-[0.15em] text-slate-500 mt-1.5">
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-10 flex flex-wrap gap-3 justify-center">
          <button
            onClick={() => navigate('/student/games')}
            disabled={regenerating}
            className="px-5 py-2.5 rounded-xl border border-white/10 font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-all disabled:opacity-40"
          >
            Close
          </button>

          {/* Retry replays the same content. Styled as the primary CTA only when
              there's no separate "Play Again" (mock mode). */}
          <button
            onClick={onReplay}
            disabled={regenerating}
            className={clsx(
              'px-5 py-2.5 rounded-xl font-sans font-bold text-sm transition-all active:scale-95 disabled:opacity-40',
              onRegenerate
                ? 'border border-white/10 text-slate-200 hover:bg-white/5'
                : styles.solid
            )}
          >
            {replayLabel}
          </button>

          {onRegenerate && (
            <button
              onClick={onRegenerate}
              disabled={regenerating}
              className={clsx(
                'px-5 py-2.5 rounded-xl font-sans font-bold text-sm transition-all active:scale-95',
                'flex items-center gap-2 disabled:opacity-60',
                styles.solid
              )}
            >
              {regenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Generating…
                </>
              ) : (
                'Play Again'
              )}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------
   Content loading
   --------------------------------------------------------------- */

interface GameSource {
  space_id: string;
  material_ids: string[];
  game_type: string;
}

interface GameContentResponse extends GameSource {
  payload: CourseGameData;
  difficulty: DifficultyTier;
  mastery_snapshot: number | null;
}

/**
 * What the server derived from this student's mastery when it built the game.
 *
 * All of it is server-supplied. The client never picks a tier or a timer — see
 * `server/lib/gameDifficulty.ts`, and `GenerateGameContentSchema`, which
 * deliberately has no `difficulty` field to send.
 */
export interface GameCalibration {
  tier: DifficultyTier;
  /** M_doc over the selected materials. Null on pre-calibration rows. */
  masterySnapshot: number | null;
  /** Timed Trivia only — undefined for the two untimed games. */
  questionMs?: number;
}

/**
 * Per-item response log persisted with a session so the student can review
 * their answers afterward. Shape is discriminated by the game type.
 */
export type SessionDetail =
  | {
      type: 'trivia';
      items: {
        question: string;
        options: string[];
        correct: string;
        selected: string | null;
        outcome: 'correct' | 'wrong' | 'timeout';
      }[];
    }
  | {
      type: 'term_matcher';
      items: { term: string; definition: string; wrongAttempts: number }[];
    }
  | {
      type: 'crossword';
      items: { number: number; direction: 'across' | 'down'; clue: string; answer: string; hintedLetters: number }[];
    };

/** Outcome of a finished game, persisted to the student's session history. */
export interface GameResult {
  /** 0 → 1. */
  accuracy: number;
  timeMs?: number;
  /** Per-item breakdown for the post-game review view. */
  detail?: SessionDetail;
}

interface GameContentState {
  data: CourseGameData | null;
  resources: string[];
  loading: boolean;
  error: string | null;
  /** The tier and timer the server derived from mastery. Null in mock mode. */
  calibration: GameCalibration | null;
  /** Generates a brand-new game from the same materials ("Play Again"). Undefined in mock mode. */
  regenerate?: () => void;
  regenerating: boolean;
  /** Logs a finished game to the student's history. No-op in mock mode (no content id). */
  recordSession: (result: GameResult) => void;
}

/**
 * Resolves a game's content. When a `?contentId=` param is present it fetches
 * the AI-generated payload from the backend; otherwise it falls back to the
 * mock COURSE_DATABASE keyed by the `?course=` param (keeps dev/demo working).
 *
 * Also exposes `regenerate()` — a fresh POST /generate from the same source
 * materials — which powers the "Play Again" button (distinct from "Retry",
 * which just replays the current content locally).
 */
export function useGameContent(): GameContentState {
  const [searchParams, setSearchParams] = useSearchParams();
  const contentId = searchParams.get('contentId');
  const courseId = searchParams.get('course') || 'bio-301';

  const [data, setData] = useState<CourseGameData | null>(null);
  const [source, setSource] = useState<GameSource | null>(null);
  const [calibration, setCalibration] = useState<GameCalibration | null>(null);
  const [loading, setLoading] = useState<boolean>(!!contentId);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Content id we already have in state — lets regenerate update the URL
  // without the fetch effect re-downloading what it just produced.
  const loadedId = useRef<string | null>(null);

  // Mock fallback resources are cosmetic (the "Connected Materials" chips).
  const resources = useMemo(() => getCourseResources(courseId), [courseId]);

  useEffect(() => {
    if (!contentId) {
      const course = MOCK_COURSES.find((c) => c.id === courseId) || MOCK_COURSES[0];
      const info = getCourseDisplayInfo(course);
      setData(COURSE_DATABASE[info.gameKey]);
      setSource(null);
      // Mock content was never calibrated against anyone's mastery, so it shows
      // no tier chip and falls back to the default timer.
      setCalibration(null);
      setLoading(false);
      setError(null);
      return;
    }

    if (loadedId.current === contentId) return; // already in state (e.g. from regenerate)

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .get<GameContentResponse>(`/games/content/${contentId}`)
      .then((res) => {
        if (cancelled) return;
        setData(res.data.payload);
        setSource({
          space_id: res.data.space_id,
          material_ids: res.data.material_ids,
          game_type: res.data.game_type,
        });
        setCalibration({
          tier: res.data.difficulty,
          masterySnapshot: res.data.mastery_snapshot ?? null,
          questionMs: res.data.payload?.settings?.questionMs,
        });
        loadedId.current = contentId;
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load game');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [contentId, courseId]);

  const regenerate = useCallback(async () => {
    if (!source) return;
    setRegenerating(true);
    setError(null);
    try {
      // No `difficulty` — the server re-derives it from mastery, which may have
      // moved since the last generation (a test or a flashcard session between
      // rounds is exactly the point). THE CALIBRATION MUST BE REFRESHED FROM THE
      // RESPONSE: it varies per generation now, so leaving the old one in state
      // would show the previous game's tier chip and, worse, its clock.
      const res = await api.post<{
        id: string;
        payload: CourseGameData;
        difficulty: DifficultyTier;
        mastery_snapshot: number | null;
      }>('/games/generate', {
        space_id: source.space_id,
        material_ids: source.material_ids,
        game_type: source.game_type,
      });
      loadedId.current = res.data.id;
      setData(res.data.payload);
      setCalibration({
        tier: res.data.difficulty,
        masterySnapshot: res.data.mastery_snapshot ?? null,
        questionMs: res.data.payload?.settings?.questionMs,
      });
      // Point the URL at the new content without triggering a redundant refetch.
      const next = new URLSearchParams(searchParams);
      next.set('contentId', res.data.id);
      setSearchParams(next, { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate a new game');
    } finally {
      setRegenerating(false);
    }
  }, [source, searchParams, setSearchParams]);

  const recordSession = useCallback(
    (result: GameResult) => {
      // Read the ref, not `source` — it is what `regenerate` updates, so a session
      // played after "Play Again" is logged against the content actually played.
      const contentPlayed = loadedId.current;
      if (!contentPlayed) return; // mock mode — nothing to persist

      const accuracy = Number.isFinite(result.accuracy)
        ? Math.max(0, Math.min(1, result.accuracy))
        : undefined;

      // The body carries only the OUTCOME. `space_id`, `material_id`, `game_type`
      // and `mastery_snapshot` are read server-side from the content row, because
      // that snapshot is the evidence the Difficulty Alignment check reads.
      //
      // Best-effort: a failed log must never disrupt the result screen. The warn
      // matters — this catch is silent, so a schema mismatch here would otherwise
      // stop session logging entirely without a single visible symptom.
      void api
        .post('/gamification/session', {
          content_id: contentPlayed,
          accuracy,
          time_spent_ms: result.timeMs,
          detail: result.detail,
        })
        .catch((err: unknown) => {
          console.warn('[games] session log failed:', err);
        });
    },
    []
  );

  return {
    data,
    resources,
    loading,
    error,
    calibration,
    regenerate: contentId ? regenerate : undefined,
    regenerating,
    recordSession,
  };
}

/** Full-stage loading / error placeholder shown while content resolves. */
export function GameStatusScreen({
  tone,
  state,
}: {
  tone: GameTone;
  state: 'loading' | 'error';
  message?: string;
}) {
  const navigate = useNavigate();
  const styles = TONE_STYLES[tone];

  return (
    <section
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-surface-container-lowest/60 shadow-2xl"
      style={{ ['--stage-accent' as string]: styles.hex } as React.CSSProperties}
    >
      <div className="game-stage-glow" aria-hidden />
      <div className="game-dot-grid" aria-hidden />

      <div className="relative px-6 py-20 text-center">
        {state === 'loading' ? (
          <>
            <Loader2 className={clsx('w-8 h-8 mx-auto animate-spin', styles.text)} />
            <p className="font-display text-lg font-bold text-white mt-5">Generating your game…</p>
            <p className="font-sans text-sm text-slate-500 mt-1.5">
              The AI is building content from your materials.
            </p>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <p className="font-display text-lg font-bold text-white mt-5">Couldn’t load this game</p>
            <p className="font-sans text-sm text-slate-500 mt-1.5 max-w-sm mx-auto">
              Something went wrong generating or fetching the content. Head back and try again.
            </p>
            <button
              onClick={() => navigate('/student/games')}
              className="mt-6 px-6 py-2.5 rounded-xl border border-white/10 font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-all"
            >
              Back to Games
            </button>
          </>
        )}
      </div>
    </section>
  );
}
