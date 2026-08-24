import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Gamepad2,
  BrainCircuit,
  ArrowRight,
  Hourglass,
  HelpCircle,
  AlertCircle,
  FileText,
  Check,
  History,
  Sparkles,
  CheckCircle2,
  XCircle,
  Lightbulb,
  ChevronRight,
  LucideIcon
} from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
import clsx from 'clsx';
import Modal from '../../../components/ui/Modal';
import { api } from '../../../lib/api';
import {
  masteryApi,
  masteryTier,
  masteryPercent,
  TIER_LABEL,
  TIER_TONE,
  type SpaceMastery,
} from '../../../lib/mastery';
import { toneText } from '../../../components/ui/surfaces';
// PRE/POST GATE — temporary research instrument (migration 0024). Delete with it.
import { assessmentApi } from '../../../lib/assessments';
import { getCourseDisplayInfo } from './gamesData';
import { SessionDetail } from './gameUi';

/**
 * What the game about to be generated will be calibrated to.
 *
 * EQ(4) over the UNION of the selected materials — the same figure the server
 * will compute and store as `game_content.mastery_snapshot`. Reconstructed here
 * from the per-material numbers the summary endpoint already returns, because
 * `M_union = Σ(m_doc_i · n_i) / Σ n_i` and `by_material` carries both.
 *
 * ⚠️ FILTERED TO THE SELECTED IDS, never `mastery.overall`. `overall` is the
 * whole space; the server snapshots only the materials the game is built from.
 * Using it here is the likeliest way to make this preview disagree with the row
 * it is predicting.
 *
 * The per-material `m_doc` values are already rounded to 4dp by
 * `documentMastery()`, so this reconstruction can differ from the server's own
 * value by at most ~1e-4. That can only change the tier when the true M_doc lies
 * inside a ~2e-4 band around 0.50 or 0.85, and the stage header shows the
 * server's own tier a moment later either way.
 */
function unionMastery(
  mastery: SpaceMastery | null,
  selectedIds: string[]
): { mDoc: number; assessed: number } | null {
  if (!mastery || selectedIds.length === 0) return null;

  const selected = new Set(selectedIds);
  const rows = mastery.by_material.filter((m) => selected.has(m.material_id));
  const concepts = rows.reduce((sum, m) => sum + m.concept_count, 0);
  if (concepts === 0) return null;

  const weighted = rows.reduce((sum, m) => sum + m.m_doc * m.concept_count, 0);
  return {
    mDoc: Math.round((weighted / concepts) * 10_000) / 10_000,
    assessed: rows.reduce((sum, m) => sum + m.assessed_concept_count, 0),
  };
}

type GameTypeUi = 'matching' | 'crossword' | 'trivia';
type GameTypeApi = 'term_matcher' | 'crossword' | 'timed_trivia';

// Maps the UI game label to the backend game_type enum.
const GAME_TYPE_API: Record<GameTypeUi, GameTypeApi> = {
  matching: 'term_matcher',
  crossword: 'crossword',
  trivia: 'timed_trivia',
};

// Per-game presentation, shared by the launch cards and the history list.
const GAME_META: Record<
  GameTypeApi,
  { title: string; description: string; icon: LucideIcon; accent: string; iconWrap: string }
> = {
  term_matcher: {
    title: 'Term Matching',
    description: 'Link each course term to its exact definition — clear the board with no mistakes.',
    icon: BrainCircuit,
    accent: 'text-primary-fixed-dim',
    iconWrap: 'bg-primary-fixed-dim/10 border-primary-fixed-dim/20 text-primary-fixed-dim',
  },
  crossword: {
    title: 'Crossword',
    description: 'Solve interlocking clues in an interactive grid built from your material.',
    icon: HelpCircle,
    accent: 'text-amber-400',
    iconWrap: 'bg-amber-400/10 border-amber-400/20 text-amber-400',
  },
  timed_trivia: {
    title: 'Timed Trivia',
    description: 'Answer rapid-fire questions against the clock and chase your best streak.',
    icon: Hourglass,
    /* Violet, not cyan. `cyan-400` (#22d3ee) is a shade off `term_matcher`'s
       `primary-fixed-dim` (#00daf3), so two of the three games read as the same
       colour and the trio had only two identities. `violet-400` (#a78bfa) is the
       `[data-theme="violet"]` accent, so it is a value the design system already
       carries, and it is light enough to take `text-black` like amber does. */
    accent: 'text-violet-400',
    iconWrap: 'bg-violet-400/10 border-violet-400/20 text-violet-400',
  },
};

// Per-tone hover treatment for the launch cards. Kept as full literal class
// strings so Tailwind's JIT can see them (it can't scan built-up strings).
const GAME_FX: Record<
  GameTypeApi,
  { cardHover: string; glow: string; playIdle: string; playHover: string }
> = {
  term_matcher: {
    cardHover: 'hover:border-primary-fixed-dim/40 hover:shadow-[0_14px_44px_-14px] hover:shadow-primary-fixed-dim/45',
    glow: 'bg-primary-fixed-dim/10 group-hover:bg-primary-fixed-dim/25',
    playIdle: 'bg-primary-fixed-dim/10 text-primary-fixed-dim',
    playHover: 'group-hover:bg-primary-fixed-dim group-hover:text-on-primary-fixed',
  },
  crossword: {
    cardHover: 'hover:border-amber-400/40 hover:shadow-[0_14px_44px_-14px_rgba(251,191,36,0.45)]',
    glow: 'bg-amber-400/10 group-hover:bg-amber-400/25',
    playIdle: 'bg-amber-400/10 text-amber-400',
    playHover: 'group-hover:bg-amber-400 group-hover:text-black',
  },
  timed_trivia: {
    // rgba is violet-400 #a78bfa = rgb(167,139,250) — the shadow cannot take a
    // Tailwind colour token, so it is the one place the hex has to be restated.
    cardHover: 'hover:border-violet-400/40 hover:shadow-[0_14px_44px_-14px_rgba(167,139,250,0.45)]',
    glow: 'bg-violet-400/10 group-hover:bg-violet-400/25',
    playIdle: 'bg-violet-400/10 text-violet-400',
    playHover: 'group-hover:bg-violet-400 group-hover:text-black',
  },
};

const LAUNCH_ORDER: GameTypeUi[] = ['matching', 'crossword', 'trivia'];

interface StudySpace {
  id: string;
  title: string;
  description?: string | null;
}

interface Material {
  id: string;
  title: string;
  parsed_status: string;
}

interface GameSession {
  id: string;
  game_type: GameTypeApi;
  accuracy: number | null;
  time_spent_ms: number | null;
  detail: SessionDetail | null;
  completed_at: string;
  materials: { title: string } | null;
}

/** Compact "2h ago" / "3d ago" formatting for the history list. */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function GamesLanding() {
  const navigate = useNavigate();

  const [isBuildModalOpen, setIsBuildModalOpen] = useState(false);
  const [selectedGameType, setSelectedGameType] = useState<GameTypeUi | null>(null);

  const [spaces, setSpaces] = useState<StudySpace[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(false);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>('');

  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  // PRE/POST GATE — temporary. Lessons withheld from the list above.
  const [lockedCount, setLockedCount] = useState(0);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  const [mastery, setMastery] = useState<SpaceMastery | null>(null);

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [reviewSession, setReviewSession] = useState<GameSession | null>(null);

  // Load recent game history on mount (refreshes whenever this page remounts,
  // e.g. after returning from a finished game).
  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    api
      .get<GameSession[]>('/gamification/sessions')
      .then((res) => {
        if (!cancelled) setSessions(res.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the student's study spaces once the modal is first opened.
  useEffect(() => {
    if (!isBuildModalOpen || spaces.length > 0) return;

    let cancelled = false;
    setSpacesLoading(true);
    api
      .get<StudySpace[]>('/spaces')
      .then((res) => {
        if (cancelled) return;
        setSpaces(res.data ?? []);
        if (res.data?.[0]) setSelectedSpaceId(res.data[0].id);
      })
      .catch((err: unknown) => {
        if (!cancelled) setGenError(err instanceof Error ? err.message : 'Failed to load study spaces');
      })
      .finally(() => {
        if (!cancelled) setSpacesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isBuildModalOpen, spaces.length]);

  // Load materials whenever the selected space changes. Only parsed materials
  // have extracted concepts, so those are the only ones eligible for generation.
  // Nothing is pre-selected — the student picks what the game draws from.
  //
  // Mastery rides along in the same effect and shares the one loading flag, so
  // the tier preview is in hand before the student has finished ticking boxes —
  // no second spinner, no separate state machine. A failed mastery call becomes
  // null and hides the sentence; it must never block generation, because the
  // server computes the authoritative figure itself.
  useEffect(() => {
    if (!isBuildModalOpen || !selectedSpaceId) return;

    let cancelled = false;
    setMaterialsLoading(true);
    setGenError(null);

    Promise.all([
      api.get<{ materials: Material[] }>(`/spaces/${selectedSpaceId}/materials`),
      masteryApi.space(selectedSpaceId).catch(() => null),
      // PRE/POST GATE — temporary (migration 0024). This picker builds its own
      // list rather than receiving StudySpace's, so it needs its own lock lookup:
      // without it a locked lesson is offered, ticked, and answered with a 403 the
      // student cannot act on. Failing to [] fails OPEN, matching the server gate.
      assessmentApi.forSpace(selectedSpaceId).catch(() => []),
    ])
      .then(([res, spaceMastery, assessments]) => {
        if (cancelled) return;
        const locked = new Set(
          assessments.filter((a) => a.locked_phase).map((a) => a.material_id)
        );
        const completed = (res.data?.materials ?? []).filter(
          (m) => m.parsed_status === 'completed' && !locked.has(m.id)
        );
        setMaterials(completed);
        setSelectedMaterialIds([]);
        setMastery(spaceMastery);
        setLockedCount(locked.size);
      })
      .catch((err: unknown) => {
        if (!cancelled) setGenError(err instanceof Error ? err.message : 'Failed to load materials');
      })
      .finally(() => {
        if (!cancelled) setMaterialsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isBuildModalOpen, selectedSpaceId]);

  const openBuildModal = (gameType: GameTypeUi) => {
    setSelectedGameType(gameType);
    setGenError(null);
    setIsBuildModalOpen(true);
  };

  const handleBuildAndLaunchGame = useCallback(async () => {
    if (!selectedGameType || !selectedSpaceId || selectedMaterialIds.length === 0) return;

    setGenerating(true);
    setGenError(null);
    try {
      const res = await api.post<{ id: string }>('/games/generate', {
        space_id: selectedSpaceId,
        material_ids: selectedMaterialIds,
        game_type: GAME_TYPE_API[selectedGameType],
      });
      setIsBuildModalOpen(false);
      navigate(`/student/games/${selectedGameType}?contentId=${res.data.id}`);
    } catch (err: unknown) {
      setGenError(err instanceof Error ? err.message : 'Failed to generate game content');
    } finally {
      setGenerating(false);
    }
  }, [selectedGameType, selectedSpaceId, selectedMaterialIds, navigate]);

  const toggleMaterial = (id: string) => {
    setSelectedMaterialIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const allSelected = materials.length > 0 && selectedMaterialIds.length === materials.length;
  const preview = unionMastery(mastery, selectedMaterialIds);

  return (
    <div className="space-y-10 fade-in duration-300">
      {/* Game launchers */}
      <section className="space-y-4">
        <h2 className="font-sans text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
          Choose a game
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {LAUNCH_ORDER.map((ui, i) => {
            const type = GAME_TYPE_API[ui];
            const meta = GAME_META[type];
            const fx = GAME_FX[type];
            return (
              <button
                key={ui}
                type="button"
                onClick={() => openBuildModal(ui)}
                style={{ animationDelay: `${i * 80}ms` }}
                className={clsx(
                  'group relative overflow-hidden glass-card rounded-2xl border border-white/5 p-5 text-left flex flex-col gap-4',
                  'transition-all duration-300 ease-out will-change-transform',
                  'hover:-translate-y-1.5 active:translate-y-0 active:scale-[0.98]',
                  /* `focus:outline-none` removes the browser's indicator, and what
                     replaced it was `focus-visible:border-white/25` — a border
                     going from 5% to 25% white on a card that already animates
                     its border on hover. Effectively invisible, on the three
                     primary actions of the page. Same defect as `INPUT_CLASS` in
                     formKit.

                     `ring-on-surface` rather than the usual accent: each card
                     carries a DIFFERENT accent (cyan / amber / violet), so an
                     accent ring would match one card's identity and mislabel the
                     other two — and on the cyan card it would land accent-on-
                     accent. A neutral max-contrast ring reads the same on all
                     three. */
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  'fade-in',
                  fx.cardHover
                )}
              >
                {/* Corner glow — brightens on hover */}
                <div
                  aria-hidden
                  className={clsx(
                    'pointer-events-none absolute -top-12 -right-12 w-36 h-36 rounded-full blur-3xl transition-all duration-500',
                    fx.glow
                  )}
                />
                {/* Light sheen that sweeps across on hover */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -translate-x-[130%] group-hover:translate-x-[130%] transition-transform duration-[900ms] ease-out bg-gradient-to-r from-transparent via-white/[0.07] to-transparent"
                />

                <div
                  className={clsx(
                    'relative w-11 h-11 rounded-xl border flex items-center justify-center',
                    'transition-transform duration-300 ease-out group-hover:scale-110 group-hover:-rotate-6',
                    meta.iconWrap
                  )}
                >
                  <meta.icon className="w-5 h-5" />
                </div>
                <div className="relative flex-1">
                  <h3 className="font-display text-lg font-bold text-white">{meta.title}</h3>
                  <p className="font-sans text-sm text-slate-400 leading-relaxed mt-1.5">
                    {meta.description}
                  </p>
                </div>
                <span
                  className={clsx(
                    'relative self-start inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5',
                    'font-sans text-sm font-semibold transition-all duration-300 ease-out',
                    fx.playIdle,
                    fx.playHover
                  )}
                >
                  Play
                  <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Recent activity */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-slate-500" />
          <h2 className="font-sans text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
            Recent activity
          </h2>
        </div>

        <div className="glass-card rounded-2xl border border-white/5 divide-y divide-white/[0.04]">
          {historyLoading ? (
            <div className="flex items-center gap-2 p-5 text-slate-500 font-sans text-sm">
              <Spinner className="w-4 h-4" /> Loading your history…
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center text-center gap-1.5 px-6 py-12 animate-tab-in">
              <div className="w-11 h-11 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-1">
                <Sparkles className="w-5 h-5 text-slate-500" />
              </div>
              <p className="font-display text-sm font-bold text-white">No games played yet</p>
              <p className="font-sans text-xs text-slate-500 max-w-xs">
                Finish a game and your results — game, material, and accuracy — will show up here.
              </p>
            </div>
          ) : (
            /* ⚠️ WRAPPED IN A `divide-y` DIV, NOT JUST GIVEN A CLASS. The rows
               were direct children of the card, which owns the `divide-y`
               hairlines — so the wrapper has to carry that class too or every
               separator between sessions disappears. Entrance on the loaded
               rows; the spinner above must never animate in. */
            <div className="divide-y divide-white/[0.04] animate-tab-in">
            {sessions.map((s) => {
              const meta = GAME_META[s.game_type];
              const accuracyPct =
                s.accuracy === null ? null : Math.round(Math.max(0, Math.min(1, s.accuracy)) * 100);
              const reviewable = !!s.detail && s.detail.items.length > 0;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={!reviewable}
                  onClick={() => reviewable && setReviewSession(s)}
                  className={clsx(
                    'w-full flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-3 text-left transition-colors',
                    /* Inset ring: these rows sit in a `divide-y` list inside a
                       `rounded-2xl` container, so an outward ring would bleed
                       across the dividers and out of the rounded corners. */
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]',
                    reviewable ? 'hover:bg-white/[0.03] cursor-pointer' : 'cursor-default'
                  )}
                >
                  <div
                    className={clsx(
                      'w-9 h-9 shrink-0 rounded-lg border flex items-center justify-center',
                      meta.iconWrap
                    )}
                  >
                    <meta.icon className="w-4 h-4" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="font-sans text-sm font-semibold text-white truncate">{meta.title}</p>
                    <p className="font-sans text-[11px] text-slate-500 truncate">
                      {s.materials?.title ?? 'Study material'} · {relativeTime(s.completed_at)}
                    </p>
                  </div>

                  {accuracyPct !== null && (
                    <div className="text-right shrink-0">
                      <p className="font-display text-sm font-bold text-white tabular-nums">{accuracyPct}%</p>
                      {/* 9px is below the floor used anywhere else in the portal;
                          10px is the uppercase-micro-label size. */}
                      <p className="font-sans text-[10px] uppercase tracking-widest text-slate-500">accuracy</p>
                    </div>
                  )}

                  {reviewable ? (
                    /* The word drops below `sm:` and the chevron carries the
                       affordance alone. At 375px the icon, accuracy block and
                       this label leave the title and material name ~124px
                       between them; "Review" alone is ~45px of that. */
                    <span className="flex items-center gap-1 shrink-0 font-sans text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      <span className="hidden sm:inline">Review</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  ) : (
                    <span className="w-3.5 shrink-0" aria-hidden />
                  )}
                </button>
              );
            })}
            </div>
          )}
        </div>
      </section>

      {/* Game Build Modal */}
      <Modal
        isOpen={isBuildModalOpen && !!selectedGameType}
        onClose={() => !generating && setIsBuildModalOpen(false)}
        title={selectedGameType ? `Build ${GAME_META[GAME_TYPE_API[selectedGameType]].title} Game` : 'Build Game'}
        maxWidth="max-w-lg"
      >
      {/* ⚠️ THE ACTION ROW IS A SIBLING OF THE SCROLL BOX, NOT INSIDE IT. It used
          to sit within the same `overflow-y-auto` element, so on a space with
          several study spaces and a long material list the student had to scroll
          the modal to reach "Build & Launch". `ImportAccountsModal` records the
          same fix for the same reason.

          Sized against the chrome (`85vh` minus the header, error line, action
          row and gaps) rather than as a flat `vh` fraction — the chrome is a
          constant pixel height, so a fraction tuned on a 1080px screen overflows
          a 600px laptop. `Modal` itself has no max-height and centres with
          `items-center`, so anything taller than the viewport loses both ends. */}
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-6 max-h-[calc(85vh-15rem)] overflow-y-auto pr-1 no-scrollbar">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center">
                <Gamepad2 className="w-5 h-5 text-primary-fixed-dim" />
              </div>
              <div>
                <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">
                  Setup Game Content
                </p>
                <p className="font-sans text-xs text-slate-500">
                  Connect reference materials to formulate custom game content.
                </p>
              </div>
            </div>
          </div>

          {/* Study Space Selector */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-sans block">
              Target Space (Select 1)
            </label>

            {spacesLoading ? (
              <div className="flex items-center gap-2 p-3 text-slate-500 font-sans text-sm">
                <Spinner className="w-4 h-4" /> Loading your study spaces…
              </div>
            ) : spaces.length === 0 ? (
              <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-white/5 border border-white/10 p-3 rounded-xl animate-tab-in">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>No study spaces found. Create one and upload materials first.</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 animate-tab-in">
                {spaces.map((s) => {
                  const isSelected = selectedSpaceId === s.id;
                  const info = getCourseDisplayInfo({ id: s.id, title: s.title, category: '' });
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedSpaceId(s.id)}
                      aria-pressed={isSelected}
                      className={clsx(
                        'w-full flex items-center gap-3 p-3 rounded-xl border font-sans text-left transition-all active:scale-[0.99]',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]',
                        isSelected
                          ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim text-white shadow-[0_0_15px] shadow-primary-fixed-dim/15'
                          : 'bg-surface-container border-white/5 text-slate-300 hover:bg-white/5 hover:text-white'
                      )}
                    >
                      <div className={`p-2 rounded-lg ${info.bg}`}>
                        <info.icon className={`w-4 h-4 ${info.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="block font-semibold text-sm truncate">{s.title}</span>
                        {s.description && (
                          <span className="block text-[11px] text-slate-500 truncate">{s.description}</span>
                        )}
                      </div>
                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-primary-fixed-dim flex items-center justify-center text-black">
                          <Check className="w-3.5 h-3.5 font-bold" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Learning Materials Selector */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 font-sans">
                Learning Materials (Select Multiple)
              </label>
              {materials.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedMaterialIds(allSelected ? [] : materials.map((m) => m.id))}
                  className="text-[11px] font-sans font-bold text-primary-fixed-dim hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-lowest"
                >
                  {allSelected ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>

            {/* No `max-h-48 overflow-y-auto` here any more. It made this a scroll
                region INSIDE the modal's own scroll region: you scrolled the
                material list, hit its end, and then the modal began to move —
                the nested-scrolling confusion already reported on the Free Recall
                history. The modal has one scroll box now and this grows inside
                it. The space list above was never capped either, so the inner cap
                was not what bounded the modal's height. */}
            {/* ⚠️ `bg-white/<opacity>`, NOT `bg-slate-950/50`, AND THE REASON IS
                THE LIGHT THEME. `index.css` patches exactly three nested-tile
                classes under `[data-theme="white"]` — `bg-white/[0.01]`,
                `bg-white/[0.02]` and `bg-white/5` — remapping them to a slate-100
                tile with a hairline border. A raw palette class gets no such
                override: `--color-slate-950` is still `#020617` on the light
                theme, so this well rendered as a near-black panel inside a pure
                white modal. Latent rather than live only because `ThemeContext`
                is currently pinned to `THEMES[0]`.

                It also reads BETTER on the dark themes. `Modal`'s panel is
                `surface-container-lowest` (#060e20), so a half-opacity slate-950
                well resolved to ~#040a1b — a well that was very nearly invisible
                against the surface it was meant to sit in. */}
            <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3 space-y-2.5">
              {materialsLoading ? (
                <div className="flex items-center gap-2 p-2 text-slate-500 font-sans text-xs">
                  <Spinner className="w-4 h-4" /> Loading materials…
                </div>
              ) : materials.length === 0 ? (
                <div className="flex items-center gap-1.5 text-xs text-slate-500 p-2 font-sans animate-tab-in">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>
                  {lockedCount > 0
                    ? 'Take the test for these lessons in your study space first.'
                    : 'No processed materials in this space yet.'}
                </span>
                </div>
              ) : (
                /* `space-y-2.5` is repeated here because the rows are this
                   div's children now, not the well's — without it the checkbox
                   list collapses into an unspaced block. Entrance on the loaded
                   rows, not on the spinner. */
                <div className="space-y-2.5 animate-tab-in">
                {materials.map((m) => {
                  const isChecked = selectedMaterialIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleMaterial(m.id)}
                      aria-pressed={isChecked}
                      className={clsx(
                        'w-full flex items-center gap-3 p-2.5 rounded-lg border font-sans text-xs text-left transition-all',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]',
                        isChecked
                          ? 'bg-white/5 border-white/10 text-white'
                          : 'bg-transparent border-transparent text-slate-400 hover:bg-white/5 hover:text-white'
                      )}
                    >
                      <div
                        className={clsx(
                          'w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0',
                          isChecked ? 'bg-primary-fixed-dim border-primary-fixed-dim text-black' : 'border-white/20 bg-white/5'
                        )}
                      >
                        {isChecked && <Check className="w-3.5 h-3.5 font-bold" />}
                      </div>
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="truncate flex-1 font-medium">{m.title}</span>
                    </button>
                  );
                })}
                </div>
              )}
            </div>

            {materials.length > 0 && selectedMaterialIds.length === 0 && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500 p-2.5 font-sans">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Select at least one material to build the game.</span>
              </div>
            )}

            {/* The calibration, stated BEFORE anything is generated — which is what
                makes the paper's p. 99 test case ("educational game generation and
                difficulty calibration") observable without database access.

                Shown only once something has been assessed, matching the identical
                sentence in AdaptiveTestTab: at a cold start every student is
                foundational, which says nothing, and every unassessed concept sits
                at P(L₀) = 0.10, which must never be printed as a score. The tier
                still reaches the student a moment later on the game's own header,
                where it is the server's own value rather than a prediction. */}
            {preview && preview.assessed > 0 && (
              <p className="font-sans text-xs text-slate-400 p-2.5">
                Your mastery across{' '}
                {selectedMaterialIds.length === 1 ? 'this lesson' : 'these lessons'} is{' '}
                <span className={clsx('font-semibold', toneText[TIER_TONE[masteryTier(preview.mDoc)]])}>
                  {masteryPercent(preview.mDoc)}%
                </span>
                , so this game will be built at{' '}
                <span className={clsx('font-semibold', toneText[TIER_TONE[masteryTier(preview.mDoc)]])}>
                  {TIER_LABEL[masteryTier(preview.mDoc)].toLowerCase()}
                </span>{' '}
                level.
              </p>
            )}
          </div>
        </div>

        {/* Outside the scroll box too: a generation failure must be visible at
            the moment the button that caused it is, not parked above the fold. */}
        {genError && (
          <div className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-500/5 border border-rose-500/10 p-2.5 rounded-xl">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{genError}</span>
          </div>
        )}

        <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setIsBuildModalOpen(false)}
              disabled={generating}
              className="flex-1 py-3 rounded-xl border border-white/10 font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-all disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-lowest"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleBuildAndLaunchGame}
              disabled={selectedMaterialIds.length === 0 || generating}
              /* `ring-on-surface`, not the accent — this button's background is
                 the accent, so an accent ring would be the same colour twice. */
              className="flex-1 py-3 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-sans font-bold text-sm hover:bg-primary-container transition-all active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none shadow-lg shadow-primary-fixed-dim/20 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-surface focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-lowest"
            >
              {generating ? (
                <>
                  <Spinner className="w-4 h-4" /> Generating…
                </>
              ) : (
                'Build & Launch Game'
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* Session Review Modal */}
      <SessionReviewModal session={reviewSession} onClose={() => setReviewSession(null)} />
    </div>
  );
}

/* ---------------------------------------------------------------
   Session review — per-item breakdown of a finished game
   --------------------------------------------------------------- */

function SessionReviewModal({
  session,
  onClose,
}: {
  session: GameSession | null;
  onClose: () => void;
}) {
  const detail = session?.detail ?? null;
  const meta = session ? GAME_META[session.game_type] : null;

  return (
    <Modal
      isOpen={!!session && !!detail}
      onClose={onClose}
      title={meta ? `${meta.title} — Review` : 'Review'}
      maxWidth="max-w-lg"
    >
      <div className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto pr-1 no-scrollbar">
        {session && (
          <p className="font-sans text-xs text-slate-500">
            {session.materials?.title ?? 'Study material'} · {relativeTime(session.completed_at)}
          </p>
        )}

        {detail?.type === 'trivia' && <TriviaReview items={detail.items} />}
        {detail?.type === 'term_matcher' && <TermMatchReview items={detail.items} />}
        {detail?.type === 'crossword' && <CrosswordReview items={detail.items} />}
      </div>
    </Modal>
  );
}

function ReviewOutcomeBadge({ tone, label }: { tone: 'good' | 'bad' | 'warn'; label: string }) {
  const styles =
    tone === 'good'
      ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
      : tone === 'bad'
        ? 'bg-rose-500/10 border-rose-500/25 text-rose-400'
        : 'bg-amber-400/10 border-amber-400/25 text-amber-400';
  return (
    <span
      className={clsx(
        'shrink-0 rounded-md border px-2 py-0.5 font-sans text-[10px] font-bold uppercase tracking-widest',
        styles
      )}
    >
      {label}
    </span>
  );
}

function TriviaReview({ items }: { items: Extract<SessionDetail, { type: 'trivia' }>['items'] }) {
  const correct = items.filter((i) => i.outcome === 'correct').length;
  return (
    <>
      <p className="font-sans text-[11px] font-bold uppercase tracking-widest text-slate-500">
        {correct} of {items.length} correct
      </p>
      <div className="space-y-2.5">
        {items.map((item, idx) => {
          const wrong = item.outcome !== 'correct';
          return (
            <div
              key={idx}
              className={clsx(
                'rounded-xl border p-3',
                wrong ? 'bg-rose-500/[0.04] border-rose-500/15' : 'bg-emerald-500/[0.04] border-emerald-500/15'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-sans text-sm font-semibold text-white leading-snug">
                  {idx + 1}. {item.question}
                </p>
                {item.outcome === 'correct' ? (
                  <ReviewOutcomeBadge tone="good" label="Correct" />
                ) : item.outcome === 'timeout' ? (
                  <ReviewOutcomeBadge tone="warn" label="Timed out" />
                ) : (
                  <ReviewOutcomeBadge tone="bad" label="Wrong" />
                )}
              </div>

              <div className="mt-2 space-y-1">
                {wrong && (
                  <p className="flex items-center gap-1.5 font-sans text-xs text-rose-300">
                    <XCircle className="w-3.5 h-3.5 shrink-0" />
                    Your answer: {item.selected ?? '— (no answer)'}
                  </p>
                )}
                <p className="flex items-center gap-1.5 font-sans text-xs text-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  Correct answer: {item.correct}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function TermMatchReview({ items }: { items: Extract<SessionDetail, { type: 'term_matcher' }>['items'] }) {
  const clean = items.filter((i) => i.wrongAttempts === 0).length;
  return (
    <>
      <p className="font-sans text-[11px] font-bold uppercase tracking-widest text-slate-500">
        {clean} of {items.length} matched first try
      </p>
      <div className="space-y-2">
        {items.map((item, idx) => {
          const struggled = item.wrongAttempts > 0;
          return (
            <div
              key={idx}
              className={clsx(
                'rounded-xl border p-3',
                struggled ? 'bg-amber-400/[0.04] border-amber-400/15' : 'bg-white/[0.02] border-white/[0.06]'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-display text-sm font-bold text-white">{item.term}</p>
                {struggled ? (
                  <ReviewOutcomeBadge
                    tone="warn"
                    label={`${item.wrongAttempts} miss${item.wrongAttempts === 1 ? '' : 'es'}`}
                  />
                ) : (
                  <ReviewOutcomeBadge tone="good" label="Clean" />
                )}
              </div>
              <p className="mt-1 font-sans text-xs text-slate-400 leading-relaxed">{item.definition}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}

function CrosswordReview({ items }: { items: Extract<SessionDetail, { type: 'crossword' }>['items'] }) {
  const unaided = items.filter((i) => i.hintedLetters === 0).length;
  return (
    <>
      <p className="font-sans text-[11px] font-bold uppercase tracking-widest text-slate-500">
        {unaided} of {items.length} solved without hints
      </p>
      <div className="space-y-2">
        {items.map((item, idx) => {
          const hinted = item.hintedLetters > 0;
          return (
            <div
              key={idx}
              className={clsx(
                'rounded-xl border p-3',
                hinted ? 'bg-amber-400/[0.04] border-amber-400/15' : 'bg-white/[0.02] border-white/[0.06]'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-sans text-xs text-slate-400 leading-snug">
                  <span className="font-bold text-slate-300 uppercase">
                    {item.number} {item.direction}
                  </span>{' '}
                  {item.clue}
                </p>
                {hinted && (
                  <span className="flex items-center gap-1 shrink-0 rounded-md border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 font-sans text-[10px] font-bold uppercase tracking-widest text-amber-400">
                    <Lightbulb className="w-3 h-3" /> {item.hintedLetters}
                  </span>
                )}
              </div>
              <p className="mt-1.5 font-display text-sm font-bold tracking-[0.15em] text-white">{item.answer}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}
