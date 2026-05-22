import React, { useState } from 'react';
import { Sparkles, Plus, Layers, ChevronLeft, RefreshCw, Play, Edit3, Trash2, BookOpen, ClipboardList, Globe, Lock } from 'lucide-react';
import FlashcardStudyView from './FlashcardStudyView';
import CreateFlashcardsModal from './CreateFlashcardsModal';
import QuizSetupModal, { type QuizConfig } from './QuizSetupModal';
import QuizView from './QuizView';


interface Flashcard {
  id: number;
  front: string;
  back: string;
}

interface FlashcardSet {
  id: number;
  title: string;
  description?: string;
  cardCount: number;
  cards: Flashcard[];
  isPublic: boolean;
}

interface FlashcardsTabProps {
  courseConnected: boolean;
  isGenerating: boolean;
  selectedSetContent: number | null;
  flashcardSets: FlashcardSet[];
  setSelectedSetContent: (id: number | null) => void;
  setIsCreateDeckModalOpen: (isOpen: boolean) => void;
  setActiveTab: (tab: 'flashcards' | 'resources') => void;
  setFlashcardSets: React.Dispatch<React.SetStateAction<FlashcardSet[]>>;
  availableResources?: string[];
  spaceIsPublic: boolean;
  onToggleDeckVisibility: (deckId: number) => void;
}

export default function FlashcardsTab({
  courseConnected,
  isGenerating,
  selectedSetContent,
  flashcardSets,
  setSelectedSetContent,
  setIsCreateDeckModalOpen,
  setActiveTab,
  setFlashcardSets,
  availableResources = [],
  spaceIsPublic,
  onToggleDeckVisibility,
}: FlashcardsTabProps) {
  const [isStudying, setIsStudying] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingSetId, setEditingSetId] = useState<number | null>(null);
  const [flippedCardId, setFlippedCardId] = useState<number | null>(null);
  const [isQuizSetupOpen, setIsQuizSetupOpen] = useState(false);
  const [activeQuizConfig, setActiveQuizConfig] = useState<QuizConfig | null>(null);

  const toggleFlip = (cardId: number) => {
    setFlippedCardId(prev => (prev === cardId ? null : cardId));
  };

  const handleStartQuiz = (config: QuizConfig) => {
    setActiveQuizConfig(config);
    setIsQuizSetupOpen(false);
  };

  const handleExitQuiz = () => {
    setActiveQuizConfig(null);
  };

  const selectedSet = flashcardSets.find(s => s.id === selectedSetContent) || null;

  const handleSaveCards = (data: { title: string; description: string; cards: { front: string; back: string }[] }) => {
    if (editingSetId !== null) {
      // Edit existing set
      setFlashcardSets(prev =>
        prev.map(set => {
          if (set.id !== editingSetId) return set;
          return {
            ...set,
            title: data.title,
            description: data.description,
            cardCount: data.cards.length,
            cards: data.cards.map((c, i) => ({
              id: set.cards[i]?.id ?? Date.now() + i,
              front: c.front,
              back: c.back,
            })),
          };
        })
      );
      setEditingSetId(null);
    } else {
      // Create new set with cards
      const newId = Date.now();
      setFlashcardSets(prev => [
        ...prev,
        {
          id: newId,
          title: data.title,
          description: data.description,
          cardCount: data.cards.length,
          cards: data.cards.map((c, i) => ({
            id: Date.now() + i + 1,
            front: c.front,
            back: c.back,
          })),
          isPublic: false,
        },
      ]);
    }
  };

  const handleDeleteCard = (cardId: number) => {
    if (!selectedSet) return;
    setFlashcardSets(prev =>
      prev.map(set => {
        if (set.id !== selectedSet.id) return set;
        const updatedCards = set.cards.filter(c => c.id !== cardId);
        return { ...set, cards: updatedCards, cardCount: updatedCards.length };
      })
    );
  };

  const handleOpenCreateModal = (setId?: number) => {
    if (setId) {
      setEditingSetId(setId);
    } else {
      setEditingSetId(null);
    }
    setIsCreateModalOpen(true);
  };

  // Quiz mode
  if (activeQuizConfig) {
    return (
      <div className="animate-in fade-in duration-300">
        <QuizView
          config={activeQuizConfig}
          flashcardSets={flashcardSets}
          onExit={handleExitQuiz}
        />
      </div>
    );
  }

  // If in study mode, show the study view
  if (isStudying && selectedSet && selectedSet.cards.length > 0) {
    return (
      <div className="animate-in fade-in duration-300">
        <FlashcardStudyView
          cards={selectedSet.cards}
          deckTitle={selectedSet.title}
          onExit={() => setIsStudying(false)}
        />
      </div>
    );
  }

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
                className="bg-surface-container-lowest rounded-2xl border border-white/5 p-6 hover:-translate-y-1 transition-all duration-300 group hover:border-primary-fixed-dim/30 hover:shadow-lg hover:shadow-primary-fixed-dim/5 flex flex-col"
              >
                {/* Deck icon + visibility badge row */}
                <div className="flex items-start justify-between mb-6">
                  <div
                    onClick={() => setSelectedSetContent(set.id)}
                    className="w-12 h-12 rounded-xl bg-surface-container border border-white/5 flex items-center justify-center group-hover:bg-primary-fixed-dim/20 group-hover:border-primary-fixed-dim/30 transition-colors cursor-pointer"
                  >
                    <Layers className="w-6 h-6 text-slate-400 group-hover:text-primary-fixed-dim transition-colors" />
                  </div>

                  {/* Per-deck visibility toggle */}
                  <button
                    onClick={e => { e.stopPropagation(); onToggleDeckVisibility(set.id); }}
                    title={set.isPublic ? 'Click to make this deck private' : 'Click to share this deck publicly'}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border font-sans text-[10px] font-bold uppercase tracking-wider transition-all active:scale-95 ${
                      set.isPublic
                        ? 'bg-emerald-400/10 border-emerald-400/20 text-emerald-400 hover:bg-emerald-400/20'
                        : 'bg-white/5 border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-300'
                    } ${!spaceIsPublic ? 'opacity-40 cursor-not-allowed' : ''}`}
                    disabled={!spaceIsPublic}
                  >
                    {set.isPublic
                      ? <><Globe className="w-3 h-3" /> Public</>
                      : <><Lock className="w-3 h-3" /> Private</>}
                  </button>
                </div>

                <div onClick={() => setSelectedSetContent(set.id)} className="flex-1 cursor-pointer">
                  <h3 className="font-display text-xl font-medium text-white mb-2 group-hover:text-primary-fixed-dim transition-colors">{set.title}</h3>
                  {set.description && (
                    <p className="font-sans text-xs text-slate-500 mb-2 line-clamp-2">{set.description}</p>
                  )}
                  <p className="font-sans text-sm text-slate-400">{set.cardCount} Cards</p>
                </div>

                {/* Disabled hint when space is private */}
                {!spaceIsPublic && (
                  <p className="font-sans text-[10px] text-slate-600 mt-3 flex items-center gap-1">
                    <Lock className="w-3 h-3" /> Publicize the space first to share individual decks
                  </p>
                )}
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
                {selectedSet?.title}
              </h2>
              {selectedSet?.description && (
                <p className="font-sans text-sm text-slate-400">{selectedSet.description}</p>
              )}
              {!selectedSet?.description && (
                <p className="font-sans text-sm text-slate-400">Review your cards and start studying</p>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              {/* Study Button */}
              {selectedSet && selectedSet.cards.length > 0 && (
                <button
                  onClick={() => setIsStudying(true)}
                  className="px-5 py-2.5 bg-gradient-to-r from-primary-fixed-dim to-primary text-on-primary-fixed rounded-xl font-sans text-xs uppercase tracking-widest font-semibold flex items-center gap-2 shadow-[0_0_20px_rgba(0,218,243,0.2)] hover:shadow-[0_0_30px_rgba(0,218,243,0.35)] transition-all hover:scale-[1.02]"
                >
                  <Play className="w-4 h-4" />
                  Study Cards
                </button>
              )}
              <button
                onClick={() => setIsQuizSetupOpen(true)}
                className="px-5 py-2.5 bg-surface-container border border-secondary-fixed-dim/40 text-secondary-fixed-dim hover:bg-surface-container-high rounded-xl font-sans text-xs uppercase tracking-widest font-semibold flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(195,192,255,0.08)] hover:shadow-[0_0_20px_rgba(195,192,255,0.15)]"
              >
                <ClipboardList className="w-4 h-4" />
                Take a Quiz
              </button>

            </div>
          </div>

          {/* Cards Empty State */}
          {selectedSet && selectedSet.cards.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-20 h-20 rounded-2xl bg-surface-container border border-white/5 flex items-center justify-center mb-6">
                <BookOpen className="w-10 h-10 text-slate-600" />
              </div>
              <h3 className="font-display text-xl font-medium text-white mb-2">No Cards Yet</h3>
              <p className="font-sans text-sm text-slate-400 mb-6 max-w-sm">
                This deck is empty. Add flashcards to start studying.
              </p>
              <button
                onClick={() => handleOpenCreateModal(selectedSet.id)}
                className="px-6 py-3 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Flashcards
              </button>
            </div>
          )}

          {/* Cards Grid */}
          {selectedSet && selectedSet.cards.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Empty state card for adding new */}
                <div
                  onClick={() => handleOpenCreateModal(selectedSet.id)}
                  className="h-64 rounded-2xl border-2 border-dashed border-white/10 bg-surface-container-lowest/30 flex flex-col justify-center items-center text-center hover:border-primary-fixed-dim/30 hover:bg-primary-fixed-dim/5 transition-all cursor-pointer"
                >
                  <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center mb-4">
                    <Plus className="w-6 h-6 text-slate-400" />
                  </div>
                  <h3 className="font-display font-medium text-white mb-1">Add / Edit Cards</h3>
                  <p className="font-sans text-xs text-slate-400">Manage the flashcards in this set.</p>
                </div>
              {selectedSet.cards.map((card) => (
                <div key={card.id} className="group relative h-64 [perspective:1000px]">
                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteCard(card.id);
                    }}
                    className="absolute -top-2 -right-2 z-10 p-1.5 bg-surface-container-high border border-white/10 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-400/10 hover:border-red-400/30 transition-all opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>

                  <div 
                    onClick={() => toggleFlip(card.id)}
                    className={`relative w-full h-full transition-transform duration-500 [transform-style:preserve-3d] ${flippedCardId === card.id ? '[transform:rotateY(180deg)]' : ''} cursor-pointer`}
                  >
                    {/* Front */}
                    <div className="absolute inset-0 [backface-visibility:hidden] rounded-2xl border border-white/10 bg-surface-container p-6 flex flex-col justify-center items-center text-center shadow-lg">
                      <p className="font-display text-xl text-on-surface mb-4">{card.front}</p>
                      <span className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center gap-1 mt-auto font-semibold">
                        <RefreshCw className="w-3 h-3" /> Click to Flip
                      </span>
                    </div>
                    {/* Back */}
                    <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-2xl border border-primary-fixed-dim/30 bg-primary-fixed-dim/5 p-6 flex flex-col justify-center items-center text-center shadow-[0_0_30px_rgba(0,218,243,0.1)]">
                      <p className="font-sans text-base text-primary-fixed-dim font-medium">{card.back}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {/* Create / Edit Flashcards Modal */}
      <CreateFlashcardsModal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setEditingSetId(null);
        }}
        onSave={handleSaveCards}
        initialData={
          editingSetId
            ? (() => {
                const s = flashcardSets.find(s => s.id === editingSetId);
                return s
                  ? { title: s.title, description: s.description || '', cards: s.cards }
                  : null;
              })()
            : null
        }
        courseConnected={courseConnected}
        availableResources={availableResources}
      />

      {/* Quiz Setup Modal */}
      <QuizSetupModal
        isOpen={isQuizSetupOpen}
        onClose={() => setIsQuizSetupOpen(false)}
        onStart={handleStartQuiz}
        preselectedSetId={selectedSetContent}
        flashcardSets={flashcardSets.map(s => ({ id: s.id, title: s.title, cardCount: s.cardCount }))}
        availableResources={availableResources}
        courseConnected={courseConnected}
      />
    </div>
  );
}
