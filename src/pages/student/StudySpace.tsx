import { useState } from 'react';
import { ChevronLeft, Sparkles, Box, RefreshCw, X, QrCode, Link as LinkIcon, FileText, Plus, BookOpen, Layers } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import Modal from '../../components/ui/Modal';

export default function StudySpace() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'flashcards' | 'resources'>('flashcards');
  const [showQR, setShowQR] = useState(false);
  const [courseConnected, setCourseConnected] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedSetContent, setSelectedSetContent] = useState<number | null>(null);
  const [isCreateDeckModalOpen, setIsCreateDeckModalOpen] = useState(false);
  const [newDeckTitle, setNewDeckTitle] = useState('');
  
  const [flashcardSets, setFlashcardSets] = useState([
    {
      id: 1,
      title: "Ch 4. Synaptic Transmission",
      cardCount: 12,
      cards: [
        {
          id: 1,
          front: "What initiates the release of neurotransmitters?",
          back: "An influx of Calcium ions (Ca2+) into the presynaptic terminal, triggered by an action potential."
        }
      ]
    },
    {
      id: 2,
      title: "Midterm Review Terms",
      cardCount: 45,
      cards: [
        {
          id: 2,
          front: "What is primary function of the myelin sheath?",
          back: "To increase the speed at which electrical impulses travel along the axon."
        }
      ]
    }
  ]);

  const handleConnectCourse = () => {
    // Simulate connection
    setCourseConnected(true);
  };

  const handleGenerateFlashcards = () => {
    setIsGenerating(true);
    setTimeout(() => {
      setFlashcardSets(prevSets => {
        const newSets = [...prevSets];
        const targetSetIndex = newSets.findIndex(s => s.id === selectedSetContent);
        if (targetSetIndex >= 0) {
          const updatedSet = { ...newSets[targetSetIndex] };
          updatedSet.cards = [
            ...updatedSet.cards,
            {
              id: Date.now(),
              front: "What are Nodes of Ranvier?",
              back: "Periodic gaps in the myelin sheath where the action potential is regenerated."
            }
          ];
          updatedSet.cardCount = updatedSet.cards.length;
          newSets[targetSetIndex] = updatedSet;
        }
        return newSets;
      });
      setIsGenerating(false);
    }, 1500);
  };

  const handleCreateDeck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeckTitle.trim()) return;
    
    const newId = Date.now();
    setFlashcardSets(prev => [
      ...prev,
      {
        id: newId,
        title: newDeckTitle.trim(),
        cardCount: 0,
        cards: []
      }
    ]);
    setNewDeckTitle('');
    setIsCreateDeckModalOpen(false);
  };

  return (
    <div className="h-screen w-full flex flex-col bg-background overflow-hidden relative">
      {/* Header */}
      <header className="shrink-0 pt-4 px-6 border-b border-white/10 bg-[#020617]/50 backdrop-blur-md flex flex-col z-40">
        <div className="flex items-center justify-between pb-4">
          <div className="flex items-center gap-4">
            <Link to="/student/spaces" className="p-2 -ml-2 text-slate-400 hover:text-white transition-colors rounded-full hover:bg-white/5">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <h1 className="font-display text-xl font-medium text-on-surface flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-primary-fixed-dim shadow-[0_0_10px_rgba(0,218,243,0.5)]"></span>
              Biology 101 Prep Space
            </h1>
          </div>
          
          <div className="flex items-center gap-3">
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
            Flashcards & Study
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

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto w-full max-w-7xl mx-auto p-8 relative">
        
        {/* FLASHCARDS TAB */}
        {activeTab === 'flashcards' && (
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
        )}

        {/* RESOURCES TAB */}
        {activeTab === 'resources' && (
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
        )}
      </main>

      {/* AR Modal Overlay */}
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
              <div className="w-2 h-2 rounded-full bg-primary-fixed-dim animate-ping"></div>
              Link actively listening
            </div>
          </div>
        </div>
      )}

      {/* Create Deck Modal */}
      <Modal
        isOpen={isCreateDeckModalOpen}
        onClose={() => {
          setIsCreateDeckModalOpen(false);
          setNewDeckTitle('');
        }}
        title="Create New Deck"
      >
        <form onSubmit={handleCreateDeck} className="flex flex-col gap-6">
          <div className="space-y-2">
            <label htmlFor="deckTitle" className="font-sans text-sm font-medium text-slate-300">
              Deck Title
            </label>
            <input
              id="deckTitle"
              type="text"
              value={newDeckTitle}
              onChange={(e) => setNewDeckTitle(e.target.value)}
              placeholder="e.g. Biology 101 Midterm"
              className="w-full bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 focus:border-primary-fixed-dim transition-all"
              autoFocus
            />
          </div>
          
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setIsCreateDeckModalOpen(false);
                setNewDeckTitle('');
              }}
              className="px-5 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!newDeckTitle.trim()}
              className="px-5 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Deck
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

