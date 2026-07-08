import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, GripVertical, Layers, BookOpen, Sparkles, Bot, AlertCircle, CheckSquare } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import { api } from '../../../lib/api';

interface CardEntry {
  id: number | string;
  front: string;
  back: string;
}

interface Resource {
  id: string;
  title: string;
}

interface CreateFlashcardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { title: string; description: string; cards: { front: string; back: string }[] }) => void;
  initialData?: {
    title: string;
    description: string;
    cards: { id: number | string; front: string; back: string }[];
  } | null;
  availableResources?: Resource[];
}

export default function CreateFlashcardsModal({ isOpen, onClose, onSave, initialData, availableResources }: CreateFlashcardsModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cards, setCards] = useState<CardEntry[]>([]);
  const [showAiConfig, setShowAiConfig] = useState(false);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [frontFormat, setFrontFormat] = useState<'question' | 'term'>('question');
  const cardsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cardsContainerRef.current) {
      const textareas = cardsContainerRef.current.querySelectorAll('textarea');
      textareas.forEach(ta => {
        ta.style.height = 'auto';
        ta.style.height = `${ta.scrollHeight}px`;
      });
    }
  }, [cards]);

  const generateUniqueId = () => {
    return 'card-' + Math.random().toString(36).substring(2, 11) + '-' + Date.now();
  };

  useEffect(() => {
    if (!isOpen) {
      setShowAiConfig(false);
      setSelectedMaterialIds([]);
      setIsGenerating(false);
      setGenerationError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && initialData) {
      setTitle(initialData.title);
      setDescription(initialData.description);
      setCards(
        initialData.cards.length > 0
          ? initialData.cards.map(c => ({ ...c }))
          : [{ id: generateUniqueId(), front: '', back: '' }, { id: generateUniqueId(), front: '', back: '' }]
      );
    } else if (isOpen && !initialData) {
      setTitle('');
      setDescription('');
      setCards([
        { id: generateUniqueId(), front: '', back: '' },
        { id: generateUniqueId(), front: '', back: '' },
      ]);
    }
  }, [isOpen, initialData]);

  const addCard = () => {
    setCards(prev => [...prev, { id: generateUniqueId(), front: '', back: '' }]);
  };

  const handleToggleMaterial = (id: string) => {
    setSelectedMaterialIds(prev =>
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    );
    setGenerationError(null);
  };

  const handleSelectAll = () => {
    if (!availableResources) return;
    if (selectedMaterialIds.length === availableResources.length) {
      setSelectedMaterialIds([]);
    } else {
      setSelectedMaterialIds(availableResources.map(r => r.id));
    }
    setGenerationError(null);
  };

  /**
   * Calls POST /api/materials/generate-flashcards with the selected material IDs.
   * On success, populates the card editor with the generated cards + auto-fills title/description.
   */
  const handleGenerateAI = async () => {
    if (selectedMaterialIds.length === 0 || isGenerating) return;
    setIsGenerating(true);
    setGenerationError(null);

    try {
      const res = await api.post<{ title: string; description: string; cards: { front: string; back: string }[] }>(
        '/materials/generate-flashcards',
        { material_ids: selectedMaterialIds, format: frontFormat }
      );

      const { title: genTitle, description: genDesc, cards: genCards } = res.data;

      // Preserve any manually entered cards that have content, then append generated ones
      setCards(prev => {
        const existing = prev.filter(c => c.front.trim() || c.back.trim());
        const newCards = genCards.map(c => ({
          id: generateUniqueId(),
          front: c.front,
          back: c.back,
        }));
        return [...existing, ...newCards];
      });

      // Auto-fill title and description if the student hasn't typed anything yet
      if (!title.trim()) setTitle(genTitle);
      if (!description.trim()) setDescription(genDesc);

      setShowAiConfig(false);
      setSelectedMaterialIds([]);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        'Generation failed. Please try again.';
      setGenerationError(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const removeCard = (id: string | number) => {
    setCards(prev => prev.filter(c => c.id !== id));
  };

  const updateCard = (id: string | number, field: 'front' | 'back', value: string) => {
    setCards(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const validCards = cards.filter(c => c.front.trim() && c.back.trim());
    onSave({
      title: title.trim(),
      description: description.trim(),
      cards: validCards.map(c => ({ front: c.front.trim(), back: c.back.trim() })),
    });
    onClose();
  };

  const validCardCount = cards.filter(c => c.front.trim() && c.back.trim()).length;
  const isEditing = !!initialData;
  const allSelected = !!availableResources && availableResources.length > 0 && selectedMaterialIds.length === availableResources.length;

  const handleAutoResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    e.target.style.height = 'auto';
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit Flashcard Set' : 'Create Flashcard Set'}
      maxWidth="max-w-3xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col max-h-[70vh]">
        <div className="flex flex-col gap-6 overflow-y-auto pr-1 no-scrollbar flex-1 pb-4">
          {/* Header Section */}
        <div className="space-y-4">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center">
                <Layers className="w-5 h-5 text-primary-fixed-dim" />
              </div>
              <div>
                <p className="font-sans text-xs text-slate-400 uppercase tracking-widest font-semibold">
                  {isEditing ? 'Editing Set' : 'New Set'}
                </p>
                <p className="font-sans text-xs text-slate-500">Fill in the details for your flashcard set</p>
              </div>
            </div>
            
            <button
              type="button"
              onClick={() => { setShowAiConfig(!showAiConfig); setGenerationError(null); }}
              className={`px-3 py-1.5 rounded-lg font-sans text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all border ${
                showAiConfig
                  ? 'bg-primary-fixed-dim/20 border-primary-fixed-dim text-primary-fixed'
                  : 'bg-surface-container-high border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              AI Auto-Generate
            </button>
          </div>

          {/* AI Generator Config Panel */}
          {showAiConfig && (
            <div className="p-4 bg-surface-container-high/50 border border-primary-fixed-dim/30 rounded-xl animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-center gap-2 mb-4">
                <Bot className="w-4 h-4 text-primary-fixed-dim" />
                <h4 className="font-display font-medium text-white text-sm">Generate from Resources</h4>
              </div>

              <div className="space-y-3">
                {/* Resource list */}
                <div className="flex items-center justify-between mb-1">
                  <p className="font-sans text-xs text-slate-400">Select materials to generate flashcards from:</p>
                  {availableResources && availableResources.length > 1 && (
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      className="flex items-center gap-1.5 font-sans text-[11px] text-primary-fixed-dim hover:text-primary-fixed transition-colors font-semibold"
                    >
                      <CheckSquare className="w-3 h-3" />
                      {allSelected ? 'Deselect All' : 'Select All'}
                    </button>
                  )}
                </div>

                <div className="max-h-36 overflow-y-auto space-y-1.5 no-scrollbar bg-surface-container/50 p-2 rounded-lg border border-white/5">
                  {availableResources && availableResources.length > 0 ? (
                    availableResources.map(resource => {
                      const isChecked = selectedMaterialIds.includes(resource.id);
                      return (
                        <label
                          key={resource.id}
                          className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all ${
                            isChecked
                              ? 'bg-primary-fixed-dim/10 border border-primary-fixed-dim/20'
                              : 'hover:bg-white/5 border border-transparent'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleMaterial(resource.id)}
                            className="w-4 h-4 rounded border-slate-500 text-primary-fixed-dim focus:ring-primary-fixed-dim focus:ring-offset-background bg-surface-container-high shrink-0"
                          />
                          <span className="font-sans text-sm text-slate-300 truncate">{resource.title}</span>
                        </label>
                      );
                    })
                  ) : (
                    <p className="font-sans text-xs text-slate-500 text-center py-4">
                      No resources uploaded yet. Upload materials in the Resources tab first.
                    </p>
                  )}
                </div>

                {/* Format selection */}
                <div className="pt-2">
                  <p className="font-sans text-xs text-slate-400 mb-2">Card front format:</p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className={`flex flex-col p-3 rounded-lg border cursor-pointer transition-all ${frontFormat === 'question' ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim/50' : 'bg-surface-container/30 border-white/5 hover:border-white/20'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <input
                          type="radio"
                          name="frontFormat"
                          value="question"
                          checked={frontFormat === 'question'}
                          onChange={() => setFrontFormat('question')}
                          className="w-3.5 h-3.5 border-slate-500 text-primary-fixed-dim focus:ring-primary-fixed-dim bg-surface-container-high"
                        />
                        <span className="font-sans text-sm font-semibold text-slate-200">Question</span>
                      </div>
                      <span className="font-sans text-[10px] text-slate-500 ml-5.5 leading-tight">
                        Generates a question to test understanding.
                      </span>
                    </label>
                    
                    <label className={`flex flex-col p-3 rounded-lg border cursor-pointer transition-all ${frontFormat === 'term' ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim/50' : 'bg-surface-container/30 border-white/5 hover:border-white/20'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <input
                          type="radio"
                          name="frontFormat"
                          value="term"
                          checked={frontFormat === 'term'}
                          onChange={() => setFrontFormat('term')}
                          className="w-3.5 h-3.5 border-slate-500 text-primary-fixed-dim focus:ring-primary-fixed-dim bg-surface-container-high"
                        />
                        <span className="font-sans text-sm font-semibold text-slate-200">Term Only</span>
                      </div>
                      <span className="font-sans text-[10px] text-slate-500 ml-5.5 leading-tight">
                        Just the exact term on the front.
                      </span>
                    </label>
                  </div>
                </div>

                {/* Error message */}
                {generationError && (
                  <div className="flex items-start gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg animate-in fade-in duration-200">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <p className="font-sans text-xs text-rose-300">{generationError}</p>
                  </div>
                )}

                {/* Generate button */}
                <button
                  type="button"
                  onClick={handleGenerateAI}
                  disabled={selectedMaterialIds.length === 0 || isGenerating}
                  className="w-full py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-lg font-sans text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-container transition-all"
                >
                  {isGenerating ? (
                    <span className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full border-2 border-on-primary-fixed border-t-transparent animate-spin" />
                      Generating flashcards...
                    </span>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      Generate Flashcards
                      {selectedMaterialIds.length > 0 && (
                        <span className="ml-1 opacity-70">
                          from {selectedMaterialIds.length} material{selectedMaterialIds.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <label htmlFor="fc-title" className="font-sans text-sm font-medium text-slate-300">
              Title <span className="text-tertiary-fixed-dim">*</span>
            </label>
            <input
              id="fc-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Biology 101 — Chapter 4"
              className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 focus:border-primary-fixed-dim transition-all font-sans text-sm"
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label htmlFor="fc-desc" className="font-sans text-sm font-medium text-slate-300">
              Description <span className="text-slate-500 text-xs">(optional)</span>
            </label>
            <textarea
              id="fc-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A brief summary of what this set covers..."
              rows={2}
              className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 focus:border-primary-fixed-dim transition-all font-sans text-sm resize-none"
            />
          </div>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-white/5" />
          <span className="font-sans text-[10px] uppercase tracking-widest text-slate-500 font-semibold flex items-center gap-1.5">
            <BookOpen className="w-3 h-3" />
            Cards ({validCardCount} valid)
          </span>
          <div className="flex-1 h-px bg-white/5" />
        </div>

        {/* Cards List */}
        <div className="space-y-4" ref={cardsContainerRef}>
          {cards.map((card, index) => (
            <div
              key={card.id}
              className="group relative bg-surface-container-lowest rounded-xl border border-white/5 p-4 hover:border-white/10 transition-all animate-in fade-in duration-200"
            >
              {/* Card Number Badge */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <GripVertical className="w-4 h-4 text-slate-600" />
                  <span className="font-sans text-xs font-bold text-slate-500 uppercase tracking-widest">
                    Card {index + 1}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removeCard(card.id)}
                  className="p-1.5 rounded-lg bg-rose-500/5 border border-rose-500/10 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 hover:border-rose-500/20 transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100"
                  title="Remove card"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-sans text-[11px] uppercase tracking-widest text-slate-400 font-semibold">
                    Front (Question)
                  </label>
                  <textarea
                    value={card.front}
                    onChange={(e) => {
                      updateCard(card.id, 'front', e.target.value);
                      handleAutoResize(e);
                    }}
                    placeholder="Enter the question or term..."
                    rows={1}
                    className="w-full bg-surface-container border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/40 focus:border-primary-fixed-dim/50 transition-all font-sans text-sm resize-none overflow-hidden min-h-[44px]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-sans text-[11px] uppercase tracking-widest text-slate-400 font-semibold">
                    Back (Answer)
                  </label>
                  <textarea
                    value={card.back}
                    onChange={(e) => {
                      updateCard(card.id, 'back', e.target.value);
                      handleAutoResize(e);
                    }}
                    placeholder="Enter the answer or definition..."
                    rows={1}
                    className="w-full bg-surface-container border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/40 focus:border-primary-fixed-dim/50 transition-all font-sans text-sm resize-none overflow-hidden min-h-[44px]"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Add Card Button */}
        <button
          type="button"
          onClick={addCard}
          className="w-full py-3 border-2 border-dashed border-white/10 rounded-xl text-slate-400 font-sans text-sm font-semibold flex items-center justify-center gap-2 hover:border-primary-fixed-dim/30 hover:text-primary-fixed-dim hover:bg-primary-fixed-dim/5 transition-all"
        >
          <Plus className="w-4 h-4" />
          Add Another Card
        </button>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 mt-auto border-t border-white/5 shrink-0 bg-surface-container-lowest">
          <p className="font-sans text-xs text-slate-500">
            {validCardCount === 0
              ? 'Add at least one card with both sides filled'
              : `${validCardCount} card${validCardCount !== 1 ? 's' : ''} ready`}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="px-6 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isEditing ? 'Save Changes' : 'Create Set'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
