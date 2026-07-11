import React, { useState, useEffect } from 'react';
import { ChevronLeft, Plus, BookOpen, Layers, Globe, Lock, Eye, EyeOff, Brain, Award, BrainCircuit, Share2, Copy, Check, ChevronDown, Loader2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import Modal from '../../components/ui/Modal';
import FlashcardsTab from './studySpaceTabs/FlashcardsTab';
import FreeRecallTab from './studySpaceTabs/FreeRecallTab';
import FeynmanTab from './studySpaceTabs/FeynmanTab';
import AdaptiveTestTab from './studySpaceTabs/AdaptiveTestTab';
import ResourcesTab from './studySpaceTabs/ResourcesTab';
import { createPortal } from 'react-dom';
import { api } from '../../lib/api';

interface Flashcard {
  id: string;
  front: string;
  back: string;
}

interface FlashcardSet {
  id: string;
  title: string;
  description?: string;
  cardCount: number;
  cards: Flashcard[];
  isPublic: boolean;
}

export default function StudySpace() {
  const { spaceId } = useParams();
  const [activeTab, setActiveTab] = useState<'flashcards' | 'free-recall' | 'feynman' | 'adaptive-test' | 'resources'>('flashcards');
  const [isMobileTabMenuOpen, setIsMobileTabMenuOpen] = useState(false);
  const [courseConnected, setCourseConnected] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedSetContent, setSelectedSetContent] = useState<string | null>(null);
  const [isCreateDeckModalOpen, setIsCreateDeckModalOpen] = useState(false);
  const [newDeckTitle, setNewDeckTitle] = useState('');
  
  const [currentSpace, setCurrentSpace] = useState<any>(null);
  const [flashcardSets, setFlashcardSets] = useState<FlashcardSet[]>([]);
  const [spaceIsPublic, setSpaceIsPublic] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [showVisibilityToast, setShowVisibilityToast] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [availableResources, setAvailableResources] = useState<{ id: string; title: string }[]>([]);

  const fetchSpaceData = async () => {
    if (!spaceId) return;
    try {
      const resSpace = await api.get<any>(`/spaces/${spaceId}`);
      const space = resSpace.data;
      setCurrentSpace(space);
      setSpaceIsPublic(!!space.is_published);

      // Since courses are removed, study spaces act as the primary container.
      // Set courseConnected to true to bypass any legacy 'connect course' UI prompts.
      setCourseConnected(true);
      
      try {
        const resMaterials = await api.get<any>(`/materials/space/${spaceId}`);
        const materials = resMaterials.data?.data || resMaterials.data || [];
        if (materials.length > 0) {
          setAvailableResources(materials.map((m: any) => ({ id: m.id, title: m.title || m.name })));
        } else {
          setAvailableResources([]);
        }
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
            })),
            isPublic: deck.is_public || false
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

  const handleToggleSpaceVisibility = async () => {
    if (!currentSpace || isCloned) return;
    const newVisibility = !spaceIsPublic;
    try {
      await api.put(`/spaces/${spaceId}`, {
        is_published: newVisibility
      });
      setSpaceIsPublic(newVisibility);
      triggerToast();
    } catch (err) {
      console.error('Failed to update visibility', err);
    }
  };

  const handleToggleDeckVisibility = async (deckId: string) => {
    if (isCloned) return;
    const deck = flashcardSets.find(s => s.id === deckId);
    if (!deck) return;
    try {
      await api.put(`/spaces/${spaceId}/decks/${deckId}`, {
        title: deck.title,
        description: deck.description,
        is_public: !deck.isPublic
      });
      setFlashcardSets(prev =>
        prev.map(s => s.id === deckId ? { ...s, isPublic: !s.isPublic } : s)
      );
      triggerToast();
    } catch (err) {
      console.error('Failed to toggle deck visibility', err);
    }
  };

  const triggerToast = () => {
    setShowVisibilityToast(true);
    setTimeout(() => setShowVisibilityToast(false), 2500);
  };

  const handleCreateDeck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeckTitle.trim() || isCloned) return;
    try {
      await api.post(`/spaces/${spaceId}/decks`, {
        title: newDeckTitle.trim(),
        description: `Key concepts from ${currentSpace?.title || 'Study Space'}.`
      });
      await fetchSpaceData();
      setNewDeckTitle('');
      setIsCreateDeckModalOpen(false);
    } catch (err) {
      console.error('Failed to create deck', err);
    }
  };

  const isCloned = !!(currentSpace?.cloned_from_id || currentSpace?.original_author_name);
  const publicDeckCount = flashcardSets.filter(s => s.isPublic).length;

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

      {/* Visibility toast */}
      {showVisibilityToast && createPortal(
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[70] animate-in fade-in slide-in-from-top-3 duration-200">
          <div className="flex items-center gap-3 bg-surface-container-high border border-white/10 px-5 py-3 rounded-2xl shadow-2xl backdrop-blur-md">
            <Globe className="w-4 h-4 text-primary-fixed-dim" />
            <span className="font-sans text-sm text-white font-medium">
              {spaceIsPublic
                ? `${publicDeckCount} deck${publicDeckCount !== 1 ? 's' : ''} visible to your followers`
                : 'Space set to private — no decks visible to others'}
            </span>
          </div>
        </div>,
        document.body
      )}

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
                <span className="truncate">{currentSpace ? currentSpace.title : "Biology 101 Prep Space"}</span>
              </h1>
              {/* Space visibility badge */}
              {!isCloned && (
                <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-sans text-[10px] font-bold uppercase tracking-wider transition-colors shrink-0 ${spaceIsPublic
                  ? 'bg-emerald-400/10 border-emerald-400/20 text-emerald-400'
                  : 'bg-white/5 border-white/10 text-slate-500'
                  }`}>
                  {spaceIsPublic ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                  {spaceIsPublic ? 'Public' : 'Private'}
                </span>
              )}
              {isCloned && (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary-fixed-dim/20 bg-primary-fixed-dim/5 text-primary-fixed-dim font-sans text-[10px] font-bold uppercase tracking-wider shrink-0">
                  Cloned Space {currentSpace.original_author_name ? `by ${currentSpace.original_author_name}` : ''}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isCloned && (
              spaceIsPublic ? (
                <>
                  {/* Share Link & QR Button */}
                  <button
                    onClick={() => setIsShareModalOpen(true)}
                    className="flex items-center gap-2 px-3 md:px-4 py-2 md:py-2.5 rounded-xl border border-primary-fixed-dim/20 bg-primary-fixed-dim/10 text-primary-fixed-dim hover:bg-primary-fixed-dim/20 font-sans text-xs md:text-sm font-semibold transition-all active:scale-95 animate-in fade-in duration-200"
                  >
                    <Share2 className="w-4 h-4" />
                    <span className="hidden sm:inline">Share Link &amp; QR</span>
                  </button>
                  {/* Make Private Button */}
                  <button
                    onClick={handleToggleSpaceVisibility}
                    className="flex items-center gap-2 px-3 md:px-4 py-2 md:py-2.5 rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white font-sans text-xs md:text-sm font-semibold transition-all active:scale-95 animate-in fade-in duration-200"
                  >
                    <EyeOff className="w-4 h-4" />
                    <span className="hidden sm:inline">Make Private</span>
                  </button>
                </>
              ) : (
                /* Publicize Button */
                <button
                  onClick={() => setIsShareModalOpen(true)}
                  className="flex items-center gap-2 px-3 md:px-4 py-2 md:py-2.5 rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white font-sans text-xs md:text-sm font-semibold transition-all active:scale-95"
                >
                  <Globe className="w-4 h-4" />
                  <span className="hidden sm:inline">Publicize Space</span>
                </button>
              )
            )}
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
                {activeTab === 'resources' && <><BookOpen className="w-4 h-4 text-primary-fixed-dim" /> <span>Course Resources</span></>}
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

        {/* Info banner when space is public */}
        {!isCloned && spaceIsPublic && (
          <div className="mb-6 flex items-center gap-4 px-5 py-4 rounded-xl bg-emerald-400/5 border border-emerald-400/15 animate-in fade-in duration-300">
            <div className="w-9 h-9 rounded-full bg-emerald-400/10 flex items-center justify-center shrink-0">
              <Eye className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-sans text-sm font-semibold text-emerald-300">
                Your space is public — {publicDeckCount} of {flashcardSets.length} deck{flashcardSets.length !== 1 ? 's' : ''} visible to followers
              </p>
              <p className="font-sans text-xs text-slate-500 mt-0.5">
                Followers can view and study the decks you've marked as public. Toggle individual decks below.
              </p>
            </div>
            <button
              onClick={handleToggleSpaceVisibility}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 font-sans text-xs font-semibold transition-colors"
            >
              <Lock className="w-3.5 h-3.5" /> Make Private
            </button>
          </div>
        )}

        {activeTab === 'flashcards' && (
          <FlashcardsTab
            spaceId={spaceId!}
            readOnly={isCloned}
            courseConnected={courseConnected}
            isGenerating={isGenerating}
            selectedSetContent={selectedSetContent}
            flashcardSets={flashcardSets}
            setSelectedSetContent={setSelectedSetContent}
            setIsCreateDeckModalOpen={setIsCreateDeckModalOpen}
            setActiveTab={setActiveTab as any}
            onRefresh={fetchSpaceData}
            availableResources={availableResources}
            spaceIsPublic={spaceIsPublic}
            onToggleDeckVisibility={handleToggleDeckVisibility}
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

      {/* Create Deck Modal */}
      <Modal isOpen={isCreateDeckModalOpen} onClose={() => { setIsCreateDeckModalOpen(false); setNewDeckTitle(''); }} title="Create New Deck">
        <form onSubmit={handleCreateDeck} className="flex flex-col gap-6">
          <div className="space-y-2">
            <label htmlFor="deckTitle" className="font-sans text-sm font-medium text-slate-300">Deck Title</label>
            <input
              id="deckTitle"
              type="text"
              value={newDeckTitle}
              onChange={e => setNewDeckTitle(e.target.value)}
              placeholder="e.g. Biology 101 Midterm"
              className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 focus:border-primary-fixed-dim transition-all"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => { setIsCreateDeckModalOpen(false); setNewDeckTitle(''); }} className="px-5 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors">Cancel</button>
            <button type="submit" disabled={!newDeckTitle.trim()} className="px-5 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all disabled:opacity-50 disabled:cursor-not-allowed">Create Deck</button>
          </div>
        </form>
      </Modal>

      {/* Share & Publicize Space Modal */}
      <Modal
        isOpen={isShareModalOpen}
        onClose={() => { setIsShareModalOpen(false); }}
        title="CollabShare: Share & Publicize Space"
        maxWidth="max-w-md"
      >
        <div className="flex flex-col items-center text-center gap-5">
          {!spaceIsPublic ? (
            <>
              <div className="w-16 h-16 rounded-full bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center text-primary-fixed-dim">
                <Globe className="w-8 h-8" />
              </div>
              <div>
                <h3 className="font-display text-lg font-bold text-white mb-2">Publicize this Study Space?</h3>
                <p className="font-sans text-sm text-slate-400 px-2 leading-relaxed">
                  Publicizing creates a shareable link and a unique QR Code. Other students will be able to study or clone your decks to their own Study Spaces.
                </p>
              </div>

              <div className="flex justify-end gap-3 w-full pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setIsShareModalOpen(false)}
                  className="flex-1 py-3 bg-white/5 text-slate-300 hover:bg-white/10 rounded-xl font-sans text-sm font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await api.put(`/spaces/${spaceId}`, { is_published: true });
                      setSpaceIsPublic(true);
                      setShowVisibilityToast(true);
                      setTimeout(() => setShowVisibilityToast(false), 2500);
                    } catch (err) {
                      console.error('Failed to make space public', err);
                    }
                  }}
                  className="flex-1 py-3 bg-primary-fixed-dim text-black hover:bg-primary-fixed-dim/90 rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 transition-all"
                >
                  Enable CollabShare
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="relative group p-3 bg-surface-container border border-white/10 rounded-2xl shadow-inner flex flex-col items-center justify-center">
                <div className="absolute inset-0 bg-primary-fixed-dim/10 blur-xl opacity-50 group-hover:opacity-80 transition-opacity rounded-full"></div>
                <div className="bg-slate-950 p-4 rounded-xl border border-white/5 relative z-10">
                  <svg viewBox="0 0 100 100" className="w-40 h-40 text-primary-fixed-dim fill-current">
                    <path d="M5,5 h25 v25 h-25 z M9,9 h17 v17 h-17 z M13,13 h9 v9 h-9 z" />
                    <path d="M70,5 h25 v25 h-25 z M74,9 h17 v17 h-17 z M78,13 h9 v9 h-9 z" />
                    <path d="M5,70 h25 v25 h-25 z M9,74 h17 v17 h-17 z M13,78 h9 v9 h-9 z" />
                    <path d="M75,75 h10 v10 h-10 z M79,79 h2 v2 h-2 z" />
                    <path d="M35,10 h5 v5 h-5 z M45,10 h10 v5 h-10 z M60,10 h5 v5 h-5 z" />
                    <path d="M10,35 h5 v5 h-5 z M10,45 h5 v10 h-5 z M10,60 h5 v5 h-5 z" />
                    <path d="M35,20 h5 v5 h-5 z M45,20 h5 v5 h-5 z M55,20 h10 v5 h-10 z M35,27 h10 v3 h-10 z M50,27 h5 v3 h-5 z" />
                    <path d="M35,35 h5 v5 h-5 z M45,35 h10 v5 h-10 z M60,35 h5 v5 h-5 z M70,35 h5 v5 h-5 z M80,35 h15 v5 h-15 z" />
                    <path d="M35,45 h15 v5 h-15 z M55,45 h5 v5 h-5 z M65,45 h10 v5 h-10 z M80,45 h5 v5 h-5 z M90,45 h5 v5 h-5 z" />
                    <path d="M35,55 h5 v5 h-5 z M45,55 h10 v5 h-10 z M60,55 h5 v5 h-5 z M70,55 h15 v5 h-15 z M90,55 h5 v5 h-5 z" />
                    <path d="M35,65 h10 v5 h-10 z M50,65 h5 v5 h-5 z M60,65 h15 v5 h-15 z M80,65 h5 v5 h-5 z M90,65 h5 v5 h-5 z" />
                    <path d="M35,75 h5 v5 h-5 z M45,75 h10 v5 h-10 z M60,75 h5 v5 h-5 z M90,75 h5 v5 h-5 z" />
                    <path d="M35,85 h15 v5 h-15 z M55,85 h5 v5 h-5 z M65,85 h10 v5 h-10 z M90,85 h5 v5 h-5 z" />
                  </svg>
                </div>
              </div>

              <div className="w-full">
                <h4 className="font-display text-sm font-semibold text-slate-300 mb-2.5 text-left">Share Link</h4>
                <div className="flex gap-2 bg-slate-950 border border-white/10 rounded-xl p-1 w-full pl-3 items-center">
                  <span className="font-sans text-xs text-slate-400 select-all truncate flex-1 text-left">
                    {`${window.location.origin}/student/spaces?clone=${currentSpace?.id}`}
                  </span>
                  <button
                    onClick={() => {
                      const shareLink = `${window.location.origin}/student/spaces?clone=${currentSpace?.id}`;
                      navigator.clipboard.writeText(shareLink);
                      setIsCopied(true);
                      setTimeout(() => setIsCopied(false), 2000);
                    }}
                    className={`px-4 py-2 rounded-lg font-sans text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${isCopied
                      ? 'bg-teal-500/10 border border-teal-500/20 text-teal-400'
                      : 'bg-white/5 border border-white/5 text-slate-300 hover:text-white hover:bg-white/10'
                      }`}
                  >
                    {isCopied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-3 w-full pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await api.put(`/spaces/${spaceId}`, { is_published: false });
                      setSpaceIsPublic(false);
                      setShowVisibilityToast(true);
                      setTimeout(() => setShowVisibilityToast(false), 2500);
                      setIsShareModalOpen(false);
                    } catch (err) {
                      console.error('Failed to revoke access', err);
                    }
                  }}
                  className="flex-1 py-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 rounded-xl font-sans text-sm font-semibold transition-all"
                >
                  Revoke Access
                </button>
                <button
                  type="button"
                  onClick={() => setIsShareModalOpen(false)}
                  className="flex-1 py-2.5 bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 rounded-xl font-sans text-sm font-semibold transition-all"
                >
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
