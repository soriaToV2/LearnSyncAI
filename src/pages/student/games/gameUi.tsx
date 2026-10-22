import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileText, AlertTriangle, Volume2, VolumeX, LucideIcon } from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
import clsx from 'clsx';
import { api } from '../../../lib/api';
import { useMuted, setMuted } from './gameAudio';
import { MOCK_COURSES } from '../../../data/mockCourses';
import { TIER_LABEL, TIER_TONE, type DifficultyTier } from '../../../lib/mastery';
import { toneText } from '../../../components/ui/surfaces';
import ConfettiBurst from '../../../components/ui/ConfettiBurst';
import { useBadges } from '../../../context/BadgeContext';
import {
  COURSE_DATABASE,
  CourseGameData,
  getCourseDisplayInfo,
  getCourseResources,
} from './gamesData';

/** One tone per game. `violet`, not `cyan`, which was nearly identical to the primary accent. */
export type GameTone = 'primary' | 'amber' | 'violet';

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
  violet: {
    hex: '#a78bfa',
    text: 'text-violet-400',
    softBg: 'bg-violet-400/10',
    softBorder: 'border-violet-400/25',
    // Light fill and black label, matching amber and the launch card's Play pill.
    solid: 'bg-violet-400 text-black hover:bg-violet-300',
    chip: 'bg-violet-400/10 border-violet-400/20 text-violet-400',
  },
};

export const toneStyles = (tone: GameTone) => TONE_STYLES[tone];

// Audio mute toggle

/** Header speaker button; mutes all game audio (persisted). */
export function AudioToggle() {
  const muted = useMuted();
  return (
    <button
      onClick={() => setMuted(!muted)}
      aria-label={muted ? 'Unmute game audio' : 'Mute game audio'}
      aria-pressed={muted}
      className="w-9 h-9 shrink-0 rounded-xl border border-white/10 bg-white/[0.03] text-slate-400 flex items-center justify-center hover:bg-white/[0.06] hover:text-white transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]"
    >
      {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
    </button>
  );
}

// Screen flash

export type FeedbackTone = 'correct' | 'wrong';

interface FlashState {
  tone: FeedbackTone;
  id: number;
}

/** A short full-screen vignette pulse; each call restarts it. */
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

// Confetti

/** Lives in components/ui/ConfettiBurst.tsx (so the portal bundle doesn't import mock data); re-exported here. */
export { ConfettiBurst };

// HUD

interface HudStatProps {
  icon?: LucideIcon;
  label: string;
  value: React.ReactNode;
  /** Remount key: change it to replay the pop animation. */
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
        <p className="font-sans text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
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

// Timer ring

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
          /* The idle stroke uses --stage-accent so it matches the stage; urgent stays rose. */
          className={clsx(
            'game-timer-ring',
            urgent ? 'stroke-rose-500' : 'stroke-[var(--stage-accent)]'
          )}
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
        {/* 10px minimum on a countdown read under pressure. */}
        <span className="font-sans text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mt-0.5">
          sec
        </span>
      </div>
    </div>
  );
}

// Stage shell

interface GameStageProps {
  tone: GameTone;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  /** The tier this game was generated at; null in mock mode and on pre-calibration rows (no chip then). */
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
            className="w-9 h-9 shrink-0 rounded-xl border border-white/10 bg-white/5 text-slate-400 flex items-center justify-center hover:bg-white/10 hover:text-white transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]"
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
            {/* The calibration tier, visible while playing (Difficulty Alignment, p. 98). Beside the subtitle; the HUD is tight on mobile. */}
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
      <div className="relative px-4 sm:px-6 md:px-8 py-6 sm:py-7 md:py-8">{children}</div>

      {/* Footer: materials and actions */}
      {(resources.length > 0 || actions) && (
        <footer className="relative flex flex-wrap items-center justify-between gap-3 border-t border-white/5 bg-white/[0.01] px-4 md:px-6 py-3">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <FileText className="w-3.5 h-3.5 text-slate-600 shrink-0" />
            {resources.slice(0, 3).map((res) => (
              <span
                key={res}
                /* 11px: material titles, not micro-labels. */
                className="px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.06] text-[11px] font-sans font-medium text-slate-400 truncate max-w-[10rem]"
              >
                {res}
              </span>
            ))}
            {resources.length > 3 && (
              <span className="text-[11px] font-sans font-semibold text-slate-500">
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

// Results screen

interface ResultScreenProps {
  tone: GameTone;
  icon: LucideIcon;
  title: string;
  message: string;
  headline: string;
  headlineLabel: string;
  stats?: { label: string; value: string }[];
  /** Replays the current content (same puzzle/questions). */
  onReplay: () => void;
  replayLabel?: string;
  /** Generates a fresh game from the same materials; omitted in mock mode. */
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

      <div className="relative px-4 sm:px-6 py-10 sm:py-12 text-center">
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
          <p className={clsx('font-display text-5xl sm:text-6xl font-bold tabular-nums', styles.text)}>
            {headline}
          </p>
          <p className="font-sans text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mt-2">
            {headlineLabel}
          </p>
        </div>

        {stats && stats.length > 0 && (
          <div className="mt-8 flex justify-center divide-x divide-white/5">
            {stats.map((s) => (
              <div key={s.label} className="px-4 sm:px-6">
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
            className="px-5 py-2.5 rounded-xl border border-white/10 font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-all disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-lowest"
          >
            Close
          </button>

          {/* Retry replays the same content; it's the primary CTA only without Play Again (mock mode). */}
          <button
            onClick={onReplay}
            disabled={regenerating}
            className={clsx(
              'px-5 py-2.5 rounded-xl font-sans font-bold text-sm transition-all active:scale-95 disabled:opacity-40',
              /* ring-on-surface stays legible on both the outlined and accent-filled variants. */
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-lowest',
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
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-lowest',
                styles.solid
              )}
            >
              {regenerating ? (
                <>
                  <Spinner className="w-4 h-4" /> Generating…
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

// Content loading

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

/** Tier and timer derived server-side from mastery; the client never chooses them. */
export interface GameCalibration {
  tier: DifficultyTier;
  /** M_doc over the selected materials; null on pre-calibration rows. */
  masterySnapshot: number | null;
  /** Timed Trivia only. */
  questionMs?: number;
}

/** Per-item answers saved with a session for later review, discriminated by game type. */
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

/** A finished game's outcome, saved to session history. */
export interface GameResult {
  /** 0 → 1. */
  accuracy: number;
  timeMs?: number;
  /** Per-item breakdown for the review view. */
  detail?: SessionDetail;
}

interface GameContentState {
  data: CourseGameData | null;
  resources: string[];
  loading: boolean;
  error: string | null;
  /** Server-derived tier and timer; null in mock mode. */
  calibration: GameCalibration | null;
  /** A new game from the same materials ("Play Again"); undefined in mock mode. */
  regenerate?: () => void;
  regenerating: boolean;
  /** Logs a finished game; no-op in mock mode. */
  recordSession: (result: GameResult) => void;
}

/**
 * Resolves a game's content: from the backend with ?contentId=, else the mock COURSE_DATABASE by
 * ?course=. regenerate() powers "Play Again" (a fresh generation); "Retry" just replays.
 */
export function useGameContent(): GameContentState {
  // Aliased: `celebrate` is already a confetti prop in this module.
  const { celebrate: celebrateBadges } = useBadges();
  const [searchParams, setSearchParams] = useSearchParams();
  const contentId = searchParams.get('contentId');
  const courseId = searchParams.get('course') || 'bio-301';

  const [data, setData] = useState<CourseGameData | null>(null);
  const [source, setSource] = useState<GameSource | null>(null);
  const [calibration, setCalibration] = useState<GameCalibration | null>(null);
  const [loading, setLoading] = useState<boolean>(!!contentId);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lets regenerate update the URL without the fetch effect re-downloading.
  const loadedId = useRef<string | null>(null);

  // Mock resources only feed the "Connected Materials" chips.
  const resources = useMemo(() => getCourseResources(courseId), [courseId]);

  useEffect(() => {
    if (!contentId) {
      const course = MOCK_COURSES.find((c) => c.id === courseId) || MOCK_COURSES[0];
      const info = getCourseDisplayInfo(course);
      setData(COURSE_DATABASE[info.gameKey]);
      setSource(null);
      // Mock content is uncalibrated: no tier chip, default timer.
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
      // No difficulty sent; the server re-derives it. Refresh the calibration from the response, or the old tier chip and clock would show.
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
      // Point the URL at the new content without a refetch.
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
      // The ref, which regenerate updates, so the session logs the content actually played.
      const contentPlayed = loadedId.current;
      if (!contentPlayed) return; // mock mode — nothing to persist

      const accuracy = Number.isFinite(result.accuracy)
        ? Math.max(0, Math.min(1, result.accuracy))
        : undefined;

      // The body carries only the outcome; the server reads the rest from the content row. Best-effort,
      // but warn: a silent failure here would stop session logging unnoticed.
      void api
        .post('/gamification/session', {
          content_id: contentPlayed,
          accuracy,
          time_spent_ms: result.timeMs,
          detail: result.detail,
        })
        .then(() => {
          // After the POST resolves: the session insert is what logs the activity.
          celebrateBadges();
        })
        .catch((err: unknown) => {
          console.warn('[games] session log failed:', err);
        });
    },
    [celebrateBadges]
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

/** Full-stage loading/error placeholder while content resolves. */
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
    /* Loading uses animate-delayed-in (this fetch is ~100ms, so it would only blink); errors are never delayed. */
    <section
      className={clsx(
        'relative overflow-hidden rounded-3xl border border-white/10 bg-surface-container-lowest/60 shadow-2xl',
        state === 'loading' && 'animate-delayed-in'
      )}
      style={{ ['--stage-accent' as string]: styles.hex } as React.CSSProperties}
    >
      <div className="game-stage-glow" aria-hidden />
      <div className="game-dot-grid" aria-hidden />

      <div className="relative px-6 py-20 text-center">
        {state === 'loading' ? (
          <>
            <Spinner className={clsx('w-8 h-8 mx-auto', styles.text)} />
            {/* "Loading", not "Generating": generation already happened on the landing page. */}
            <p className="font-display text-lg font-bold text-white mt-5">Loading your game…</p>
            <p className="font-sans text-sm text-slate-500 mt-1.5">
              Getting your questions ready.
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
              className="mt-6 px-6 py-2.5 rounded-xl border border-white/10 font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-lowest"
            >
              Back to Games
            </button>
          </>
        )}
      </div>
    </section>
  );
}
