import React from 'react';
import { Link as LinkIcon, FileText, BookOpen, Sparkles } from 'lucide-react';


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

interface ResourcesTabProps {
  courseConnected: boolean;
  selectedDoc: string | null;
  handleConnectCourse: () => void;
  setSelectedDoc: (doc: string | null) => void;
  setActiveTab: (tab: 'flashcards' | 'resources') => void;
  setIsGenerating: (isGenerating: boolean) => void;
  setSelectedSetContent: (id: number | null) => void;
  setFlashcardSets: React.Dispatch<React.SetStateAction<FlashcardSet[]>>;
}

export default function ResourcesTab({
  courseConnected,
  selectedDoc,
  handleConnectCourse,
  setSelectedDoc,
  setActiveTab,
  setIsGenerating,
  setSelectedSetContent,
  setFlashcardSets
}: ResourcesTabProps) {
  return (
    <div className="animate-in fade-in duration-300 h-full flex flex-col">
      {!courseConnected ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-gradient-to-b from-transparent to-surface-container/20 border border-white/5 rounded-2xl">
          <div className="w-20 h-20 rounded-full bg-surface-container border border-white/10 flex items-center justify-center mb-6 shadow-xl">
            <LinkIcon className="w-10 h-10 text-slate-400" />
          </div>
          <h2 className="font-display text-3xl font-medium text-white mb-3">No Course Connected</h2>
          <p className="font-sans text-base text-slate-400 mb-10 max-w-lg">
            Connect this workspace to your enrolled course to instantly synchronize syllabi, documents, and presentation slides.
          </p>
          <button 
            onClick={handleConnectCourse}
            className="px-8 py-4 bg-primary-fixed-dim hover:bg-primary-container text-on-primary-fixed rounded-xl font-sans font-bold text-sm uppercase tracking-wider transition-all shadow-lg shadow-primary-fixed-dim/20 hover:scale-105 active:scale-95"
          >
            Connect to Biology 301
          </button>
        </div>
      ) : (
        <div className="flex h-[calc(100vh-140px)] gap-6">
          
          {/* File List */}
          <div className="w-1/3 bg-surface-container-lowest border border-white/5 rounded-2xl p-4 flex flex-col">
            <div className="px-2 py-3 border-b border-white/5 flex justify-between items-center mb-4">
              <span className="font-display font-medium text-white text-lg">Course Materials</span>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded-full border border-emerald-500/30 uppercase tracking-widest font-semibold flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div> Connected
              </span>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-2 space-y-2">
              {['Synaptic_Pathways_Ch4.pdf', 'Lecture_03_Action_Potentials.pptx', 'Study_Guide_Midterm.docx'].map(doc => (
                <button 
                  key={doc}
                  onClick={() => setSelectedDoc(doc)}
                  className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-all text-left group ${
                    selectedDoc === doc 
                      ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim/30' 
                      : 'bg-surface-container border-white/5 hover:border-white/20'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                    selectedDoc === doc ? 'bg-primary-fixed-dim/20 text-primary-fixed-dim' : 'bg-surface-container-high text-slate-400 group-hover:text-white'
                  }`}>
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="overflow-hidden">
                    <p className={`font-sans text-sm font-medium truncate ${selectedDoc === doc ? 'text-primary-fixed' : 'text-white'}`}>
                      {doc}
                    </p>
                    <p className="font-sans text-xs text-slate-500 truncate mt-1">Found in Biology 301</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Document Viewer */}
          <div className="flex-1 bg-surface-container-lowest border border-white/5 rounded-2xl flex flex-col relative overflow-hidden">
            {!selectedDoc ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-8 text-center">
                <BookOpen className="w-16 h-16 mb-4 opacity-20" />
                <p className="font-display text-lg">Select a document to view</p>
                <p className="font-sans text-sm text-slate-400 max-w-sm mt-2">After selecting a document, you can analyze its contents and generate flashcards.</p>
              </div>
            ) : (
              <>
                <div className="px-6 py-4 flex items-center justify-between border-b border-white/5 bg-surface-container/30">
                   <div className="flex items-center gap-4">
                     <FileText className="w-6 h-6 text-primary-fixed-dim" />
                     <p className="font-display text-lg text-white truncate font-medium">{selectedDoc}</p>
                   </div>
                   <button 
                     onClick={() => {
                       setActiveTab('flashcards');
                       setIsGenerating(true);
                       setTimeout(() => {
                         const newId = Date.now();
                         setSelectedSetContent(newId);
                         setFlashcardSets(prev => [
                           ...prev,
                           {
                             id: newId,
                             title: `Generated from ${selectedDoc}`,
                             cardCount: 1,
                             cards: [
                               { id: Date.now(), front: "What is EPSP?", back: "Excitatory Postsynaptic Potential." }
                             ]
                           }
                         ]);
                         setIsGenerating(false);
                       }, 1500);
                     }}
                     className="px-4 py-2 bg-primary-fixed-dim/20 text-primary-fixed hover:bg-primary-fixed-dim hover:text-on-primary-fixed rounded-lg text-xs uppercase tracking-widest font-semibold transition-colors flex items-center gap-2"
                   >
                     <Sparkles className="w-3.5 h-3.5" /> Generate Cards from this Doc
                   </button>
                </div>
                <div className="flex-1 p-10 overflow-y-auto font-sans leading-relaxed text-base bg-gradient-to-b from-white/5 to-transparent text-slate-300">
                  <div className="max-w-2xl mx-auto space-y-6">
                    <h2 className="text-3xl font-display font-bold text-white mb-6">4.1 Synaptic Transmission Overview</h2>
                    <p>
                      Synaptic transmission is the biological process by which a neuron communicates with a target cell across a synapse. Chemical synaptic transmission involves the release of a neurotransmitter from the pre-synaptic neuron...
                    </p>
                    <p>
                      Upon the arrival of an action potential at the presynaptic terminal, voltage-gated calcium channels open, allowing an influx of Ca2+ ions. This calcium entry signals synaptic vesicles to fuse with the presynaptic membrane, emptying their neurotransmitter contents into the synaptic cleft.
                    </p>
                    <p className="opacity-50 italic mt-12">[Document rendering active...]</p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
