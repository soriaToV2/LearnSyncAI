import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronLeft, Plus, BookOpen, Layers, Lock, Brain, Award, BrainCircuit, ChartColumn, ChevronDown, ClipboardList } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import { Link, useParams } from 'react-router-dom';
import FlashcardsTab from './studySpaceTabs/FlashcardsTab';
import FreeRecallTab from './studySpaceTabs/FreeRecallTab';
import FeynmanTab from './studySpaceTabs/FeynmanTab';
import AdaptiveTestTab from './studySpaceTabs/AdaptiveTestTab';
import ResourcesTab from './studySpaceTabs/ResourcesTab';
import AnalyticsTab from './studySpaceTabs/AnalyticsTab';
import { api } from '../../lib/api';
import { isDue } from '../../lib/reviewSchedule';
import DueBadge from '../../components/ui/DueBadge';
import { SUBJECT_COLOR } from '../../components/educator/SubjectBadge';
import { subjectName } from '../../data/mockEducator';
// PRE/POST GATE — temporary research instrument (migration 0024). Delete this
// import, the two tabs it mounts, the lock state and the banner to remove it.
import StudentAssessmentTab from './studySpaceTabs/StudentAssessmentTab';
import { assessmentApi, type AssessmentSummary } from '../../lib/assessments';

interface Flashcard {
  id: string;
  front: string;
  back: string;
  /** Which material generated this card — drives "already in this deck". */
  sourceMaterialId?: string | null;
  /** When this card is next due. Past or null = due now. */
  nextReviewAt?: string | null;
}

interface FlashcardSet {
  id: string;
  title: string;
  description?: string;
  cardCount: number;
  cards: Flashcard[];
}

export default function StudySpace() {
  const { spaceId } = useParams();
  const [activeTab, setActiveTab] = useState<'flashcards' | 'free-recall' | 'feynman' | 'adaptive-test' | 'resources' | 'analytics' | 'pre-test' | 'post-test'>('flashcards');
  const [isMobileTabMenuOpen, setIsMobileTabMenuOpen] = useState(false);
  const [courseConnected, setCourseConnected] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedSetContent, setSelectedSetContent] = useState<string | null>(null);

  const [currentSpace, setCurrentSpace] = useState<any>(null);
  const [flashcardSets, setFlashcardSets] = useState<FlashcardSet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // `concept_count` is how many cards a material will produce. The other study
  // tabs read only id and title and are unaffected by the extra field.
  const [availableResources, setAvailableResources] = useState<
    { id: string; title: string; concept_count: number }[]
  >([]);

  /**
   * Cards waiting for review across every deck in this space.
   *
   * Derived, not fetched. `fetchSpaceData` already pulls every card with its
   * `next_review_at`, so this costs nothing — and deliberately so: the old
   * `GET /api/flashcards/due/:spaceId` was deleted for returning any space's
   * cards to any logged-in user, and nothing here needs it back.
   *
   * It also refreshes itself. `FlashcardsTab.exitStudy()` calls `onRefresh`,
   * which is `fetchSpaceData`, so finishing a session drops the badge with no
   * extra wiring.
   */
  /*
   * PRE/POST GATE — TEMPORARY research instrument (migration 0024).
   *
   * The lock map is fetched HERE rather than per tab, because six different
   * material pickers must agree about what is locked and a per-tab fetch would let
   * them disagree. That makes it the one piece of state on this page that
   * `<main key={activeTab}>` does not refresh on its own — so every path that can
   * CHANGE a lock calls `refreshLocks` explicitly: finishing a test (the assessment
   * tabs) and pulling in newly published materials (ResourcesTab). Same idiom as
   * `onRefresh` on FlashcardsTab.
   */
  const [assessments, setAssessments] = useState<AssessmentSummary[]>([]);

  const refreshLocks = useCallback(async () => {
    if (!spaceId) return;
    try {
      setAssessments(await assessmentApi.forSpace(spaceId));
    } catch {
      // Failing open is deliberate and matches the server gate: a broken lookup
      // must not lock a student out of their whole study space. The server is the
      // enforcement point regardless — this only decides what the UI offers.
      setAssessments([]);
    }
  }, [spaceId]);

  useEffect(() => {
    void refreshLocks();
  }, [refreshLocks]);

  /** Materials a released, unsat test is currently blocking. */
  const lockedIds = useMemo(
    () => new Set(assessments.filter((a) => a.locked_phase).map((a) => a.material_id)),
    [assessments]
  );

  /** Tabs appear only once their phase is released, so the bar is six tabs before
   *  the study starts and six again after it ends. */
  const hasPre = assessments.some((a) => a.pre.released);
  const hasPost = assessments.some((a) => a.post.released);

  /*
   * ⚠️ FILTERED ON `locked_phase` (is this material blocked?) BUT WORDED FROM
   * `action_phase` (what must they do about it?). Those are different fields for a
   * real reason: the lock points at the LATEST released phase, so a student who
   * owes a pre-test while the post-test is also out is locked on 'post', and
   * wording the banner from that told them to take the post-test — the one thing
   * the server refuses until the pre-test is done.
   */
  const lockedNotice = useMemo(() => {
    const blocked = assessments.filter((a) => a.locked_phase);
    if (blocked.length === 0) return null;
    return {
      phase: blocked[0].action_phase ?? blocked[0].locked_phase!,
      titles: blocked.map((a) => a.material_title),
    };
  }, [assessments]);

  const dueCount = useMemo(
    () => flashcardSets.flatMap(s => s.cards).filter(c => isDue(c.nextReviewAt)).length,
    [flashcardSets]
  );

  const fetchSpaceData = async () => {
    if (!spaceId) return;
    try {
      const resSpace = await api.get<any>(`/spaces/${spaceId}`);
      const space = resSpace.data;
      setCurrentSpace(space);

      // Since courses are removed, study spaces act as the primary container.
      // Set courseConnected to true to bypass any legacy 'connect course' UI prompts.
      setCourseConnected(true);

      try {
        // The space's materials, already filtered to this student's grade level and
        // this space's subject. Only fully processed ones have concepts, so only
        // those are offered to the study tools downstream.
        const resMaterials = await api.get<any>(`/spaces/${spaceId}/materials`);
        const materials = resMaterials.data?.materials ?? [];
        setAvailableResources(
          materials
            .filter((m: any) => m.parsed_status === 'completed')
            .map((m: any) => ({
              id: m.id,
              title: m.title,
              concept_count: m.concept_count ?? 0,
            }))
        );
      } catch (err) {
        console.error('Failed to load space materials', err);
        setAvailableResources([]);
      }

      const resDecks = await api.get<any>(`/spaces/${spaceId}/decks`);
      const decks = resDecks.data || [];

      const decksWithCards = await Promise.all(
        decks.map(async (deck: any) => {
          const resCards = await api.get<any>(`/spaces/${spaceId}/decks/${deck.id}/flashcards`);
          const cardsList = resCards.data || [];
          return {
            id: deck.id,
            title: deck.title,
            description: deck.description,
            cardCount: cardsList.length,
            cards: cardsList.map((c: any) => ({
              id: c.id,
              front: c.term,
              back: c.definition,
              sourceMaterialId: c.source_material_id ?? null,
              nextReviewAt: c.next_review_at ?? null,
            })),
          };
        })
      );
      setFlashcardSets(decksWithCards);
    } catch (err) {
      console.error('Failed to load study space details', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSpaceData();
  }, [spaceId]);

  const handleConnectCourse = () => setCourseConnected(true);

  /* Subject accent, matching the card in the spaces list and `SubjectBadge`
     everywhere else — one subject, one colour across the whole app. */
  const subjectAccent = (currentSpace?.subject && SUBJECT_COLOR[currentSpace.subject]) || '#94a3b8';

  if (isLoading) {
    /* Height must match the loaded view below. It was a bare `h-screen`, which on
       mobile is 4rem taller than the shell allows (StudentLayout reserves pt-16
       for its fixed top bar) — so the page scrolled by a header's height and then
       snapped back the moment the data landed. */
    return (
      <div className="h-[calc(100vh-4rem)] md:h-screen w-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-white">
          <Spinner className="w-8 h-8 text-primary-fixed-dim" />
          <span className="font-sans text-sm font-semibold">Loading study space...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] md:h-screen w-full flex flex-col bg-background overflow-hidden relative animate-page-fade">

      {/* Header */}
      <header className="shrink-0 pt-4 px-4 sm:px-5 md:px-6 border-b border-white/10 bg-page-50 backdrop-blur-md flex flex-col z-40">
        <div className="flex items-center justify-between pb-4 gap-2">
          <div className="flex items-center gap-2 md:gap-4 min-w-0">
            <Link to="/student/spaces" className="p-2 -ml-2 text-slate-400 hover:text-white transition-colors rounded-full hover:bg-white/5 shrink-0">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <h1 className="font-display text-base md:text-xl font-medium text-on-surface flex items-center gap-2 min-w-0">
                {/* The glow was `rgba(0,218,243,0.5)` — the cyan theme's accent
                    written out as a literal, so it stayed cyan under every
                    other palette and became an invisible cyan haze on white.
                    `--theme-glow` is the token `applyThemeToElement` sets for
                    exactly this, and it is already per-theme. */}
                <span className="w-2.5 h-2.5 rounded-full bg-primary-fixed-dim shadow-[0_0_10px_var(--theme-glow)] shrink-0" />
                <span className="truncate">{currentSpace ? currentSpace.title : 'Study Space'}</span>
              </h1>
              {/*
                * No `Lock` icon here any more. It meant "the subject is fixed",
                * but `Lock` ALSO means "this lesson is blocked by an unsat test"
                * on this very screen (the amber banner below, and the pickers in
                * every tab). One icon carrying two meanings on one page is worse
                * than the pill carrying none — it is self-evidently a subject
                * label, and nothing here offers to change it.
                */}
              {currentSpace?.subject && (
                <span
                  className="px-2.5 py-1 rounded-full border font-sans text-[10px] font-bold uppercase tracking-wider shrink-0"
                  style={{
                    color: subjectAccent,
                    backgroundColor: `${subjectAccent}1a`,
                    borderColor: `${subjectAccent}33`,
                  }}
                >
                  {subjectName(currentSpace.subject)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Navigation Tabs Container */}
        <div className="relative w-full mb-2">
          {/* `scrollbar-none` was a dead class — nothing in the codebase or in
              Tailwind v4 defines it, so the strip has been showing the scrollbar
              it meant to hide. The real utility is `.no-scrollbar` (index.css).
              Gaps are tighter than the old `gap-4 md:gap-8` because this row now
              carries up to EIGHT tabs once both study phases are released. */}
          <div className="hidden sm:flex gap-3 md:gap-6 overflow-x-auto pb-px no-scrollbar pr-8">
            <button
              onClick={() => setActiveTab('resources')}
              className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] rounded-t flex items-center gap-2 shrink-0 ${activeTab === 'resources' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
            >
              <BookOpen className="w-4 h-4" />
              {/* `hidden sm:inline` here was a no-op: this span lives inside a
                  `hidden sm:flex` row, so it appeared exactly when its parent
                  did. Moved to `lg:` so the three long labels actually shorten
                  the strip on tablet widths, where eight tabs overflow. */}
              <span><span className="hidden lg:inline">Learning </span>Resources</span>
            </button>
            <button
              onClick={() => setActiveTab('flashcards')}
              className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] rounded-t flex items-center gap-2 shrink-0 ${activeTab === 'flashcards' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
            >
              <Layers className="w-4 h-4" />
              Flashcards
              <DueBadge count={dueCount} />
            </button>
            <button
              onClick={() => setActiveTab('free-recall')}
              className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] rounded-t flex items-center gap-2 shrink-0 ${activeTab === 'free-recall' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
            >
              <Brain className="w-4 h-4" />
              Free Recall<span className="hidden lg:inline"> AI</span>
            </button>
            <button
              onClick={() => setActiveTab('feynman')}
              className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] rounded-t flex items-center gap-2 shrink-0 ${activeTab === 'feynman' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
            >
              <Award className="w-4 h-4" />
              Feynman<span className="hidden lg:inline"> Technique</span>
            </button>
            <button
              onClick={() => setActiveTab('adaptive-test')}
              className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] rounded-t flex items-center gap-2 shrink-0 ${activeTab === 'adaptive-test' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
            >
              <BrainCircuit className="w-4 h-4" />
              Test Mode
            </button>
            <button
              onClick={() => setActiveTab('analytics')}
              className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] rounded-t flex items-center gap-2 shrink-0 ${activeTab === 'analytics' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
            >
              {/* No `hidden sm:inline` split: the other labels drop a long half
                  on small screens, and "Analytics" is already one short word. */}
              <ChartColumn className="w-4 h-4" />
              Analytics
            </button>
            {/* PRE/POST GATE — temporary. Each tab renders only once its phase is
                released, so the bar is six tabs before the study and six after it.
                The badge counts lessons this phase is currently blocking. */}
            {hasPre && (
              <button
                onClick={() => setActiveTab('pre-test')}
                className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] rounded-t flex items-center gap-2 shrink-0 ${activeTab === 'pre-test' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
              >
                <ClipboardList className="w-4 h-4" />
                Pre-Test
                <DueBadge count={assessments.filter((a) => a.action_phase === 'pre').length} />
              </button>
            )}
            {hasPost && (
              <button
                onClick={() => setActiveTab('post-test')}
                className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] rounded-t flex items-center gap-2 shrink-0 ${activeTab === 'post-test' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
              >
                <ClipboardList className="w-4 h-4" />
                Post-Test
                <DueBadge count={assessments.filter((a) => a.action_phase === 'post').length} />
              </button>
            )}
          </div>

          {/* Mobile Tab Select Button & Dropdown */}
          <div className="sm:hidden relative z-50">
            <button
              onClick={() => setIsMobileTabMenuOpen(!isMobileTabMenuOpen)}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white font-sans text-sm font-semibold hover:bg-white/10 transition-all duration-300"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {activeTab === 'flashcards' && <><Layers className="w-4 h-4 text-primary-fixed-dim shrink-0" /> <span className="truncate">Flashcards</span></>}
                {activeTab === 'free-recall' && <><Brain className="w-4 h-4 text-primary-fixed-dim shrink-0" /> <span className="truncate">Free Recall AI</span></>}
                {activeTab === 'feynman' && <><Award className="w-4 h-4 text-primary-fixed-dim shrink-0" /> <span className="truncate">Feynman Technique</span></>}
                {activeTab === 'adaptive-test' && <><BrainCircuit className="w-4 h-4 text-primary-fixed-dim shrink-0" /> <span className="truncate">Test Mode</span></>}
                {activeTab === 'resources' && <><BookOpen className="w-4 h-4 text-primary-fixed-dim shrink-0" /> <span className="truncate">Learning Resources</span></>}
                {activeTab === 'analytics' && <><ChartColumn className="w-4 h-4 text-primary-fixed-dim shrink-0" /> <span className="truncate">Analytics</span></>}
                {/* PRE/POST GATE — temporary. */}
                {activeTab === 'pre-test' && <><ClipboardList className="w-4 h-4 text-primary-fixed-dim shrink-0" /> <span className="truncate">Pre-Test</span></>}
                {activeTab === 'post-test' && <><ClipboardList className="w-4 h-4 text-primary-fixed-dim shrink-0" /> <span className="truncate">Post-Test</span></>}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* The menu is shut on the collapsed button, so the due count has
                    to ride out here — otherwise a student on a phone only learns
                    cards are waiting by opening the menu. It sits beside the
                    CHEVRON rather than beside the active tab's label, where it
                    rendered immediately left of that label and read as though
                    Analytics (or whichever tab was open) had items due. */}
                {activeTab !== 'flashcards' && <DueBadge count={dueCount} />}
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${isMobileTabMenuOpen ? 'rotate-180' : ''}`} />
              </div>
            </button>

            {isMobileTabMenuOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-slate-900 border border-white/10 rounded-2xl shadow-2xl z-[60] py-2 fade-in duration-200">
                {[
                  { id: 'flashcards', label: 'Flashcards', icon: Layers },
                  { id: 'free-recall', label: 'Free Recall AI', icon: Brain },
                  { id: 'feynman', label: 'Feynman Technique', icon: Award },
                  { id: 'adaptive-test', label: 'Test Mode', icon: BrainCircuit },
                  // "Course Resources" here vs "Learning Resources" on the desktop
                  // tab — same destination, two names. Matched to the tab.
                  { id: 'resources', label: 'Learning Resources', icon: BookOpen },
                  { id: 'analytics', label: 'Analytics', icon: ChartColumn },
                  // PRE/POST GATE — temporary. Absent until the phase is released.
                  ...(hasPre ? [{ id: 'pre-test', label: 'Pre-Test', icon: ClipboardList }] : []),
                  ...(hasPost ? [{ id: 'post-test', label: 'Post-Test', icon: ClipboardList }] : []),
                ].map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id as any);
                        setIsMobileTabMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left font-sans text-sm transition-colors ${isActive
                        ? 'bg-primary-fixed-dim/15 text-primary-fixed-dim font-bold'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white'
                        }`}
                    >
                      <Icon className={`w-4 h-4 ${isActive ? 'text-primary-fixed-dim' : 'text-slate-400'}`} />
                      <span>{item.label}</span>
                      {item.id === 'flashcards' && <DueBadge count={dueCount} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* PRE/POST GATE — temporary. Sits OUTSIDE <main>, so it stays on screen as
          the student moves between tabs looking for the lesson that vanished from
          their pickers. */}
      {lockedNotice && activeTab !== 'pre-test' && activeTab !== 'post-test' && (
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 md:px-8 pt-4">
          <button
            onClick={() => setActiveTab(lockedNotice.phase === 'pre' ? 'pre-test' : 'post-test')}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] w-full text-left flex items-start gap-3 p-3.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] hover:bg-amber-500/10 transition-colors"
          >
            <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span className="min-w-0">
              <span className="block font-display text-sm text-amber-200">
                Take the {lockedNotice.phase === 'pre' ? 'pre-test' : 'post-test'} to unlock{' '}
                {lockedNotice.titles.length === 1 ? lockedNotice.titles[0] : `${lockedNotice.titles.length} lessons`}
              </span>
              <span className="block font-sans text-xs text-amber-200/60 mt-0.5">
                {lockedNotice.phase === 'pre'
                  ? 'This checks what you already know, so it comes before you study the lesson.'
                  : 'One last check now that you have studied.'}{' '}
                Other lessons in this space are unaffected.
              </span>
            </span>
          </button>
        </div>
      )}

      {/* Main Content */}
      {/*
        * `scrollbar-gutter: stable` — this is what stops the content twitching
        * horizontally when you switch tabs.
        *
        * The tabs disagree about whether they can overflow: Resources, Free Recall
        * and Feynman root at `h-full` and so exactly fit this box, while Flashcards
        * and Test Mode are natural-flow and can exceed it. Since this element is
        * `overflow-y-auto`, moving from one of the first group to one of the second
        * ADDS a scrollbar, which narrows the content box by the scrollbar's width —
        * and it lands mid-`animate-page-fade`, so the reflow reads as the panel
        * animating inwards rather than as a scrollbar appearing.
        *
        * Reserving the gutter permanently costs a few px of width on platforms with
        * classic scrollbars and nothing at all where they overlay (mobile, macOS),
        * in exchange for a content width that never changes between tabs.
        */}
      <main key={activeTab} className="flex-1 overflow-y-auto [scrollbar-gutter:stable] w-full max-w-7xl mx-auto p-4 sm:p-6 md:p-8 relative animate-page-fade">

        {activeTab === 'flashcards' && (
          <FlashcardsTab
            spaceId={spaceId!}
            selectedSetContent={selectedSetContent}
            flashcardSets={flashcardSets}
            setSelectedSetContent={setSelectedSetContent}
            onRefresh={fetchSpaceData}
            availableResources={availableResources}
            lockedIds={lockedIds}
          />
        )}

        {activeTab === 'free-recall' && (
          <FreeRecallTab availableResources={availableResources} spaceId={spaceId!} lockedIds={lockedIds} />
        )}

        {activeTab === 'feynman' && (
          <FeynmanTab availableResources={availableResources} spaceId={spaceId!} lockedIds={lockedIds} />
        )}

        {activeTab === 'adaptive-test' && (
          <AdaptiveTestTab spaceId={spaceId!} availableResources={availableResources} lockedIds={lockedIds} />
        )}

        {/* PRE/POST GATE — temporary. One component, phase-flipped: the only real
            difference between the two is what the SERVER will return afterwards
            (a pre-test result carries no per-question review). */}
        {activeTab === 'pre-test' && (
          <StudentAssessmentTab spaceId={spaceId!} phase="pre" onLocksChanged={() => void refreshLocks()} />
        )}

        {activeTab === 'post-test' && (
          <StudentAssessmentTab spaceId={spaceId!} phase="post" onLocksChanged={() => void refreshLocks()} />
        )}

        {/* Read-only. `<main key={activeTab}>` remounts this on every entry, so
            its own fetch is always fresh — which is why it takes no `onRefresh`
            and holds no cache. `flashcardSets` is deliberately not passed: it
            carries no review count, and `opportunity_count` in the mastery
            payload is the writer-of-record's own figure across both sources. */}
        {/* PRE/POST GATE: deliberately gets NO `lockedIds`. It reads no material
            content, and its empty state is "No lessons in this study space yet" —
            which would be a lie to a student whose only lesson is briefly locked. */}
        {activeTab === 'analytics' && (
          <AnalyticsTab spaceId={spaceId!} availableResources={availableResources} />
        )}

        {activeTab === 'resources' && (
          <ResourcesTab
            spaceId={spaceId!}
            courseConnected={courseConnected}
            selectedDoc={selectedDoc}
            handleConnectCourse={handleConnectCourse}
            setSelectedDoc={setSelectedDoc}
            setActiveTab={setActiveTab as any}
            setIsGenerating={setIsGenerating}
            setSelectedSetContent={setSelectedSetContent as any}
            setFlashcardSets={setFlashcardSets as any}
            lockedIds={lockedIds}
            onLocksChanged={() => void refreshLocks()}
          />
        )}
      </main>

    </div>
  );
}
