import React, { useState, useEffect } from 'react';
import { Plus, Trash2, GripVertical, Layers, BookOpen } from 'lucide-react';
import Modal from '../../../components/ui/Modal';

interface CardEntry {
  id: number;
  front: string;
  back: string;
}

interface CreateFlashcardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { title: string; description: string; cards: { front: string; back: string }[] }) => void;
  initialData?: {
    title: string;
    description: string;
    cards: { id: number; front: string; back: string }[];
  } | null;
}

export default function CreateFlashcardsModal({ isOpen, onClose, onSave, initialData }: CreateFlashcardsModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cards, setCards] = useState<CardEntry[]>([
    { id: Date.now(), front: '', back: '' },
    { id: Date.now() + 1, front: '', back: '' },
  ]);

  useEffect(() => {
    if (isOpen && initialData) {
      setTitle(initialData.title);
      setDescription(initialData.description);
      setCards(
        initialData.cards.length > 0
          ? initialData.cards.map(c => ({ ...c }))
          : [{ id: Date.now(), front: '', back: '' }, { id: Date.now() + 1, front: '', back: '' }]
      );
    } else if (isOpen && !initialData) {
      setTitle('');
      setDescription('');
      setCards([
        { id: Date.now(), front: '', back: '' },
        { id: Date.now() + 1, front: '', back: '' },
      ]);
    }
  }, [isOpen, initialData]);

  const addCard = () => {
    setCards(prev => [...prev, { id: Date.now(), front: '', back: '' }]);
  };

  const removeCard = (id: number) => {
    if (cards.length <= 1) return;
    setCards(prev => prev.filter(c => c.id !== id));
  };

  const updateCard = (id: number, field: 'front' | 'back', value: string) => {
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit Flashcard Set' : 'Create Flashcard Set'}
      maxWidth="max-w-3xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-6 max-h-[70vh] overflow-y-auto pr-1 no-scrollbar">
        {/* Header Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-3 mb-2">
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
        <div className="space-y-4">
          {cards.map((card, index) => (
            <div
              key={card.id}
              className="group relative bg-surface-container-lowest rounded-xl border border-white/5 p-4 hover:border-white/10 transition-all"
            >
              {/* Card Number Badge */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <GripVertical className="w-4 h-4 text-slate-600" />
                  <span className="font-sans text-xs font-bold text-slate-500 uppercase tracking-widest">
                    Card {index + 1}
                  </span>
                </div>
                {cards.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeCard(card.id)}
                    className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                    title="Remove card"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-sans text-[11px] uppercase tracking-widest text-slate-400 font-semibold">
                    Front (Question)
                  </label>
                  <textarea
                    value={card.front}
                    onChange={(e) => updateCard(card.id, 'front', e.target.value)}
                    placeholder="Enter the question or term..."
                    rows={3}
                    className="w-full bg-surface-container border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/40 focus:border-primary-fixed-dim/50 transition-all font-sans text-sm resize-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-sans text-[11px] uppercase tracking-widest text-slate-400 font-semibold">
                    Back (Answer)
                  </label>
                  <textarea
                    value={card.back}
                    onChange={(e) => updateCard(card.id, 'back', e.target.value)}
                    placeholder="Enter the answer or definition..."
                    rows={3}
                    className="w-full bg-surface-container border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/40 focus:border-primary-fixed-dim/50 transition-all font-sans text-sm resize-none"
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

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-white/5">
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
