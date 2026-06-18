import React, { useState, useEffect } from 'react';
import { ChevronLeft, X, Plus, BookOpen, Layers, Globe, Lock, Eye, EyeOff, Brain, Award, BrainCircuit, Share2, Copy, Check, ChevronDown } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import Modal from '../../components/ui/Modal';
import FlashcardsTab from './components/FlashcardsTab';
import FreeRecallTab from './components/FreeRecallTab';
import FeynmanTab from './components/FeynmanTab';
import AdaptiveTestTab from './components/AdaptiveTestTab';
import ResourcesTab from './components/ResourcesTab';
import { createPortal } from 'react-dom';
import { getSavedSpaces, updateSavedSpaceFlashcards } from '../../data/mockPublicSpaces';

interface FlashcardSet {
  id: number;
  title: string;
  description?: string;
  cardCount: number;
  cards: { id: number; front: string; back: string }[];
  isPublic: boolean; // ← visibility toggle
}

export default function StudySpace() {
  const { spaceId } = useParams();
  const [activeTab, setActiveTab] = useState<'flashcards' | 'free-recall' | 'feynman' | 'adaptive-test' | 'resources'>('flashcards');
  const [isMobileTabMenuOpen, setIsMobileTabMenuOpen] = useState(false);
  const [courseConnected, setCourseConnected] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedSetContent, setSelectedSetContent] = useState<number | null>(null);
  const [isCreateDeckModalOpen, setIsCreateDeckModalOpen] = useState(false);
  const [newDeckTitle, setNewDeckTitle] = useState('');

  // Look up current space details (combine volatile and persistent)
  const [spaces, setSpaces] = useState(() => {
    try {
      const saved = localStorage.getItem('my_study_spaces');
      const localArray = saved ? JSON.parse(saved) : [];
      return [...getSavedSpaces(), ...localArray];
    } catch {
      return getSavedSpaces();
    }
  });

  const currentSpace = spaces.find((s: any) => s.id === spaceId);

  // ── Space-level visibility ───────────────────────────────────────────────
  const [spaceIsPublic, setSpaceIsPublic] = useState(() => {
    return currentSpace ? !!currentSpace.isPublic : false;
  });
  const [showVisibilityToast, setShowVisibilityToast] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const availableResources = currentSpace?.resources || ['Synaptic_Pathways_Ch4.pdf', 'Lecture_03_Action_Potentials.pptx', 'Study_Guide_Midterm.docx'];

  const [flashcardSets, setFlashcardSets] = useState<FlashcardSet[]>(() => {
    if (currentSpace && currentSpace.flashcards) {
      return [
        {
          id: 1,
          title: currentSpace.title,
          description: currentSpace.description || `Key concepts from ${currentSpace.title}.`,
          cardCount: currentSpace.flashcards.length,
          isPublic: true,
          cards: currentSpace.flashcards
        }
      ];
    }
    return [
      {
        id: 1,
        title: 'Ch 4. Synaptic Transmission',
        description: 'Key concepts from chapter 4 covering neurotransmitter release and synaptic function.',
        cardCount: 3,
        isPublic: true,
        cards: [
          { id: 1,  front: 'What initiates the release of neurotransmitters?', back: 'An influx of Calcium ions (Ca2+) into the presynaptic terminal, triggered by an action potential.' },
          { id: 10, front: 'What is the synaptic cleft?', back: 'The tiny gap between the presynaptic and postsynaptic neurons where neurotransmitters are released.' },
          { id: 11, front: 'What are vesicles in the context of synaptic transmission?', back: 'Small membrane-bound sacs that store neurotransmitters and release them via exocytosis.' },
        ],
      },
      {
        id: 2,
        title: 'Midterm Review Terms',
        description: 'Essential definitions and concepts to review before the midterm examination.',
        cardCount: 3,
        isPublic: false,
        cards: [
          { id: 2,  front: 'What is primary function of the myelin sheath?', back: 'To increase the speed at which electrical impulses travel along the axon.' },
          { id: 20, front: 'What is an action potential?', back: 'A rapid, temporary change in membrane potential that travels along the axon of a neuron.' },
          { id: 21, front: "Define 'resting membrane potential'.", back: 'The electrical potential difference across the neuronal membrane when the neuron is not firing, typically around -70mV.' },
        ],
      },
    ];
  });

  useEffect(() => {
    if (spaceId && spaceId.startsWith('space-')) {
      const mainSet = flashcardSets[0];
      if (!mainSet) return;
      
      if (currentSpace?.isImported) {
        // Update volatile in-memory store
        updateSavedSpaceFlashcards(spaceId, mainSet.cards);
      } else {
        // Update persistent localStorage store
        try {
          const saved = localStorage.getItem('my_study_spaces');
          if (saved) {
            const spacesArray = JSON.parse(saved);
            const idx = spacesArray.findIndex((s: any) => s.id === spaceId);
            if (idx !== -1) {
              spacesArray[idx].flashcards = mainSet.cards;
              spacesArray[idx].flashcardsCount = mainSet.cards.length;
              localStorage.setItem('my_study_spaces', JSON.stringify(spacesArray));
            }
          }
        } catch (e) {
          console.error('Error syncing flashcards back', e);
        }
      }
    }
  }, [flashcardSets, spaceId, currentSpace]);

  const handleConnectCourse = () => setCourseConnected(true);

  const updateSpaceVisibilityInStore = (isPublic: boolean) => {
    if (!spaceId) return;
    if (currentSpace?.isImported) {
      const list = getSavedSpaces();
      const match = list.find((s: any) => s.id === spaceId);
      if (match) {
        match.isPublic = isPublic;
      }
    } else {
      try {
        const saved = localStorage.getItem('my_study_spaces');
        if (saved) {
          const spacesArray = JSON.parse(saved);
          const idx = spacesArray.findIndex((s: any) => s.id === spaceId);
          if (idx !== -1) {
            spacesArray[idx].isPublic = isPublic;
            localStorage.setItem('my_study_spaces', JSON.stringify(spacesArray));
          }
        }
      } catch (e) {
        console.error('Error saving visibility', e);
      }
    }
  };

  // ── Toggle whole space visibility ────────────────────────────────────────
  const handleToggleSpaceVisibility = () => {
    if (spaceIsPublic) {
      setSpaceIsPublic(false);
      updateSpaceVisibilityInStore(false);
      setFlashcardSets(prev => prev.map(s => ({ ...s, isPublic: false })));
      triggerToast();
    } else {
      setIsShareModalOpen(true);
    }
  };

  // ── Toggle individual deck visibility ────────────────────────────────────
  const handleToggleDeckVisibility = (deckId: number) => {
    setFlashcardSets(prev =>
      prev.map(s => s.id === deckId ? { ...s, isPublic: !s.isPublic } : s)
    );
    triggerToast();
  };

  const triggerToast = () => {
    setShowVisibilityToast(true);
    setTimeout(() => setShowVisibilityToast(false), 2500);
  };

  const handleCreateDeck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeckTitle.trim()) return;
    setFlashcardSets(prev => [...prev, { id: Date.now(), title: newDeckTitle.trim(), cardCount: 0, cards: [], isPublic: false }]);
    setNewDeckTitle('');
    setIsCreateDeckModalOpen(false);
  };

  // count public decks
  const publicDeckCount = flashcardSets.filter(s => s.isPublic).length;

  return (
    <div className="h-[calc(100vh-4rem)] md:h-screen w-full flex flex-col bg-background overflow-hidden relative">

      {/* ── Visibility toast ── */}
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

      {/* ── Header ── */}
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
              <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-sans text-[10px] font-bold uppercase tracking-wider transition-colors shrink-0 ${
                spaceIsPublic
                  ? 'bg-emerald-400/10 border-emerald-400/20 text-emerald-400'
                  : 'bg-white/5 border-white/10 text-slate-500'
              }`}>
                {spaceIsPublic ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                {spaceIsPublic ? 'Public' : 'Private'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {spaceIsPublic ? (
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
                onClick={handleToggleSpaceVisibility}
                className="flex items-center gap-2 px-3 md:px-4 py-2 md:py-2.5 rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white font-sans text-xs md:text-sm font-semibold transition-all active:scale-95"
              >
                <Globe className="w-4 h-4" />
                <span className="hidden sm:inline">Publicize Space</span>
              </button>
            )}
          </div>
        </div>

        {/* Navigation Tabs Container */}
        <div className="relative w-full mb-2">
          {/* Desktop/Tablet Horizontal Tabs */}
          <div className="hidden sm:flex gap-4 md:gap-8 overflow-x-auto pb-px scrollbar-none pr-8">
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
            <button
              onClick={() => setActiveTab('resources')}
              className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 shrink-0 ${activeTab === 'resources' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
            >
              <BookOpen className="w-4 h-4" />
              <span className="hidden sm:inline">Course </span>Resources
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
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left font-sans text-sm transition-colors ${
                        isActive 
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

      {/* ── Main Content ── */}
      <main className="flex-1 overflow-y-auto w-full max-w-7xl mx-auto p-4 md:p-8 relative">

        {/* Info banner when space is public */}
        {spaceIsPublic && (
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
            courseConnected={courseConnected}
            isGenerating={isGenerating}
            selectedSetContent={selectedSetContent}
            flashcardSets={flashcardSets}
            setSelectedSetContent={setSelectedSetContent}
            setIsCreateDeckModalOpen={setIsCreateDeckModalOpen}
            setActiveTab={setActiveTab as any}
            setFlashcardSets={setFlashcardSets}
            availableResources={availableResources}
            spaceIsPublic={spaceIsPublic}
            onToggleDeckVisibility={handleToggleDeckVisibility}
          />
        )}

        {activeTab === 'free-recall' && (
          <FreeRecallTab availableResources={availableResources} />
        )}

        {activeTab === 'feynman' && (
          <FeynmanTab availableResources={availableResources} />
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
            courseConnected={courseConnected}
            selectedDoc={selectedDoc}
            handleConnectCourse={handleConnectCourse}
            setSelectedDoc={setSelectedDoc}
            setActiveTab={setActiveTab as any}
            setIsGenerating={setIsGenerating}
            setSelectedSetContent={setSelectedSetContent}
            setFlashcardSets={setFlashcardSets}
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

      {/* ── Share & Publicize Space Modal ── */}
      <Modal 
        isOpen={isShareModalOpen} 
        onClose={() => { setIsShareModalOpen(false); }} 
        title="CollabShare: Share & Publicize Space"
        maxWidth="max-w-md"
      >
        <div className="flex flex-col items-center text-center gap-5">
          {!spaceIsPublic ? (
            <>
              <div className="w-16 h-16 rounded-full bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center text-primary-fixed-dim shadow-lg shadow-primary-fixed-dim/5">
                <Globe className="w-8 h-8 animate-pulse" />
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
                  onClick={() => {
                    setSpaceIsPublic(true);
                    updateSpaceVisibilityInStore(true);
                    // Trigger visibility toast
                    setShowVisibilityToast(true);
                    setTimeout(() => setShowVisibilityToast(false), 2500);
                  }} 
                  className="flex-1 py-3 bg-primary-fixed-dim text-black hover:bg-primary-fixed-dim/90 rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 transition-all"
                >
                  Enable CollabShare
                </button>
              </div>
            </>
          ) : (
            <>
              {/* QR Code Graphic Container with premium cyberpunk glow */}
              <div className="relative group p-3 bg-surface-container border border-white/10 rounded-2xl shadow-inner flex flex-col items-center justify-center">
                <div className="absolute inset-0 bg-primary-fixed-dim/10 blur-xl opacity-50 group-hover:opacity-80 transition-opacity rounded-full"></div>
                <div className="bg-slate-950 p-4 rounded-xl border border-white/5 relative z-10">
                  <svg viewBox="0 0 100 100" className="w-40 h-40 text-primary-fixed-dim fill-current">
                    {/* Finder Pattern: Top-Left */}
                    <path d="M5,5 h25 v25 h-25 z M9,9 h17 v17 h-17 z M13,13 h9 v9 h-9 z" />
                    {/* Finder Pattern: Top-Right */}
                    <path d="M70,5 h25 v25 h-25 z M74,9 h17 v17 h-17 z M78,13 h9 v9 h-9 z" />
                    {/* Finder Pattern: Bottom-Left */}
                    <path d="M5,70 h25 v25 h-25 z M9,74 h17 v17 h-17 z M13,78 h9 v9 h-9 z" />
                    {/* Alignment Pattern & Timing Patterns */}
                    <path d="M75,75 h10 v10 h-10 z M79,79 h2 v2 h-2 z" />
                    <path d="M35,10 h5 v5 h-5 z M45,10 h10 v5 h-10 z M60,10 h5 v5 h-5 z" />
                    <path d="M10,35 h5 v5 h-5 z M10,45 h5 v10 h-5 z M10,60 h5 v5 h-5 z" />
                    {/* Stylized QR Dotted Pattern Noise */}
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
                    {`${window.location.origin}/student/spaces?clone=${spaceId?.replace('space-', '') || 's1'}`}
                  </span>
                  <button
                    onClick={() => {
                      const shareLink = `${window.location.origin}/student/spaces?clone=${spaceId?.replace('space-', '') || 's1'}`;
                      navigator.clipboard.writeText(shareLink);
                      setIsCopied(true);
                      setTimeout(() => setIsCopied(false), 2000);
                    }}
                    className={`px-4 py-2 rounded-lg font-sans text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
                      isCopied 
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
                  onClick={() => {
                    setSpaceIsPublic(false);
                    updateSpaceVisibilityInStore(false);
                    // Trigger visibility toast
                    setShowVisibilityToast(true);
                    setTimeout(() => setShowVisibilityToast(false), 2500);
                    setIsShareModalOpen(false);
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
