import React, { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, Plus, BookOpen, Layers, Brain, Award, BrainCircuit, ChartColumn, ChevronDown } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import FlashcardsTab from './studySpaceTabs/FlashcardsTab';
import FreeRecallTab from './studySpaceTabs/FreeRecallTab';
import FeynmanTab from './studySpaceTabs/FeynmanTab';
import AdaptiveTestTab from './studySpaceTabs/AdaptiveTestTab';
import ResourcesTab from './studySpaceTabs/ResourcesTab';
import AnalyticsTab from './studySpaceTabs/AnalyticsTab';
import { api } from '../../lib/api';
import { isDue } from '../../lib/reviewSchedule';
import type { EaseRating } from '../../lib/reviewSchedule';
import DueBadge from '../../components/ui/DueBadge';
import { SUBJECT_COLOR } from '../../components/educator/SubjectBadge';
import { useSubjectName } from '../../context/SubjectsContext';
import { useOnboarding } from '../../context/OnboardingContext';
import type { ToolKey } from '../../lib/onboarding';
import { DEFAULT_STUDY_TAB, readStudyIntent } from '../../lib/studySpace';
import type { StudyIntent, StudyTab } from '../../lib/studySpace';

/** Which first-run walkthrough belongs to which tab. */
/** The mobile tab menu, typed on StudyTab so ids match the desktop buttons. Resources leads (the default tab). */
const MOBILE_TABS: { id: StudyTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'resources', label: 'Learning Resources', icon: BookOpen },
  { id: 'flashcards', label: 'Flashcards', icon: Layers },
  { id: 'free-recall', label: 'Free Recall AI', icon: Brain },
  { id: 'feynman', label: 'Feynman Technique', icon: Award },
  { id: 'adaptive-test', label: 'Test Mode', icon: BrainCircuit },
  { id: 'analytics', label: 'Analytics', icon: ChartColumn },
];

const TAB_INTRO: Record<StudyTab, ToolKey> = {
  resources: 'tool_resources',
  flashcards: 'tool_flashcards',
  'free-recall': 'tool_free_recall',
  feynman: 'tool_feynman',
  'adaptive-test': 'tool_adaptive_test',
  analytics: 'tool_analytics',
};

interface Flashcard {
  id: string;
  front: string;
  back: string;
  /** The concept this card assesses. Nullable (ON DELETE SET NULL); membership tests must allow null. */
  conceptId?: string | null;
  /** The material that generated this card. */
  sourceMaterialId?: string | null;
  /** When this card is next due. Past or null = due now. */
  nextReviewAt?: string | null;
  /** The model wrote this card's front (a question). The back is always the educator's definition. */
  isAiGenerated?: boolean;
  /** Last self-rating, written only by counted ratings. Null (never rated while due) is common; never treat it as easy. */
  easeRating?: EaseRating | null;
}

interface FlashcardSet {
  id: string;
  title: string;
  description?: string;
  cardCount: number;
  cards: Flashcard[];
  /** Show the definition first. Stored on the deck row; display only. */
  answerFirst: boolean;
}

export default function StudySpace() {
  const subjectNameOf = useSubjectName();
  const { spaceId } = useParams();
  const [searchParams] = useSearchParams();

  // A recommendation's destination, from the URL (dashboard) or navigateWithin (inside this page). Read
  // once as the initial value, then consumed: tabs remount on entry, so a held intent would re-apply.
  const [seeded] = useState<StudyIntent | null>(() => readStudyIntent(searchParams));
  const [pending, setPending] = useState<StudyIntent | null>(seeded);
  const [activeTab, setActiveTab] = useState<StudyTab>(seeded?.tab ?? DEFAULT_STUDY_TAB);

  const consumePreselect = React.useCallback(() => setPending(null), []);

  /**
   * Follow a recommendation rendered inside this page. A callback, not a <Link>: a same-route link changes
   * the URL but not activeTab. Both setters batch, so the tab mounts once with its preselection.
   */
  const navigateWithin = React.useCallback((intent: StudyIntent) => {
    setPending(intent);
    setActiveTab(intent.tab);
    setIsMobileTabMenuOpen(false);
  }, []);

  const [isMobileTabMenuOpen, setIsMobileTabMenuOpen] = useState(false);
  const [courseConnected, setCourseConnected] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedSetContent, setSelectedSetContent] = useState<string | null>(null);

  const [currentSpace, setCurrentSpace] = useState<any>(null);
  const [flashcardSets, setFlashcardSets] = useState<FlashcardSet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // concept_count = how many cards a material will produce.
  const [availableResources, setAvailableResources] = useState<
    { id: string; title: string; concept_count: number }[]
  >([]);

  // Offer the tab's walkthrough on entry (startTour no-ops when seen or busy). Not while loading, and
  // after a short delay so the tab's anchors exist.
  const { startTour } = useOnboarding();
  useEffect(() => {
    if (isLoading) return;
    const t = setTimeout(() => startTour(TAB_INTRO[activeTab]), 700);
    return () => clearTimeout(t);
  }, [activeTab, isLoading, startTour]);

  /** Due cards across the space's decks, derived from cards already loaded (no endpoint). Refreshes via onRefresh. */
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

      // Study spaces are the primary container; courseConnected bypasses legacy course prompts.
      setCourseConnected(true);

      try {
        // Already filtered to this grade and subject; only processed materials have concepts.
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
            // ?? false for rows predating answer_first.
            answerFirst: deck.answer_first ?? false,
            cardCount: cardsList.length,
            cards: cardsList.map((c: any) => ({
              id: c.id,
              front: c.term,
              back: c.definition,
              // The route already sends concept_id; keep it so test results can match cards.
              conceptId: c.concept_id ?? null,
              sourceMaterialId: c.source_material_id ?? null,
              nextReviewAt: c.next_review_at ?? null,
              isAiGenerated: c.is_ai_generated ?? false,
              easeRating: c.ease_rating ?? null,
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

  /* Subject accent, one colour per subject across the app. */
  const subjectAccent = (currentSpace?.subject && SUBJECT_COLOR[currentSpace.subject]) || '#94a3b8';

  if (isLoading) {
    /* Matches the loaded view's height (StudentLayout reserves pt-16 on mobile). */
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
                {/* --theme-glow, not a literal cyan, so it follows the theme. */}
                <span className="w-2.5 h-2.5 rounded-full bg-primary-fixed-dim shadow-[0_0_10px_var(--theme-glow)] shrink-0" />
                <span className="truncate">{currentSpace ? currentSpace.title : 'Study Space'}</span>
              </h1>
              {/* No lock icon: the pill is plainly a fixed subject label. */}
              {currentSpace?.subject && (
                <span
                  className="px-2.5 py-1 rounded-full border font-sans text-[10px] font-bold uppercase tracking-wider shrink-0"
                  style={{
                    color: subjectAccent,
                    backgroundColor: `${subjectAccent}1a`,
                    borderColor: `${subjectAccent}33`,
                  }}
                >
                  {subjectNameOf(currentSpace.subject)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Tab strip */}
        <div className="relative w-full mb-2">
          {/* no-scrollbar (scrollbar-none doesn't exist). Tight gaps: up to eight tabs. */}
          <div className="hidden sm:flex gap-3 md:gap-6 overflow-x-auto pb-px no-scrollbar pr-8">
            <button
              onClick={() => setActiveTab('resources')}
              className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] rounded-t flex items-center gap-2 shrink-0 ${activeTab === 'resources' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
            >
              <BookOpen className="w-4 h-4" />
              {/* lg:inline so long labels shorten on tablet widths. */}
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
              {/* "Analytics" is short already; no split label. */}
              <ChartColumn className="w-4 h-4" />
              Analytics
            </button>
          </div>

          {/* Mobile tab select */}
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
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* The due count rides beside the chevron, visible while the menu is shut. */}
                {activeTab !== 'flashcards' && <DueBadge count={dueCount} />}
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${isMobileTabMenuOpen ? 'rotate-180' : ''}`} />
              </div>
            </button>

            {isMobileTabMenuOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-slate-900 border border-white/10 rounded-2xl shadow-2xl z-[60] py-2 fade-in duration-200">
                {MOBILE_TABS.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id);
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

      {/* Main content */}
      {/* scrollbar-gutter: stable, so switching between tabs that do and don't overflow never shifts the content width. */}
      <main key={activeTab} className="flex-1 overflow-y-auto [scrollbar-gutter:stable] w-full max-w-7xl mx-auto p-4 sm:p-6 md:p-8 relative animate-page-fade">

        {activeTab === 'flashcards' && (
          <FlashcardsTab
            spaceId={spaceId!}
            selectedSetContent={selectedSetContent}
            flashcardSets={flashcardSets}
            setSelectedSetContent={setSelectedSetContent}
            onRefresh={fetchSpaceData}
            availableResources={availableResources}
            preselect={pending?.tab === 'flashcards' ? pending : null}
            onPreselectConsumed={consumePreselect}
          />
        )}

        {/* preselect only reaches the tab the intent names; each tab validates the ids. */}
        {activeTab === 'free-recall' && (
          <FreeRecallTab
            availableResources={availableResources}
            spaceId={spaceId!}
            preselect={pending?.tab === 'free-recall' ? pending : null}
            onPreselectConsumed={consumePreselect}
          />
        )}

        {activeTab === 'feynman' && (
          <FeynmanTab
            availableResources={availableResources}
            spaceId={spaceId!}
            preselect={pending?.tab === 'feynman' ? pending : null}
            onPreselectConsumed={consumePreselect}
          />
        )}

        {activeTab === 'adaptive-test' && (
          <AdaptiveTestTab
            spaceId={spaceId!}
            availableResources={availableResources}
            preselect={pending?.tab === 'adaptive-test' ? pending : null}
            onPreselectConsumed={consumePreselect}
            onNavigate={navigateWithin}
          />
        )}

        {/* Read-only, refetched on each entry (remount). flashcardSets isn't passed: opportunity_count already covers both sources. */}
        {activeTab === 'analytics' && (
          <AnalyticsTab
            spaceId={spaceId!}
            availableResources={availableResources}
            onNavigate={navigateWithin}
          />
        )}

        {activeTab === 'resources' && (
          <ResourcesTab
            spaceId={spaceId!}
            courseConnected={courseConnected}
            selectedDoc={selectedDoc}
            handleConnectCourse={handleConnectCourse}
            setSelectedDoc={setSelectedDoc}
            setActiveTab={setActiveTab}
            setIsGenerating={setIsGenerating}
            setSelectedSetContent={setSelectedSetContent as any}
            setFlashcardSets={setFlashcardSets as any}
            preselect={pending?.tab === 'resources' ? pending : null}
            onPreselectConsumed={consumePreselect}
          />
        )}
      </main>

    </div>
  );
}
