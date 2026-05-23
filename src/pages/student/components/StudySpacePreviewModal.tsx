import React, { useState, useEffect } from 'react';
import { X, Layers, BookOpen, ChevronLeft, ChevronRight, CheckCircle2, FolderPlus, Trash2, Sparkles, Building, Users } from 'lucide-react';
import { MOCK_PUBLIC_SPACES, PublicSpaceDetail, getSavedSpaces, saveSpaceToMemory, unsaveSpaceFromMemory } from '../../../data/mockPublicSpaces';

interface StudySpacePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  spaceId: string | null;
}

export default function StudySpacePreviewModal({ isOpen, onClose, spaceId }: StudySpacePreviewModalProps) {
  const [activeTab, setActiveTab] = useState<'flashcards' | 'resources'>('flashcards');
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [hoverUnsave, setHoverUnsave] = useState(false);

  // Look up space details
  const space: PublicSpaceDetail | undefined = spaceId ? MOCK_PUBLIC_SPACES[spaceId] : undefined;

  useEffect(() => {
    if (isOpen) {
      setCurrentCardIndex(0);
      setIsFlipped(false);
      setActiveTab('flashcards');
      setHoverUnsave(false);
      
      // Check if already saved in volatile in-memory store
      if (spaceId) {
        const exists = getSavedSpaces().some((s: any) => s.id === `space-${spaceId}`);
        setIsSaved(exists);
      }
    }
  }, [isOpen, spaceId]);

  if (!isOpen || !space) return null;

  const cards = space.flashcards;

  const handleSaveToggle = () => {
    if (isSaved) {
      // Unsave/Remove from volatile in-memory store
      unsaveSpaceFromMemory(`space-${space.id}`);
      setIsSaved(false);
    } else {
      // Save/Import to volatile in-memory store
      const newSpace = {
        id: `space-${space.id}`,
        title: space.title,
        courseInfo: space.university,
        lastModified: 'Just now',
        flashcardsCount: space.flashcardsCount,
        color: space.color,
        borderColor: space.borderColor,
        isImported: true,
        authorName: space.authorName,
        flashcards: space.flashcards,
        resources: space.resources
      };
      saveSpaceToMemory(newSpace);
      setIsSaved(true);
    }
  };

  const handleNextCard = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsFlipped(false);
    setTimeout(() => {
      setCurrentCardIndex((prev) => (prev + 1) % cards.length);
    }, 150);
  };

  const handlePrevCard = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsFlipped(false);
    setTimeout(() => {
      setCurrentCardIndex((prev) => (prev - 1 + cards.length) % cards.length);
    }, 150);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="absolute inset-0" 
        onClick={onClose}
        aria-hidden="true"
      />
      
      <div 
        className="relative w-full max-w-2xl bg-surface-container-high rounded-3xl border border-white/10 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]"
        role="dialog"
      >
        {/* Glow backdrop behind header */}
        <div className={`absolute top-0 left-0 right-0 h-44 bg-gradient-to-b ${space.color} blur-3xl opacity-20 pointer-events-none -z-10`} />

        {/* Header section */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-white/5 relative">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-[10px] bg-primary-fixed-dim/20 text-primary-fixed-dim px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider">
                Public Space Preview
              </span>
              <span className="text-[10px] bg-white/5 text-slate-400 px-2 py-0.5 rounded font-sans flex items-center gap-1">
                <Building className="w-3 h-3" /> {space.university}
              </span>
              <span className="text-[10px] bg-white/5 text-slate-400 px-2 py-0.5 rounded font-sans flex items-center gap-1">
                <Users className="w-3 h-3" /> {space.studiedCount.toLocaleString()} Studied
              </span>
            </div>
            <h2 className="font-display text-2xl font-bold text-white truncate mb-1">
              {space.title}
            </h2>
            <p className="text-xs text-slate-400 font-sans">
              Created by <span className="text-primary-fixed-dim font-semibold">{space.authorName}</span>
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 -mr-1 -mt-1 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-colors shrink-0"
            aria-label="Close preview"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex px-6 pt-3 border-b border-white/5 bg-surface-container/30 shrink-0">
          <button
            onClick={() => setActiveTab('flashcards')}
            className={`pb-3 font-display text-sm font-semibold transition-colors border-b-2 flex items-center gap-2 relative ${
              activeTab === 'flashcards' 
                ? 'text-primary-fixed-dim border-primary-fixed-dim' 
                : 'text-slate-400 hover:text-white border-transparent'
            }`}
          >
            <Layers className="w-4 h-4" />
            Flashcards ({cards.length})
          </button>
          <button
            onClick={() => setActiveTab('resources')}
            className={`pb-3 ml-6 font-display text-sm font-semibold transition-colors border-b-2 flex items-center gap-2 relative ${
              activeTab === 'resources' 
                ? 'text-primary-fixed-dim border-primary-fixed-dim' 
                : 'text-slate-400 hover:text-white border-transparent'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            Resources ({space.resources.length})
          </button>
        </div>

        {/* Body content */}
        <div className="flex-1 p-6 overflow-y-auto min-h-[320px]">
          {activeTab === 'flashcards' && (
            <div className="flex flex-col items-center h-full justify-between gap-6">
              
              <p className="text-xs font-sans text-slate-400 text-center max-w-md -mt-1">
                {space.description}
              </p>

              {/* 3D Flippable Card Carousel */}
              <div className="w-full max-w-md relative flex flex-col items-center">
                {/* 3D Perspective Card Container */}
                <div 
                  className="w-full h-52 cursor-pointer [perspective:1000px] select-none group/card"
                  onClick={() => setIsFlipped(!isFlipped)}
                >
                  <div 
                    className={`relative w-full h-full duration-500 [transform-style:preserve-3d] transition-transform ${
                      isFlipped ? '[transform:rotateY(180deg)]' : ''
                    }`}
                  >
                    {/* FRONT SIDE */}
                    <div className="absolute inset-0 bg-surface-container border border-white/10 rounded-2xl p-6 flex flex-col justify-between items-center text-center [backface-visibility:hidden] shadow-lg group-hover/card:border-primary-fixed-dim/30 transition-colors">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-primary-fixed-dim" />
                        <span className="text-[10px] font-sans font-bold text-slate-500 uppercase tracking-widest">Question</span>
                      </div>
                      <p className="font-display font-medium text-lg text-white leading-relaxed max-w-[90%] flex-1 flex items-center justify-center">
                        {cards[currentCardIndex]?.front}
                      </p>
                      <span className="text-[10px] font-sans text-slate-500 font-semibold uppercase tracking-wider">Click to Flip</span>
                    </div>

                    {/* BACK SIDE */}
                    <div className="absolute inset-0 bg-gradient-to-br from-primary-fixed-dim/20 to-primary-fixed/5 border border-primary-fixed-dim/30 rounded-2xl p-6 flex flex-col justify-between items-center text-center [backface-visibility:hidden] [transform:rotateY(180deg)] shadow-[inset_0_2px_15px_rgba(0,218,243,0.1)]">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-primary-fixed-dim" />
                        <span className="text-[10px] font-sans font-bold text-primary-fixed-dim uppercase tracking-widest">Correct Answer</span>
                      </div>
                      <p className="font-sans font-medium text-base text-slate-200 leading-relaxed max-w-[95%] flex-1 flex items-center justify-center">
                        {cards[currentCardIndex]?.back}
                      </p>
                      <span className="text-[10px] font-sans text-primary-fixed-dim/70 font-semibold uppercase tracking-wider">Click to Flip Back</span>
                    </div>
                  </div>
                </div>

                {/* Carousel Controls */}
                <div className="flex items-center justify-between w-full mt-5 px-4">
                  <button
                    onClick={handlePrevCard}
                    className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 hover:border-white/20 active:scale-95 transition-all"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>

                  <span className="font-sans text-xs text-slate-400 font-semibold uppercase tracking-wider">
                    Card {currentCardIndex + 1} of {cards.length}
                  </span>

                  <button
                    onClick={handleNextCard}
                    className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 hover:border-white/20 active:scale-95 transition-all"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'resources' && (
            <div className="flex flex-col gap-4">
              <p className="text-xs font-sans text-slate-400">
                The following lecture notes, study templates, and presentations are shared inside this space:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-2">
                {space.resources.map((res, i) => (
                  <div 
                    key={i} 
                    className="flex items-center gap-3 p-4 bg-surface-container border border-white/5 rounded-xl hover:border-white/10 transition-all duration-300"
                  >
                    <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center border border-white/5 shrink-0 text-slate-300">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white truncate">{res}</p>
                      <p className="text-[10px] text-slate-500 font-mono mt-0.5">Synced · PDF/PPTX Document</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-5 border-t border-white/5 bg-surface-container-high shrink-0 flex items-center justify-between gap-4">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-white/15 text-slate-300 hover:text-white hover:bg-white/5 transition-all text-sm font-medium"
          >
            Close Preview
          </button>
          
          <button
            onClick={handleSaveToggle}
            onMouseEnter={() => setHoverUnsave(true)}
            onMouseLeave={() => setHoverUnsave(false)}
            className={`px-6 py-2.5 rounded-xl font-sans text-sm font-bold flex items-center gap-2 active:scale-95 transition-all shadow-lg ${
              isSaved
                ? hoverUnsave
                  ? 'bg-rose-500/25 border border-rose-500/35 text-rose-400 hover:bg-rose-500/35 shadow-rose-950/20'
                  : 'bg-emerald-400/10 border border-emerald-400/20 text-emerald-400 shadow-emerald-950/20'
                : 'bg-primary-fixed-dim text-black hover:bg-primary-fixed-dim/90 shadow-primary-fixed-dim/20'
            }`}
          >
            {isSaved ? (
              hoverUnsave ? (
                <><Trash2 className="w-4 h-4" /> Remove Space</>
              ) : (
                <><CheckCircle2 className="w-4 h-4" /> Saved to My Spaces</>
              )
            ) : (
              <><FolderPlus className="w-4 h-4" /> Save to My Study Spaces</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
