import React, { useState } from 'react';
import { ChevronLeft, Box, X, QrCode, Plus, BookOpen, Layers, Globe, Lock, Eye, EyeOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import Modal from '../../components/ui/Modal';
import FlashcardsTab from './components/FlashcardsTab';
import ResourcesTab from './components/ResourcesTab';
import { createPortal } from 'react-dom';

interface FlashcardSet {
  id: number;
  title: string;
  description?: string;
  cardCount: number;
  cards: { id: number; front: string; back: string }[];
  isPublic: boolean; // ← visibility toggle
}

export default function StudySpace() {
  const [activeTab, setActiveTab] = useState<'flashcards' | 'resources'>('flashcards');
  const [showQR, setShowQR] = useState(false);
  const [courseConnected, setCourseConnected] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedSetContent, setSelectedSetContent] = useState<number | null>(null);
  const [isCreateDeckModalOpen, setIsCreateDeckModalOpen] = useState(false);
  const [newDeckTitle, setNewDeckTitle] = useState('');

  // ── Space-level visibility ───────────────────────────────────────────────
  const [spaceIsPublic, setSpaceIsPublic] = useState(false);
  const [showVisibilityToast, setShowVisibilityToast] = useState(false);

  const availableResources = ['Synaptic_Pathways_Ch4.pdf', 'Lecture_03_Action_Potentials.pptx', 'Study_Guide_Midterm.docx'];

  const [flashcardSets, setFlashcardSets] = useState<FlashcardSet[]>([
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
  ]);

  const handleConnectCourse = () => setCourseConnected(true);

  // ── Toggle whole space visibility ────────────────────────────────────────
  const handleToggleSpaceVisibility = () => {
    const next = !spaceIsPublic;
    setSpaceIsPublic(next);
    // when making private, also make all decks private
    if (!next) setFlashcardSets(prev => prev.map(s => ({ ...s, isPublic: false })));
    triggerToast();
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
    <div className="h-screen w-full flex flex-col bg-background overflow-hidden relative">

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
      <header className="shrink-0 pt-4 px-6 border-b border-white/10 bg-[#020617]/50 backdrop-blur-md flex flex-col z-40">
        <div className="flex items-center justify-between pb-4">
          <div className="flex items-center gap-4">
            <Link to="/student/spaces" className="p-2 -ml-2 text-slate-400 hover:text-white transition-colors rounded-full hover:bg-white/5">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-xl font-medium text-on-surface flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-primary-fixed-dim shadow-[0_0_10px_rgba(0,218,243,0.5)]" />
                Biology 101 Prep Space
              </h1>
              {/* Space visibility badge */}
              <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-sans text-[10px] font-bold uppercase tracking-wider transition-colors ${
                spaceIsPublic
                  ? 'bg-emerald-400/10 border-emerald-400/20 text-emerald-400'
                  : 'bg-white/5 border-white/10 text-slate-500'
              }`}>
                {spaceIsPublic ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                {spaceIsPublic ? 'Public' : 'Private'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* ── Publicize Toggle ── */}
            <button
              onClick={handleToggleSpaceVisibility}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border font-sans text-sm font-semibold transition-all active:scale-95 ${
                spaceIsPublic
                  ? 'bg-emerald-400/10 border-emerald-400/25 text-emerald-400 hover:bg-emerald-400/20'
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              {spaceIsPublic
                ? <><EyeOff className="w-4 h-4" /> Make Private</>
                : <><Globe className="w-4 h-4" /> Publicize Space</>}
            </button>

            <button
              onClick={() => setShowQR(true)}
              className="px-5 py-2.5 bg-gradient-to-r from-primary-container to-primary text-on-primary-container rounded-lg font-sans text-xs uppercase tracking-widest font-semibold flex items-center gap-2 shadow-[0_0_15px_rgba(0,229,255,0.3)] hover:shadow-[0_0_25px_rgba(0,229,255,0.5)] transition-all"
            >
              <Box className="w-4 h-4" />
              Initialize Web-AR Hologram
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-8">
          <button
            onClick={() => setActiveTab('flashcards')}
            className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'flashcards' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
          >
            <Layers className="w-4 h-4" />
            Flashcards &amp; Study
          </button>
          <button
            onClick={() => setActiveTab('resources')}
            className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'resources' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
          >
            <BookOpen className="w-4 h-4" />
            Course Resources
          </button>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1 overflow-y-auto w-full max-w-7xl mx-auto p-8 relative">

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
            setActiveTab={setActiveTab}
            setFlashcardSets={setFlashcardSets}
            availableResources={availableResources}
            spaceIsPublic={spaceIsPublic}
            onToggleDeckVisibility={handleToggleDeckVisibility}
          />
        )}

        {activeTab === 'resources' && (
          <ResourcesTab
            courseConnected={courseConnected}
            selectedDoc={selectedDoc}
            handleConnectCourse={handleConnectCourse}
            setSelectedDoc={setSelectedDoc}
            setActiveTab={setActiveTab}
            setIsGenerating={setIsGenerating}
            setSelectedSetContent={setSelectedSetContent}
            setFlashcardSets={setFlashcardSets}
          />
        )}
      </main>

      {/* AR Modal */}
      {showQR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xl">
          <div className="bg-surface-container-high rounded-3xl border border-primary-fixed-dim/30 p-10 max-w-sm w-full relative shadow-[0_20px_50px_rgba(0,0,0,0.5),0_0_100px_rgba(0,218,243,0.15)] flex flex-col items-center text-center animate-in zoom-in-95 duration-200">
            <button onClick={() => setShowQR(false)} className="absolute top-6 right-6 text-slate-400 hover:text-white transition-colors bg-surface-container p-2 rounded-full">
              <X className="w-5 h-5" />
            </button>
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-fixed-dim/30 to-primary/10 flex items-center justify-center mb-6 border border-primary-fixed-dim/20 shadow-inner">
              <Box className="w-10 h-10 text-primary-fixed-dim drop-shadow-[0_0_10px_rgba(0,218,243,0.8)]" />
            </div>
            <h2 className="font-display text-3xl font-semibold text-on-surface mb-2">AR Web Session</h2>
            <p className="font-sans text-sm text-on-surface-variant mb-8">Scan to beam the 3D model to your mobile device instantly.</p>
            <div className="bg-white p-4 rounded-2xl mb-6 shadow-xl">
              <QrCode className="w-48 h-48 text-slate-900" />
            </div>
            <div className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-widest text-primary-fixed-dim">
              <div className="w-2 h-2 rounded-full bg-primary-fixed-dim animate-ping" />
              Link actively listening
            </div>
          </div>
        </div>
      )}

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
    </div>
  );
}
