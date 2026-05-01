import { useState } from 'react';
import { ChevronLeft, Sparkles, Box, RefreshCw, X, QrCode, Link as LinkIcon, FileText, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

export default function StudySpace() {
  const navigate = useNavigate();
  const [showQR, setShowQR] = useState(false);
  const [courseConnected, setCourseConnected] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [flashcards, setFlashcards] = useState([
    {
      id: 1,
      front: "What initiates the release of neurotransmitters?",
      back: "An influx of Calcium ions (Ca2+) into the presynaptic terminal, triggered by an action potential."
    }
  ]);

  const handleConnectCourse = () => {
    // Simulate connection
    setCourseConnected(true);
  };

  const handleGenerateFlashcards = () => {
    if (!selectedDoc) return;
    setIsGenerating(true);
    setTimeout(() => {
      setFlashcards([
        ...flashcards,
        {
          id: 2,
          front: "What is primary function of the myelin sheath?",
          back: "To increase the speed at which electrical impulses travel along the axon."
        },
        {
          id: 3,
          front: "What are Nodes of Ranvier?",
          back: "Periodic gaps in the myelin sheath where the action potential is regenerated."
        }
      ]);
      setIsGenerating(false);
    }, 1500);
  };

  return (
    <div className="h-screen w-full flex flex-col bg-background overflow-hidden relative">
      {/* Header */}
      <header className="shrink-0 h-16 border-b border-white/10 bg-[#020617]/50 backdrop-blur-md flex items-center justify-between px-6 z-40">
        <div className="flex items-center gap-4">
          <Link to="/student/spaces" className="p-2 -ml-2 text-slate-400 hover:text-white transition-colors rounded-full hover:bg-white/5">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="font-display text-lg font-medium text-on-surface flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary-fixed-dim"></span>
            Biology 101 Prep Space
          </h1>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowQR(true)}
            className="px-4 py-2 bg-gradient-to-r from-primary-container to-primary text-on-primary-container rounded-md font-sans text-xs uppercase tracking-widest font-semibold flex items-center gap-2 shadow-[0_0_15px_rgba(0,229,255,0.3)] hover:shadow-[0_0_25px_rgba(0,229,255,0.5)] transition-all"
          >
            <Box className="w-4 h-4" />
            Initialize Web-AR Hologram
          </button>
        </div>
      </header>

      {/* Split Layout */}
      <main className="flex-1 flex overflow-hidden">
        
        {/* Left Panel: Source Material */}
        <div className="w-[45%] h-full border-r border-white/10 bg-surface-container-lowest flex flex-col relative">
          {!courseConnected ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-gradient-to-b from-transparent to-surface-container/20">
              <div className="w-16 h-16 rounded-full bg-surface-container border border-white/10 flex items-center justify-center mb-6">
                <LinkIcon className="w-8 h-8 text-slate-400" />
              </div>
              <h2 className="font-display text-2xl font-medium text-white mb-2">No Course Connected</h2>
              <p className="font-sans text-sm text-slate-400 mb-8 max-w-sm">
                Connect this space to a course to automatically fetch uploaded resources, syllabi, and presentation slides.
              </p>
              <button 
                onClick={handleConnectCourse}
                className="px-6 py-3 bg-primary-fixed-dim hover:bg-primary-container text-on-primary-fixed rounded-xl font-sans font-bold text-sm uppercase tracking-wider transition-colors shadow-lg shadow-primary-fixed-dim/20"
              >
                Connect to Biology 301
              </button>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-white/5 bg-surface-container/50 text-xs font-semibold uppercase tracking-widest text-on-surface-variant flex justify-between items-center">
                <span>Course Resources</span>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded-full border border-emerald-500/30">Connected to Bio 301</span>
              </div>
              
              {!selectedDoc ? (
                <div className="flex-1 p-6 overflow-y-auto">
                  <div className="grid gap-3">
                    {['Synaptic_Pathways_Ch4.pdf', 'Lecture_03_Action_Potentials.pptx', 'Study_Guide_Midterm.docx'].map(doc => (
                      <button 
                        key={doc}
                        onClick={() => setSelectedDoc(doc)}
                        className="w-full flex items-center gap-4 p-4 rounded-xl border border-white/10 bg-surface-container-lowest hover:bg-surface-container hover:border-white/20 transition-all text-left"
                      >
                        <div className="w-10 h-10 rounded-lg bg-primary-fixed-dim/10 flex items-center justify-center shrink-0">
                          <FileText className="w-5 h-5 text-primary-fixed-dim" />
                        </div>
                        <div className="overflow-hidden">
                          <p className="font-sans text-sm font-medium text-white truncate">{doc}</p>
                          <p className="font-sans text-xs text-slate-500 truncate mt-1">Found in Biology 301 Resources</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="p-4 flex items-center gap-3 border-b border-white/5 bg-surface-container/30">
                     <button onClick={() => setSelectedDoc(null)} className="text-slate-400 hover:text-white transition-colors">
                       <ChevronLeft className="w-5 h-5" />
                     </button>
                     <p className="font-sans text-sm text-white truncate font-medium">{selectedDoc}</p>
                  </div>
                  <div className="flex-1 p-8 overflow-y-auto font-sans text-slate-300 leading-relaxed text-sm bg-white/5 mx-4 my-4 rounded-lg shadow-inner">
                    <h2 className="text-xl font-bold text-white mb-4">4.1 Synaptic Transmission Overview</h2>
                    <p className="mb-4">
                      Synaptic transmission is the biological process by which a neuron communicates with a target cell across a synapse. Chemical synaptic transmission involves the release of a neurotransmitter from the pre-synaptic neuron...
                    </p>
                    <p className="mb-4 opacity-70 italic">[Document view rendering...]</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right Panel: Flashcards Workspace */}
        <div className="flex-1 h-full bg-surface-container/20 p-8 overflow-y-auto relative perspective-1000">
          
          <div className="flex justify-between items-end mb-8">
            <div>
              <h2 className="font-display text-2xl font-semibold text-white mb-1">Flashcards</h2>
              <p className="font-sans text-sm text-slate-400">Review your AI-generated cards</p>
            </div>
            <div className="flex gap-3">
              <button 
                disabled={!selectedDoc || isGenerating}
                onClick={handleGenerateFlashcards}
                className="px-4 py-2 bg-surface-container border border-primary-fixed-dim/30 text-primary-fixed mx-auto hover:bg-surface-container-high rounded-lg font-sans text-xs uppercase tracking-widest font-semibold flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(0,218,243,0.1)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sparkles className="w-4 h-4 text-amber-400" />
                {isGenerating ? 'Generating...' : 'Auto-Generate (AI)'}
              </button>
              <button className="px-4 py-2 bg-surface-container border border-white/10 text-on-surface hover:bg-surface-container-high rounded-lg font-sans text-xs uppercase tracking-widest font-semibold flex items-center gap-2 transition-all">
                <Plus className="w-4 h-4" />
                Add Card
              </button>
            </div>
          </div>

          <div className="relative z-10 grid grid-cols-1 xl:grid-cols-2 gap-6">
            
            {flashcards.map((card) => (
              <div key={card.id} className="group h-64 [perspective:1000px] cursor-pointer">
                <div className="relative w-full h-full transition-transform duration-500 [transform-style:preserve-3d] group-hover:[transform:rotateY(180deg)]">
                  {/* Front */}
                  <div className="absolute inset-0 [backface-visibility:hidden] rounded-xl border border-white/10 bg-surface-container p-6 flex flex-col justify-center items-center text-center shadow-lg">
                     <p className="font-display text-xl text-on-surface mb-4">{card.front}</p>
                     <span className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center gap-1 mt-auto">
                       <RefreshCw className="w-3 h-3" /> Hover to Flip
                     </span>
                  </div>
                  {/* Back */}
                  <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-xl border border-primary-fixed-dim/30 bg-primary-fixed-dim/5 p-6 flex flex-col justify-center items-center text-center shadow-[0_0_30px_rgba(0,218,243,0.1)]">
                     <p className="font-sans text-base text-primary-fixed-dim font-medium">{card.back}</p>
                  </div>
                </div>
              </div>
            ))}

          </div>
        </div>
      </main>

      {/* AR Modal Overlay */}
      {showQR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xl">
          <div className="bg-surface-container-high rounded-2xl border border-primary-fixed-dim/30 p-8 max-w-sm w-full relative shadow-[0_20px_50px_rgba(0,0,0,0.5),0_0_100px_rgba(0,218,243,0.15)] flex flex-col items-center text-center">
            <button onClick={() => setShowQR(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
            <div className="w-16 h-16 rounded-full bg-primary-fixed-dim/20 flex items-center justify-center mb-6">
               <Box className="w-8 h-8 text-primary-fixed-dim" />
            </div>
            <h2 className="font-display text-2xl font-semibold text-on-surface mb-2">AR Web Session</h2>
            <p className="font-sans text-sm text-on-surface-variant mb-8">Scan to beam the 3D model to your mobile device instantly.</p>
            <div className="bg-white p-4 rounded-xl mb-6">
              <QrCode className="w-48 h-48 text-slate-900" />
            </div>
            <p className="text-[10px] uppercase font-semibold tracking-widest text-primary-fixed-dim">Link actively listening...</p>
          </div>
        </div>
      )}
    </div>
  );
}
