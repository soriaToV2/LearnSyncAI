import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, Plus, Layers, ChevronLeft, RefreshCw, Play, Trash2, BookOpen, Globe, Lock, Loader2, Pencil, X } from 'lucide-react';
import FlashcardStudyView from '../components/FlashcardStudyView';
import CreateFlashcardsModal from '../components/CreateFlashcardsModal';
import Modal from '../../../components/ui/Modal';
import { api } from '../../../lib/api';

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

interface FlashcardsTabProps {
  spaceId: string;
  readOnly: boolean;
  courseConnected: boolean;
  isGenerating: boolean;
  selectedSetContent: string | null;
  flashcardSets: FlashcardSet[];
  setSelectedSetContent: (id: string | null) => void;
  setIsCreateDeckModalOpen: (isOpen: boolean) => void;
  setActiveTab: (tab: 'flashcards' | 'free-recall' | 'feynman' | 'adaptive-test' | 'resources') => void;
  onRefresh: () => void;
  spaceIsPublic: boolean;
  onToggleDeckVisibility: (deckId: string) => void;
  availableResources: string[];
}

export default function FlashcardsTab({
  spaceId,
  readOnly,
  courseConnected,
  isGenerating,
  selectedSetContent,
  flashcardSets,
  setSelectedSetContent,
  setIsCreateDeckModalOpen,
  setActiveTab,
  onRefresh,
  spaceIsPublic,
  onToggleDeckVisibility,
  availableResources,
}: FlashcardsTabProps) {
  const [isStudying, setIsStudying] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [flippedCardId, setFlippedCardId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Deck Edit State
  const [isEditDeckModalOpen, setIsEditDeckModalOpen] = useState(false);
  const [deckEditTitle, setDeckEditTitle] = useState('');
  const [deckEditDesc, setDeckEditDesc] = useState('');

  // Deck Delete Confirmation State
  const [isDeleteDeckConfirmOpen, setIsDeleteDeckConfirmOpen] = useState(false);

  // Single Card Create State
  const [isAddCardModalOpen, setIsAddCardModalOpen] = useState(false);
  const [newCardFront, setNewCardFront] = useState('');
  const [newCardBack, setNewCardBack] = useState('');

  // Single Card Edit State
  const [isEditCardModalOpen, setIsEditCardModalOpen] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editCardFront, setEditCardFront] = useState('');
  const [editCardBack, setEditCardBack] = useState('');

  // Single Card Delete Confirmation State
  const [isDeleteCardConfirmOpen, setIsDeleteCardConfirmOpen] = useState(false);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);

  const toggleFlip = (cardId: string) => {
    setFlippedCardId(prev => (prev === cardId ? null : cardId));
  };

  const selectedSet = flashcardSets.find(s => s.id === selectedSetContent) || null;

  const handleSaveCards = async (data: { title: string; description: string; cards: { front: string; back: string }[] }) => {
    if (readOnly) return;
    setIsSaving(true);
    try {
      if (editingSetId !== null) {
        // Edit Deck Info
        await api.put(`/spaces/${spaceId}/decks/${editingSetId}`, {
          title: data.title,
          description: data.description
        });
        // Bulk Sync Flashcards
        await api.post(`/spaces/${spaceId}/decks/${editingSetId}/flashcards/bulk`, {
          cards: data.cards
        });
      } else {
        // Create new deck
        const resDeck = await api.post<any>(`/spaces/${spaceId}/decks`, {
          title: data.title,
          description: data.description
        });
        if (resDeck.data && resDeck.data.id) {
          await api.post(`/spaces/${spaceId}/decks/${resDeck.data.id}/flashcards/bulk`, {
            cards: data.cards
          });
        }
      }
      onRefresh();
      setIsCreateModalOpen(false);
      setEditingSetId(null);
    } catch (err) {
      console.error('Failed to save flashcards', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateDeckDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSet || readOnly || !deckEditTitle.trim()) return;
    setIsSaving(true);
    try {
      await api.put(`/spaces/${spaceId}/decks/${selectedSet.id}`, {
        title: deckEditTitle.trim(),
        description: deckEditDesc.trim()
      });
      setIsEditDeckModalOpen(false);
      onRefresh();
    } catch (err) {
      console.error('Failed to update deck details', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteDeck = (deckId: string) => {
    if (readOnly) return;
    setIsDeleteDeckConfirmOpen(true);
  };

  const handleDeleteDeckConfirmed = async () => {
    if (readOnly || !selectedSet) return;
    setIsSaving(true);
    try {
      await api.delete(`/spaces/${spaceId}/decks/${selectedSet.id}`);
      setSelectedSetContent(null);
      setIsDeleteDeckConfirmOpen(false);
      onRefresh();
    } catch (err) {
      console.error('Failed to delete deck', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateSingleCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSet || readOnly || !newCardFront.trim() || !newCardBack.trim()) return;
    setIsSaving(true);
    try {
      await api.post(`/spaces/${spaceId}/decks/${selectedSet.id}/flashcards`, {
        term: newCardFront.trim(),
        definition: newCardBack.trim()
      });
      setIsAddCardModalOpen(false);
      setNewCardFront('');
      setNewCardBack('');
      onRefresh();
    } catch (err) {
      console.error('Failed to create flashcard', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateSingleCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSet || readOnly || !editingCardId || !editCardFront.trim() || !editCardBack.trim()) return;
    setIsSaving(true);
    try {
      await api.put(`/spaces/${spaceId}/decks/${selectedSet.id}/flashcards/${editingCardId}`, {
        term: editCardFront.trim(),
        definition: editCardBack.trim()
      });
      setIsEditCardModalOpen(false);
      setEditingCardId(null);
      setEditCardFront('');
      setEditCardBack('');
      onRefresh();
    } catch (err) {
      console.error('Failed to update flashcard', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCard = (cardId: string) => {
    if (readOnly || !selectedSet) return;
    setDeletingCardId(cardId);
    setIsDeleteCardConfirmOpen(true);
  };

  const handleDeleteCardConfirmed = async () => {
    if (!selectedSet || readOnly || !deletingCardId) return;
    setIsSaving(true);
    try {
      await api.delete(`/spaces/${spaceId}/decks/${selectedSet.id}/flashcards/${deletingCardId}`);
      setIsDeleteCardConfirmOpen(false);
      setDeletingCardId(null);
      onRefresh();
    } catch (err) {
      console.error('Failed to delete card', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenCreateModal = (setId?: string) => {
    if (readOnly) return;
    if (setId) {
      setEditingSetId(setId);
    } else {
      setEditingSetId(null);
    }
    setIsCreateModalOpen(true);
  };

  // Render study view if active
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
      {/* Deck list */}
      {selectedSetContent === null ? (
        <div key="deck-list" className="animate-in fade-in duration-500">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <div>
              <h2 className="font-display text-2xl font-semibold text-white mb-1">Study Decks</h2>
              <p className="font-sans text-sm text-slate-400">Organize your flashcards into decks</p>
            </div>
            {!readOnly && (
              <div className="flex flex-wrap gap-3">
                <button 
                  onClick={() => setIsCreateDeckModalOpen(true)}
                  className="px-5 py-2.5 bg-surface-container border border-white/10 text-on-surface hover:bg-surface-container-high rounded-xl font-sans text-xs uppercase tracking-widest font-semibold flex items-center gap-2 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  New Deck
                </button>
              </div>
            )}
          </div>

          {!readOnly && !courseConnected && flashcardSets.length === 0 && (
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

          {flashcardSets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center bg-surface-container-lowest/10 border border-white/5 rounded-2xl">
              <BookOpen className="w-10 h-10 text-slate-600 mb-4" />
              <h3 className="font-display text-lg font-medium text-white mb-2">No Decks Yet</h3>
              <p className="font-sans text-sm text-slate-400 max-w-sm">
                {readOnly ? 'This study space does not contain any flashcard decks.' : 'Create a flashcard deck to start studying.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {flashcardSets.map(set => (
                <div
                  key={set.id}
                  onClick={() => setSelectedSetContent(set.id)}
                  className="bg-surface-container-lowest rounded-2xl border border-white/5 p-6 hover:-translate-y-1 transition-all duration-300 group hover:border-primary-fixed-dim/30 hover:shadow-lg hover:shadow-primary-fixed-dim/5 flex flex-col cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-6">
                    <div
                      className="w-12 h-12 rounded-xl bg-surface-container border border-white/5 flex items-center justify-center group-hover:bg-primary-fixed-dim/20 group-hover:border-primary-fixed-dim/30 transition-colors"
                    >
                      <Layers className="w-6 h-6 text-slate-400 group-hover:text-primary-fixed-dim transition-colors" />
                    </div>
 
                    {!readOnly && (
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
                    )}
                  </div>
 
                  <div className="flex-1">
                    <h3 className="font-display text-xl font-medium text-white mb-2 group-hover:text-primary-fixed-dim transition-colors">{set.title}</h3>
                    {set.description && (
                      <p className="font-sans text-xs text-slate-500 mb-2 line-clamp-2">{set.description}</p>
                    )}
                    <p className="font-sans text-sm text-slate-400">{set.cardCount} Cards</p>
                  </div>

                  {!readOnly && !spaceIsPublic && (
                    <p className="font-sans text-[10px] text-slate-600 mt-3 flex items-center gap-1">
                      <Lock className="w-3 h-3" /> Publicize the space first to share individual decks
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Selected deck view */
        <div key="selected-deck" className="animate-in fade-in duration-500">
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
              {!readOnly && selectedSet && (
                <>
                  <button
                    onClick={() => {
                      setDeckEditTitle(selectedSet.title);
                      setDeckEditDesc(selectedSet.description || '');
                      setIsEditDeckModalOpen(true);
                    }}
                    className="px-5 py-2.5 bg-surface-container border border-white/10 text-on-surface hover:bg-surface-container-high rounded-xl font-sans text-xs uppercase tracking-widest font-semibold flex items-center gap-2 transition-all"
                  >
                    <Pencil className="w-4 h-4" />
                    Edit Deck
                  </button>
                  <button
                    onClick={() => handleDeleteDeck(selectedSet.id)}
                    className="px-5 py-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 rounded-xl font-sans text-xs uppercase tracking-widest font-semibold flex items-center gap-2 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Deck
                  </button>
                </>
              )}
              {selectedSet && selectedSet.cards.length > 0 && (
                <button
                  onClick={() => setIsStudying(true)}
                  className="px-5 py-2.5 bg-gradient-to-r from-primary-fixed-dim to-primary text-on-primary-fixed rounded-xl font-sans text-xs uppercase tracking-widest font-semibold flex items-center gap-2 shadow-[0_0_20px_rgba(0,218,243,0.2)] hover:shadow-[0_0_30px_rgba(0,218,243,0.35)] transition-all hover:scale-[1.02]"
                >
                  <Play className="w-4 h-4" />
                  Study Cards
                </button>
              )}
            </div>
          </div>

          {/* Empty state */}
          {selectedSet && selectedSet.cards.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-20 h-20 rounded-2xl bg-surface-container border border-white/5 flex items-center justify-center mb-6">
                <BookOpen className="w-10 h-10 text-slate-600" />
              </div>
              <h3 className="font-display text-xl font-medium text-white mb-2">No Cards Yet</h3>
              <p className="font-sans text-sm text-slate-400 mb-6 max-w-sm">
                This deck is empty. Add flashcards to start studying.
              </p>
              {!readOnly && (
                <div className="flex gap-4">
                  <button
                    onClick={() => setIsAddCardModalOpen(true)}
                    className="px-6 py-3 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add Flashcard
                  </button>
                  <button
                    onClick={() => handleOpenCreateModal(selectedSet.id)}
                    className="px-6 py-3 bg-surface-container border border-white/10 text-on-surface rounded-xl font-sans text-sm font-bold hover:bg-surface-container-high transition-all flex items-center gap-2"
                  >
                    <Layers className="w-4 h-4" />
                    Bulk Manage
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Card grid */}
          {selectedSet && selectedSet.cards.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Add card tile */}
                {!readOnly && (
                  <>
                    <div
                      onClick={() => setIsAddCardModalOpen(true)}
                      className="h-64 rounded-2xl border border-white/10 bg-surface-container hover:border-primary-fixed-dim/30 hover:bg-primary-fixed-dim/5 transition-all cursor-pointer flex flex-col justify-center items-center text-center p-6"
                    >
                      <div className="w-12 h-12 rounded-full bg-primary-fixed-dim/10 flex items-center justify-center mb-4">
                        <Plus className="w-6 h-6 text-primary-fixed-dim" />
                      </div>
                      <h3 className="font-display font-medium text-white mb-1">Add Single Card</h3>
                      <p className="font-sans text-xs text-slate-400">Add a single new card to this deck.</p>
                    </div>
                    
                    <div
                      onClick={() => handleOpenCreateModal(selectedSet.id)}
                      className="h-64 rounded-2xl border border-white/10 bg-surface-container hover:border-primary-fixed-dim/30 hover:bg-primary-fixed-dim/5 transition-all cursor-pointer flex flex-col justify-center items-center text-center p-6"
                    >
                      <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center mb-4">
                        <Layers className="w-6 h-6 text-slate-400" />
                      </div>
                      <h3 className="font-display font-medium text-white mb-1">Bulk Manage Decks</h3>
                      <p className="font-sans text-xs text-slate-400">Bulk edit or import cards in this set.</p>
                    </div>
                  </>
                )}
              {selectedSet.cards.map((card) => (
                <div key={card.id} className="group relative h-64 [perspective:1000px]">
                  {/* Delete / Edit card controls */}
                  {!readOnly && (
                    <div className="absolute top-3.5 right-3.5 z-10 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingCardId(card.id);
                          setEditCardFront(card.front);
                          setEditCardBack(card.back);
                          setIsEditCardModalOpen(true);
                        }}
                        className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all"
                        title="Edit Card"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteCard(card.id);
                        }}
                        className="p-1.5 rounded-lg bg-rose-500/5 border border-rose-500/10 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 hover:border-rose-500/20 transition-all"
                        title="Delete Card"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

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
        </div>
      )}

      {/* Saving indicator overlay */}
      {isSaving && createPortal(
        <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-md flex items-center justify-center">
          <div className="bg-surface-container border border-white/10 px-6 py-4 rounded-xl flex items-center gap-3 text-white">
            <Loader2 className="w-5 h-5 animate-spin text-primary-fixed-dim" />
            <span className="font-sans text-sm font-semibold">Saving changes...</span>
          </div>
        </div>,
        document.body
      )}

      {/* Create/Edit modal */}
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

      {/* Edit Deck Details Modal */}
      <Modal
        isOpen={isEditDeckModalOpen}
        onClose={() => setIsEditDeckModalOpen(false)}
        title="Edit Deck Details"
      >
        <form onSubmit={handleUpdateDeckDetails}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Deck Title
              </label>
              <input
                type="text"
                value={deckEditTitle}
                onChange={(e) => setDeckEditTitle(e.target.value)}
                placeholder="e.g. Chapter 4 Key Concepts"
                className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                Description
              </label>
              <textarea
                value={deckEditDesc}
                onChange={(e) => setDeckEditDesc(e.target.value)}
                placeholder="Brief description of deck..."
                rows={3}
                className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 resize-none font-sans text-sm"
              />
            </div>
          </div>

          <div className="mt-8 flex gap-3">
            <button
              type="button"
              onClick={() => setIsEditDeckModalOpen(false)}
              className="flex-1 px-4 py-3 rounded-xl border border-white/10 text-white font-medium hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!deckEditTitle.trim()}
              className="flex-1 px-4 py-3 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-medium hover:bg-primary-fixed transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save Changes
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Deck Confirmation Modal */}
      <Modal
        isOpen={isDeleteDeckConfirmOpen}
        onClose={() => setIsDeleteDeckConfirmOpen(false)}
        title="Delete Flashcard Deck?"
        maxWidth="max-w-sm"
      >
        <div className="space-y-6 text-center">
          <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto shadow-inner animate-in fade-in duration-300">
            <Trash2 className="w-5 h-5" />
          </div>
          
          <div className="space-y-2">
            <p className="font-sans text-xs text-slate-400 leading-relaxed">
              Are you sure you want to delete <span className="font-semibold text-white">"{selectedSet?.title}"</span>? This will delete all cards inside. This action cannot be undone.
            </p>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={() => setIsDeleteDeckConfirmOpen(false)}
              className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 font-sans text-xs font-bold uppercase tracking-wider transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeleteDeckConfirmed}
              className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-sans text-xs font-bold uppercase tracking-wider transition-all shadow-lg shadow-red-600/20"
            >
              Delete
            </button>
          </div>
        </div>
      </Modal>

      {/* Add Single Card Modal */}
      <Modal
        isOpen={isAddCardModalOpen}
        onClose={() => setIsAddCardModalOpen(false)}
        title="Add New Flashcard"
      >
        <form onSubmit={handleCreateSingleCard} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-widest text-slate-400 font-bold mb-1.5 font-sans">
              Front (Question / Term)
            </label>
            <textarea
              value={newCardFront}
              onChange={(e) => setNewCardFront(e.target.value)}
              placeholder="Enter front content..."
              rows={3}
              className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 resize-none font-sans text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-widest text-slate-400 font-bold mb-1.5 font-sans">
              Back (Answer / Definition)
            </label>
            <textarea
              value={newCardBack}
              onChange={(e) => setNewCardBack(e.target.value)}
              placeholder="Enter back content..."
              rows={3}
              className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 resize-none font-sans text-sm"
              required
            />
          </div>

          <div className="mt-8 flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsAddCardModalOpen(false)}
              className="flex-1 px-4 py-3 rounded-xl border border-white/10 text-white font-medium hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!newCardFront.trim() || !newCardBack.trim()}
              className="flex-1 px-4 py-3 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-medium hover:bg-primary-fixed transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Card
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Single Card Modal */}
      <Modal
        isOpen={isEditCardModalOpen}
        onClose={() => setIsEditCardModalOpen(false)}
        title="Edit Flashcard"
      >
        <form onSubmit={handleUpdateSingleCard} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-widest text-slate-400 font-bold mb-1.5 font-sans">
              Front (Question / Term)
            </label>
            <textarea
              value={editCardFront}
              onChange={(e) => setEditCardFront(e.target.value)}
              placeholder="Enter front content..."
              rows={3}
              className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 resize-none font-sans text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-widest text-slate-400 font-bold mb-1.5 font-sans">
              Back (Answer / Definition)
            </label>
            <textarea
              value={editCardBack}
              onChange={(e) => setEditCardBack(e.target.value)}
              placeholder="Enter back content..."
              rows={3}
              className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 resize-none font-sans text-sm"
              required
            />
          </div>

          <div className="mt-8 flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsEditCardModalOpen(false)}
              className="flex-1 px-4 py-3 rounded-xl border border-white/10 text-white font-medium hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!editCardFront.trim() || !editCardBack.trim()}
              className="flex-1 px-4 py-3 rounded-xl bg-primary-fixed-dim text-on-primary-fixed font-medium hover:bg-primary-fixed transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save Changes
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Card Confirmation Modal */}
      <Modal
        isOpen={isDeleteCardConfirmOpen}
        onClose={() => {
          setIsDeleteCardConfirmOpen(false);
          setDeletingCardId(null);
        }}
        title="Delete Flashcard?"
        maxWidth="max-w-sm"
      >
        <div className="space-y-6 text-center">
          <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto shadow-inner animate-in fade-in duration-300">
            <Trash2 className="w-5 h-5" />
          </div>
          
          <div className="space-y-2">
            <p className="font-sans text-xs text-slate-400 leading-relaxed">
              Are you sure you want to delete this flashcard? This action cannot be undone.
            </p>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={() => {
                setIsDeleteCardConfirmOpen(false);
                setDeletingCardId(null);
              }}
              className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 font-sans text-xs font-bold uppercase tracking-wider transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeleteCardConfirmed}
              className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-sans text-xs font-bold uppercase tracking-wider transition-all shadow-lg shadow-red-600/20"
            >
              Delete
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
