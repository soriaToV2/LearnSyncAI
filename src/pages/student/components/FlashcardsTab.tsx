import React from 'react';
import { Sparkles, Plus, Layers, ChevronLeft, RefreshCw } from 'lucide-react';

interface Flashcard {
  id: number;
  front: string;
  back: string;
}

interface FlashcardSet {
  id: number;
  title: string;
  cardCount: number;
  cards: Flashcard[];
}

interface FlashcardsTabProps {
  courseConnected: boolean;
  isGenerating: boolean;
  selectedSetContent: number | null;
  flashcardSets: FlashcardSet[];
  setSelectedSetContent: (id: number | null) => void;
  setIsCreateDeckModalOpen: (isOpen: boolean) => void;
  setActiveTab: (tab: 'flashcards' | 'resources') => void;
  handleGenerateFlashcards: () => void;
}

export default function FlashcardsTab({
  courseConnected,
  isGenerating,
  selectedSetContent,
  flashcardSets,
  setSelectedSetContent,
  setIsCreateDeckModalOpen,
  setActiveTab,
  handleGenerateFlashcards
}: FlashcardsTabProps) {
  return (
    <div className="animate-in fade-in duration-300">
      {/* Show Flashcard Sets */}
      {selectedSetContent === null ? (
        <>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <div>
              <h2 className="font-display text-2xl font-semibold text-white mb-1">Study Decks</h2>
              <p className="font-sans text-sm text-slate-400">Organize your flashcards into decks</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button 
                onClick={() => setIsCreateDeckModalOpen(true)}
                className="px-5 py-2.5 bg-surface-container border border-white/10 text-on-surface hover:bg-surface-container-high rounded-xl font-sans text-xs uppercase tracking-widest font-semibold flex items-center gap-2 transition-all"
              >
                <Plus className="w-4 h-4" />
                New Deck
              </button>
            </div>
          </div>

          {!courseConnected && flashcardSets.length <= 2 && (
            <div className="bg-surface-container-lowest border border-white/5 rounded-xl p-6 mb-8 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-primary-fixed-dim/10 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-primary-fixed-dim" />
                </div>
                <div>
                  <h3 className="font-display font-medium text-white">Generate from Course Material</h3>
                  <p className="font-sans text-sm text-slate-400">Connect this space to a course to unlock one-click AI flashcard generation.</p>
                </div>
              </div>
              <button 
                onClick={() => setActiveTab('resources')}
                className="px-4 py-2 bg-primary-fixed-dim/20 text-primary-fixed rounded-lg text-sm font-semibold hover:bg-primary-fixed-dim hover:text-on-primary-fixed transition-colors"
              >
                Go to Resources
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {flashcardSets.map(set => (
              <div 
                key={set.id}
                onClick={() => setSelectedSetContent(set.id)}
                className="bg-surface-container-lowest rounded-2xl border border-white/5 p-6 cursor-pointer hover:-translate-y-1 transition-all duration-300 group hover:border-primary-fixed-dim/30 hover:shadow-lg hover:shadow-primary-fixed-dim/5"
              >
                <div className="w-12 h-12 rounded-xl bg-surface-container border border-white/5 flex items-center justify-center mb-6 group-hover:bg-primary-fixed-dim/20 group-hover:border-primary-fixed-dim/30 transition-colors">
                  <Layers className="w-6 h-6 text-slate-400 group-hover:text-primary-fixed-dim transition-colors" />
                </div>
                <h3 className="font-display text-xl font-medium text-white mb-2 group-hover:text-primary-fixed-dim transition-colors">{set.title}</h3>
                <p className="font-sans text-sm text-slate-400">{set.cardCount} Cards</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        /* Show Flashcards in Selected Deck */
        <>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <div>
              <button 
                onClick={() => setSelectedSetContent(null)}
                className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 mb-2 font-sans font-semibold text-sm uppercase tracking-widest"
              >
                <ChevronLeft className="w-4 h-4" /> Back to Decks
              </button>
              <h2 className="font-display text-2xl font-semibold text-white mb-1">
                {flashcardSets.find(s => s.id === selectedSetContent)?.title}
              </h2>
              <p className="font-sans text-sm text-slate-400">Review your AI-generated cards and custom notes</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button 
                disabled={!courseConnected || isGenerating}
                onClick={handleGenerateFlashcards}
                className="px-5 py-2.5 bg-surface-container border border-primary-fixed-dim/30 text-primary-fixed hover:bg-surface-container-high rounded-xl font-sans text-xs uppercase tracking-widest font-semibold flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(0,218,243,0.1)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles className="w-4 h-4 text-amber-400" />
                {isGenerating ? 'Generating...' : 'Auto-Generate (AI)'}
              </button>
              <button className="px-5 py-2.5 bg-surface-container border border-white/10 text-on-surface hover:bg-surface-container-high rounded-xl font-sans text-xs uppercase tracking-widest font-semibold flex items-center gap-2 transition-all">
                <Plus className="w-4 h-4" />
                Add Manual Card
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {flashcardSets.find(s => s.id === selectedSetContent)?.cards.map((card) => (
              <div key={card.id} className="group h-64 [perspective:1000px] cursor-pointer">
                <div className="relative w-full h-full transition-transform duration-500 [transform-style:preserve-3d] group-hover:[transform:rotateY(180deg)]">
                  {/* Front */}
                  <div className="absolute inset-0 [backface-visibility:hidden] rounded-2xl border border-white/10 bg-surface-container p-6 flex flex-col justify-center items-center text-center shadow-lg">
                    <p className="font-display text-xl text-on-surface mb-4">{card.front}</p>
                    <span className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center gap-1 mt-auto font-semibold">
                      <RefreshCw className="w-3 h-3" /> Hover to Flip
                    </span>
                  </div>
                  {/* Back */}
                  <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-2xl border border-primary-fixed-dim/30 bg-primary-fixed-dim/5 p-6 flex flex-col justify-center items-center text-center shadow-[0_0_30px_rgba(0,218,243,0.1)]">
                    <p className="font-sans text-base text-primary-fixed-dim font-medium">{card.back}</p>
                  </div>
                </div>
              </div>
            ))}
            
            {/* Empty state card for adding new */}
            <div className="h-64 rounded-2xl border-2 border-dashed border-white/10 bg-surface-container-lowest/30 flex flex-col justify-center items-center text-center hover:border-primary-fixed-dim/30 hover:bg-primary-fixed-dim/5 transition-all cursor-pointer">
              <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center mb-4">
                <Plus className="w-6 h-6 text-slate-400" />
              </div>
              <h3 className="font-display font-medium text-white mb-1">Create Flashcard</h3>
              <p className="font-sans text-xs text-slate-400">Add a new front-and-back card manually.</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
