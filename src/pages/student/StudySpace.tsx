import React, { useState, useEffect } from 'react';
import { ChevronLeft, Plus, BookOpen, Layers, Lock, Brain, Award, BrainCircuit, ChevronDown, Loader2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import FlashcardsTab from './studySpaceTabs/FlashcardsTab';
import FreeRecallTab from './studySpaceTabs/FreeRecallTab';
import FeynmanTab from './studySpaceTabs/FeynmanTab';
import AdaptiveTestTab from './studySpaceTabs/AdaptiveTestTab';
import ResourcesTab from './studySpaceTabs/ResourcesTab';
import { api } from '../../lib/api';
import { subjectName } from '../../data/mockEducator';

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
  const [activeTab, setActiveTab] = useState<'flashcards' | 'free-recall' | 'feynman' | 'adaptive-test' | 'resources'>('flashcards');
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

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-white">
          <Loader2 className="w-8 h-8 animate-spin text-primary-fixed-dim" />
          <span className="font-sans text-sm font-semibold">Loading study space...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] md:h-screen w-full flex flex-col bg-background overflow-hidden relative animate-page-fade">

      {/* Header */}
      <header className="shrink-0 pt-4 px-4 md:px-6 border-b border-white/10 bg-page-50 backdrop-blur-md flex flex-col z-40">
        <div className="flex items-center justify-between pb-4 gap-2">
          <div className="flex items-center gap-2 md:gap-4 min-w-0">
            <Link to="/student/spaces" className="p-2 -ml-2 text-slate-400 hover:text-white transition-colors rounded-full hover:bg-white/5 shrink-0">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <h1 className="font-display text-base md:text-xl font-medium text-on-surface flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full bg-primary-fixed-dim shadow-[0_0_10px_rgba(0,218,243,0.5)] shrink-0" />
                <span className="truncate">{currentSpace ? currentSpace.title : 'Study Space'}</span>
              </h1>
              {currentSpace?.subject && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-slate-400 font-sans text-[10px] font-bold uppercase tracking-wider shrink-0">
                  <Lock className="w-3 h-3" />
                  {subjectName(currentSpace.subject)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Navigation Tabs Container */}
        <div className="relative w-full mb-2">
          <div className="hidden sm:flex gap-4 md:gap-8 overflow-x-auto pb-px scrollbar-none pr-8">
            <button
              onClick={() => setActiveTab('resources')}
              className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 shrink-0 ${activeTab === 'resources' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
            >
              <BookOpen className="w-4 h-4" />
              <span className="hidden sm:inline">Learning Resources</span>
            </button>            
            <button
              onClick={() => setActiveTab('flashcards')}
              className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 shrink-0 ${activeTab === 'flashcards' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
            >
              <Layers className="w-4 h-4" />
              Flashcards
            </button>
            <button
              onClick={() => setActiveTab('free-recall')}
              className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 shrink-0 ${activeTab === 'free-recall' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
            >
              <Brain className="w-4 h-4" />
              Free Recall<span className="hidden sm:inline"> AI</span>
            </button>
            <button
              onClick={() => setActiveTab('feynman')}
              className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 shrink-0 ${activeTab === 'feynman' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
            >
              <Award className="w-4 h-4" />
              Feynman<span className="hidden sm:inline"> Technique</span>
            </button>
            <button
              onClick={() => setActiveTab('adaptive-test')}
              className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 shrink-0 ${activeTab === 'adaptive-test' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
            >
              <BrainCircuit className="w-4 h-4" />
              Test Mode
            </button>
          </div>

          {/* Mobile Tab Select Button & Dropdown */}
          <div className="sm:hidden relative z-50">
            <button
              onClick={() => setIsMobileTabMenuOpen(!isMobileTabMenuOpen)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white font-sans text-sm font-semibold hover:bg-white/10 transition-all duration-300"
            >
              <div className="flex items-center gap-2.5">
                {activeTab === 'flashcards' && <><Layers className="w-4 h-4 text-primary-fixed-dim" /> <span>Flashcards</span></>}
                {activeTab === 'free-recall' && <><Brain className="w-4 h-4 text-primary-fixed-dim" /> <span>Free Recall AI</span></>}
                {activeTab === 'feynman' && <><Award className="w-4 h-4 text-primary-fixed-dim" /> <span>Feynman Technique</span></>}
                {activeTab === 'adaptive-test' && <><BrainCircuit className="w-4 h-4 text-primary-fixed-dim" /> <span>Test Mode</span></>}
                {activeTab === 'resources' && <><BookOpen className="w-4 h-4 text-primary-fixed-dim" /> <span>Learning Resources</span></>}
              </div>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${isMobileTabMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {isMobileTabMenuOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-slate-900 border border-white/10 rounded-2xl shadow-2xl z-[60] py-2 animate-in fade-in slide-in-from-top-2 duration-200">
                {[
                  { id: 'flashcards', label: 'Flashcards', icon: Layers },
                  { id: 'free-recall', label: 'Free Recall AI', icon: Brain },
                  { id: 'feynman', label: 'Feynman Technique', icon: Award },
                  { id: 'adaptive-test', label: 'Test Mode', icon: BrainCircuit },
                  { id: 'resources', label: 'Course Resources', icon: BookOpen },
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
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main key={activeTab} className="flex-1 overflow-y-auto w-full max-w-7xl mx-auto p-4 md:p-8 relative animate-page-fade">

        {activeTab === 'flashcards' && (
          <FlashcardsTab
            spaceId={spaceId!}
            selectedSetContent={selectedSetContent}
            flashcardSets={flashcardSets}
            setSelectedSetContent={setSelectedSetContent}
            onRefresh={fetchSpaceData}
            availableResources={availableResources}
          />
        )}

        {activeTab === 'free-recall' && (
          <FreeRecallTab availableResources={availableResources} spaceId={spaceId!} />
        )}

        {activeTab === 'feynman' && (
          <FeynmanTab availableResources={availableResources} spaceId={spaceId!} />
        )}

        {activeTab === 'adaptive-test' && (
          <AdaptiveTestTab
            flashcardSets={flashcardSets}
            availableResources={availableResources}
            courseConnected={courseConnected}
          />
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
          />
        )}
      </main>

    </div>
  );
}
