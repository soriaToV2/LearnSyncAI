import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link as LinkIcon, FileText, BookOpen, Sparkles, MessageSquare, Send, CheckSquare, Square, X, Bot, User, FileImage, FileCode, FileSpreadsheet, Download, FileAudio, FileVideo, Highlighter, Trash2, Edit3 } from 'lucide-react';

interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface DocNote {
  id: string;
  selectedText: string;
  noteText: string;
  aiChat?: { role: 'user' | 'ai'; content: string }[];
  isAiLoading?: boolean;
  rects: HighlightRect[];
  top: number;
  left: number;
  color: string;
  isEditing: boolean;
  type: 'highlight' | 'note' | 'ai';
  expanded?: boolean;
}

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

const docsList = [
  { name: 'Synaptic_Pathways_Ch4.pdf', type: 'pdf', date: 'Oct 12, 2026' },
  { name: 'Lecture_03_Action_Potentials.pptx', type: 'pptx', date: 'Oct 15, 2026' },
  { name: 'Study_Guide_Midterm.docx', type: 'docx', date: 'Oct 20, 2026' },
  { name: 'Lab_Protocol_Week3.pdf', type: 'pdf', date: 'Oct 22, 2026' },
  { name: 'Neuro_Diagrams_Annotations.png', type: 'image', date: 'Oct 25, 2026' },
];

const getFileIcon = (type: string) => {
  switch (type) {
    case 'pdf': return { icon: FileText, color: 'text-red-400', bg: 'bg-red-500/20' };
    case 'pptx': return { icon: FileText, color: 'text-orange-400', bg: 'bg-orange-500/20' };
    case 'docx': return { icon: FileText, color: 'text-blue-400', bg: 'bg-blue-500/20' };
    case 'image': return { icon: FileImage, color: 'text-emerald-400', bg: 'bg-emerald-500/20' };
    default: return { icon: FileText, color: 'text-slate-400', bg: 'bg-white/10' };
  }
};

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
  const [chatDocs, setChatDocs] = useState<string[]>([]);
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; content: string }[]>([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [allDocNotes, setAllDocNotes] = useState<Record<string, DocNote[]>>(() => {
    try {
      const saved = localStorage.getItem('study_doc_notes_v1');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem('study_doc_notes_v1', JSON.stringify(allDocNotes));
  }, [allDocNotes]);

  const docNotes = selectedDoc ? (allDocNotes[selectedDoc] || []) : [];

  const updateDocNotes = (updater: (prev: DocNote[]) => DocNote[]) => {
    if (!selectedDoc) return;
    setAllDocNotes(prev => ({
      ...prev,
      [selectedDoc]: updater(prev[selectedDoc] || [])
    }));
  };

  const [selectionPos, setSelectionPos] = useState<{top: number, left: number, width: number, text: string, rects: HighlightRect[]} | null>(null);

  const handleSelection = () => {
    setTimeout(() => {
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length > 0 && !sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        const container = document.getElementById('doc-content-wrapper');
        if (container) {
          const containerRect = container.getBoundingClientRect();
          const rects = Array.from(range.getClientRects());
          const relativeRects = rects.map(rect => ({
            top: rect.top - containerRect.top,
            left: rect.left - containerRect.left,
            width: rect.width,
            height: rect.height
          }));
          
          if (relativeRects.length > 0) {
            setSelectionPos({
              top: relativeRects[0].top - 48,
              left: relativeRects[0].left + (relativeRects[0].width / 2) - 80, 
              width: relativeRects[0].width,
              rects: relativeRects,
              text: sel.toString().trim()
            });
          }
        }
      } else {
        setSelectionPos(null);
      }
    }, 10);
  };

  const addDocNote = (type: 'highlight' | 'note' | 'ai', color: string) => {
    if (!selectionPos) return;
    
    const newNote: DocNote = {
      id: Date.now().toString(),
      selectedText: selectionPos.text,
      noteText: '',
      aiChat: type === 'ai' ? [] : undefined,
      rects: selectionPos.rects,
      top: selectionPos.rects[0].top,
      left: selectionPos.rects[0].left,
      color,
      isEditing: type === 'note' || type === 'ai',
      type,
      expanded: type === 'note' || type === 'ai'
    };
    
    updateDocNotes(prev => [...prev, newNote]);
    setSelectionPos(null);
    window.getSelection()?.removeAllRanges();
  };

  const submitAiPrompt = (id: string, text: string) => {
    updateDocNotes(prev => prev.map(n => {
      if (n.id === id) {
        return { 
          ...n, 
          aiChat: [...(n.aiChat || []), { role: 'user', content: text }],
          isEditing: false, 
          isAiLoading: true 
        };
      }
      return n;
    }));

    setTimeout(() => {
      updateDocNotes(prev => prev.map(n => {
        if (n.id === id) {
          let aiRes = '';
          const query = text.toLowerCase();
          
          if (query.includes('explain') || query.includes('what is')) {
            aiRes = `"${n.selectedText}" refers to the process where electrical or chemical signals are transmitted across the synaptic cleft. Would you like me to relate this to action potentials?`;
          } else if (query.includes('summarize')) {
            aiRes = `In the context of this document, "${n.selectedText}" is a key principle detailing how neurons communicate in circuits.`;
          } else if (query.includes('example')) {
            aiRes = `An example of this is when a motor neuron commands a muscle cell to contract via the neuromuscular junction.`;
          } else {
             aiRes = `You asked: "${text}". Based on "${n.selectedText}", this involves the fundamental mechanisms of neurotransmitter release and receptor binding. Let me know if you need more details!`;
          }

          return { 
            ...n, 
            isAiLoading: false, 
            aiChat: [...(n.aiChat || []), { role: 'ai', content: aiRes }]
          };
        }
        return n;
      }));
    }, 1500);
  };

  const saveNote = (id: string, text: string) => {
    updateDocNotes(prev => prev.map(n => {
      if (n.id === id) {
        return { ...n, noteText: text, isEditing: false };
      }
      return n;
    }).filter(n => !(n.id === id && !text.trim() && n.type === 'note' && !n.noteText)));
  };

  const editNote = (id: string) => {
    updateDocNotes(prev => prev.map(n => n.id === id ? { ...n, isEditing: true } : n));
  };

  const toggleNoteExpanded = (id: string) => {
    updateDocNotes(prev => prev.map(n => n.id === id ? { ...n, expanded: !n.expanded } : n));
  };

  const deleteNote = (id: string) => {
    updateDocNotes(prev => prev.filter(n => n.id !== id));
  };

  const openDoc = (docName: string | null) => {
    setSelectedDoc(docName);
    setSelectionPos(null);
  };

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isTyping]);

  const toggleChatDoc = (e: React.MouseEvent, docName: string) => {
    e.stopPropagation();
    setChatDocs(prev => 
      prev.includes(docName) ? prev.filter(d => d !== docName) : [...prev, docName]
    );
  };

  const submitQuery = (query: string) => {
    if (!query.trim()) return;

    setMessages(prev => [...prev, { role: 'user', content: query }]);
    setIsTyping(true);

    setTimeout(() => {
      let aiResponse = '';
      if (chatDocs.length > 0) {
        if (query.toLowerCase().includes('summarize')) {
          aiResponse = `Based on the ${chatDocs.length} selected resource(s) (${chatDocs.join(', ')}), here is a summary:\n\nThe texts discuss the fundamental mechanisms of synaptic transmission, focusing on how action potentials trigger the influx of calcium ions, promoting vesicular fusion and neurotransmitter release into the synaptic cleft.`;
        } else if (query.toLowerCase().includes('quiz')) {
          aiResponse = `Here's a quick quiz based on your selected materials:\n\n1. What ion is primarily responsible for triggering neurotransmitter release?\n2. Describe the difference between EPSPs and IPSPs.\n\nReply with your answers!`;
        } else if (query.toLowerCase().includes('flashcards')) {
          aiResponse = `I can help you generate flashcards based on these documents. You can use the "Auto-Generate Cards" button inside the document preview for a more tailored experience, or I can list some Q&A pairs here for you to review manually.`;
        } else {
          aiResponse = `Looking at ${chatDocs.join(', ')}, I can see the material covers neural pathways and action potentials. Could you be more specific about what you're trying to learn or understand?`;
        }
      } else {
        aiResponse = "I am an AI assistant. Please select some resources from the list so I can analyze them for you, or ask me a general question about your studies.";
      }
      
      setMessages(prev => [...prev, { role: 'ai', content: aiResponse }]);
      setIsTyping(false);
    }, 1500);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    submitQuery(inputText.trim());
    setInputText('');
  };

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
        <div className="flex h-[calc(100vh-140px)] gap-6 relative">
          
          {/* File Space */}
          <div className="flex-1 bg-surface-container-lowest border border-white/5 rounded-2xl p-6 flex flex-col min-w-0">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h2 className="font-display font-bold text-white text-3xl mb-1.5 flex items-center gap-3">
                  <BookOpen className="w-7 h-7 text-primary-fixed-dim" />
                  Course Materials
                </h2>
                <p className="font-sans text-sm text-slate-400">View your connected course files and select them as context for the AI Assistant.</p>
              </div>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-full border border-emerald-500/30 uppercase tracking-widest font-bold flex items-center gap-1.5 shadow-sm">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></div> Sync Active
              </span>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 place-content-start pb-4">
              {docsList.map(doc => {
                const isSelectedForChat = chatDocs.includes(doc.name);
                const fileStyle = getFileIcon(doc.type);
                const Icon = fileStyle.icon;

                return (
                  <div 
                    key={doc.name}
                    className="relative group flex flex-col bg-surface-container border border-white/5 rounded-2xl overflow-hidden hover:border-white/20 transition-all cursor-pointer shadow-sm hover:shadow-xl hover:shadow-black/20"
                    onClick={() => openDoc(doc.name)}
                  >
                    {/* Checkbox overlay for chat context */}
                    <div 
                      className={`absolute top-3 left-3 z-10 p-1.5 rounded-lg transition-all border ${
                        isSelectedForChat 
                          ? 'bg-primary-fixed-dim/90 border-primary-fixed-dim text-white shadow-md' 
                          : 'bg-background/50 border-white/10 text-white/50 opacity-0 group-hover:opacity-100 hover:bg-background/80 hover:text-white backdrop-blur-sm'
                      }`}
                      onClick={(e) => toggleChatDoc(e, doc.name)}
                      title={isSelectedForChat ? "Remove from AI Context" : "Add to AI Context"}
                    >
                      {isSelectedForChat ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    </div>

                    {/* Document Preview Area (Abstract) */}
                    <div className="h-36 bg-surface-container-high/50 flex items-center justify-center relative overflow-hidden group-hover:bg-surface-container-high transition-colors">
                      <div className="absolute inset-x-8 top-6 bottom-[-20px] bg-surface-container-lowest rounded-t-lg shadow-md border border-white/10 flex flex-col p-4 space-y-3">
                        <div className="flex items-center gap-3">
                          <Icon className={`w-6 h-6 ${fileStyle.color}`} />
                          <div className="h-2.5 w-1/2 bg-white/10 rounded-full" />
                        </div>
                        <div className="space-y-2">
                           <div className="h-1.5 w-full bg-white/5 rounded-full" />
                           <div className="h-1.5 w-5/6 bg-white/5 rounded-full" />
                           <div className="h-1.5 w-4/6 bg-white/5 rounded-full" />
                           <div className="h-1.5 w-full bg-white/5 rounded-full" />
                        </div>
                      </div>
                    </div>

                    {/* Details */}
                    <div className="p-4 flex items-start gap-4">
                      <div className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center ${fileStyle.bg}`}>
                        <Icon className={`w-5 h-5 ${fileStyle.color}`} />
                      </div>
                      <div className="flex-1 min-w-0 pr-1 pt-0.5">
                        <p className="text-[13px] leading-tight font-medium text-white truncate mb-1 group-hover:text-primary-fixed-dim transition-colors">
                          {doc.name}
                        </p>
                        <p className="text-[11px] text-slate-500 font-medium tracking-wide">
                          {doc.date}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* AI Chat Panel - permanently visible */}
          <div className="w-[380px] xl:w-[420px] shrink-0 bg-surface-container-lowest border border-primary-fixed-dim/20 rounded-2xl flex flex-col relative overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="shrink-0 px-5 py-4 border-b border-white/10 flex flex-col gap-1 bg-gradient-to-r from-primary-fixed-dim/10 to-transparent">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-8 h-8 rounded-full bg-primary-fixed-dim/20 flex items-center justify-center border border-primary-fixed-dim/30 shadow-inner">
                  <Sparkles className="w-4 h-4 text-primary-fixed-dim" />
                </div>
                <div>
                  <h3 className="font-display font-medium text-white text-lg">Study Assistant</h3>
                </div>
              </div>
              <p className="font-sans text-xs text-slate-400 pl-11">
                Select documents from your materials to get summaries, quizzes, and specific answers.
              </p>
            </div>

            {/* Chat Message List */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6 no-scrollbar">
              <div className="flex gap-3">
                 <div className="shrink-0 w-8 h-8 rounded-full bg-primary-fixed-dim/20 flex items-center justify-center mt-1 border border-primary-fixed-dim/30">
                   <Bot className="w-4 h-4 text-primary-fixed-dim" />
                 </div>
                 <div className="flex-1 bg-surface-container border border-white/5 p-3.5 rounded-2xl rounded-tl-sm shadow-sm">
                   <p className="font-sans text-sm text-slate-200 leading-relaxed">
                     Hello! I'm ready to help you study. Try selecting a few documents from the left to include in my context!
                   </p>
                 </div>
              </div>

              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                  <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-1 border ${
                    msg.role === 'user' 
                      ? 'bg-surface-container-high border-white/10' 
                      : 'bg-primary-fixed-dim/20 border-primary-fixed-dim/30 shadow-sm'
                  }`}>
                    {msg.role === 'user' ? <User className="w-4 h-4 text-slate-300" /> : <Bot className="w-4 h-4 text-primary-fixed-dim" />}
                  </div>
                  <div className={`flex-1 p-3.5 rounded-2xl shadow-sm ${
                    msg.role === 'user' 
                      ? 'bg-surface-container-high border border-white/10 rounded-tr-sm text-white' 
                      : 'bg-surface-container border border-white/5 rounded-tl-sm text-slate-200'
                  }`}>
                    <p className="font-sans text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))}
              
              {isTyping && (
                <div className="flex gap-3 animate-in fade-in duration-300">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-primary-fixed-dim/20 border border-primary-fixed-dim/30 flex items-center justify-center mt-1 shadow-sm">
                    <Bot className="w-4 h-4 text-primary-fixed-dim" />
                  </div>
                  <div className="bg-surface-container border border-white/5 p-3.5 rounded-2xl rounded-tl-sm flex items-center gap-1.5 w-16 h-[46px] shadow-sm">
                     <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                     <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                     <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Quick Actions & Chat Input */}
            <div className="shrink-0 pt-0 p-4 border-t border-white/10 bg-surface-container/30">
              
              {chatDocs.length > 0 && (
                <div className="mb-4 space-y-3">
                  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-2">
                    <span className="shrink-0 text-[10px] uppercase font-bold text-slate-500 tracking-wider">Context:</span>
                    {chatDocs.map(doc => (
                      <span key={doc} className="px-2.5 py-1 rounded bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 text-primary-fixed-dim font-sans text-[11px] font-medium whitespace-nowrap flex items-center gap-1.5">
                         <FileText className="w-3 h-3" />
                         {doc.length > 20 ? doc.substring(0, 20) + '...' : doc}
                         <button 
                           onClick={(e) => toggleChatDoc(e, doc)}
                           className="ml-1 hover:text-white transition-colors"
                         >
                           <X className="w-3 h-3" />
                         </button>
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2">
                    <button 
                      onClick={() => submitQuery("Summarize the selected materials")}
                      className="shrink-0 px-3 py-1.5 rounded-lg border border-primary-fixed-dim/20 bg-primary-fixed-dim/5 text-primary-fixed text-xs font-semibold hover:bg-primary-fixed-dim/20 transition-all flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Summarize
                    </button>
                    <button 
                      onClick={() => submitQuery("Quiz me on these documents")}
                      className="shrink-0 px-3 py-1.5 rounded-lg border border-primary-fixed-dim/20 bg-primary-fixed-dim/5 text-primary-fixed text-xs font-semibold hover:bg-primary-fixed-dim/20 transition-all flex items-center gap-1.5"
                    >
                      <MessageSquare className="w-3.5 h-3.5" /> Quiz Me
                    </button>
                    <button 
                      onClick={() => submitQuery("What are the key terms in these documents?")}
                      className="shrink-0 px-3 py-1.5 rounded-lg border border-primary-fixed-dim/20 bg-primary-fixed-dim/5 text-primary-fixed text-xs font-semibold hover:bg-primary-fixed-dim/20 transition-all flex items-center gap-1.5"
                    >
                      <BookOpen className="w-3.5 h-3.5" /> Key Terms
                    </button>
                  </div>
                </div>
              )}

              <form onSubmit={handleSendMessage} className="relative mt-2">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Ask a question..."
                  className="w-full bg-surface-container-high border border-white/10 rounded-xl pl-4 pr-12 py-3.5 text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary-fixed-dim/50 font-sans text-sm shadow-inner"
                />
                <button 
                  type="submit"
                  disabled={!inputText.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-primary-fixed-dim text-on-primary-fixed rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-container transition-colors shadow-sm"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>

        </div>
      )}

      {/* Floating Document Viewer */}
      {selectedDoc && createPortal(
        <div className="fixed inset-0 z-[100] flex flex-col bg-background/95 backdrop-blur-md animate-in fade-in duration-200">
          <div className="shrink-0 px-6 py-4 flex items-center justify-between border-b border-white/10 bg-surface-container/50">
            <div className="flex items-center gap-4 min-w-0">
               <div className="w-12 h-12 rounded-xl bg-surface-container border border-white/10 flex items-center justify-center text-primary-fixed-dim shadow-sm">
                 <FileText className="w-6 h-6" />
               </div>
               <div>
                  <p className="font-sans text-sm text-slate-400 font-medium mb-0.5">Document Preview</p>
                  <p className="font-display text-xl text-white truncate font-semibold leading-none">{selectedDoc}</p>
               </div>
            </div>
            <div className="flex items-center gap-5 border border-white/10 p-1.5 rounded-xl bg-surface-container-high/50">
              <button 
                onClick={() => {
                  openDoc(null);
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
                className="shrink-0 px-4 py-2.5 bg-primary-fixed-dim/20 text-primary-fixed hover:bg-primary-fixed-dim hover:text-on-primary-fixed rounded-lg text-xs uppercase tracking-widest font-bold transition-all flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" /> Auto-Generate Cards
              </button>
              <button 
                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors tooltip-target"
                title="Download"
              >
                <Download className="w-5 h-5" />
              </button>
              <div className="w-px h-5 bg-white/20 mx-1"></div>
              <button 
                onClick={() => openDoc(null)}
                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
                title="Close Viewer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 md:p-12 flex justify-center w-full relative">
            <div 
              className="absolute inset-0 z-0" 
              onClick={() => openDoc(null)} 
            />
            
            {/* The Document "Paper" */}
            <div 
              className="w-full max-w-5xl bg-[#f8f9fa] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] rounded-lg flex flex-col z-10 animate-in slide-in-from-bottom-8 duration-500 min-h-full relative overflow-visible"
              onClick={(e) => e.stopPropagation()}
            >
              
              <div 
                className="flex-1 p-12 md:p-24 overflow-y-auto font-serif leading-relaxed text-slate-900 selection:bg-blue-200/50 selection:text-slate-900 pb-48 scroll-smooth"
                onMouseUp={handleSelection}
              >
                <div id="doc-content-wrapper" className="max-w-4xl mx-auto space-y-8 relative">
                  
                  {/* Highlight and Note Overlays */}
                  {docNotes.map(note => (
                    <React.Fragment key={note.id}>
                      {note.rects.map((rect, i) => (
                        <div
                          key={`${note.id}-rect-${i}`}
                          className={`absolute rounded-[2px] mix-blend-multiply transition-colors ${
                            note.type === 'note' 
                              ? 'bg-blue-300/40 border-b-2 border-blue-400 cursor-pointer hover:bg-blue-300/60' 
                              : note.type === 'ai'
                              ? 'bg-primary-fixed-dim/20 border-b-2 border-primary-fixed-dim cursor-pointer hover:bg-primary-fixed-dim/40'
                              : note.color
                          }`}
                          style={{
                            top: rect.top,
                            left: rect.left,
                            width: rect.width,
                            height: rect.height,
                            pointerEvents: note.type === 'note' || note.type === 'ai' ? 'auto' : 'none'
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (note.type === 'note' || note.type === 'ai') toggleNoteExpanded(note.id);
                          }}
                        />
                      ))}
                      
                      {note.type !== 'highlight' && (note.expanded || note.isEditing) && (
                        <div 
                          className="absolute z-40 w-72 bg-surface-container-highest border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                          style={{ 
                            top: Math.max(20, note.rects[0].top - 20), 
                            left: Math.min(note.rects[0].left + note.rects[0].width + 16, 700) 
                          }}
                          onClick={e => e.stopPropagation()}
                          onMouseUp={e => e.stopPropagation()}
                          onMouseDown={e => e.stopPropagation()}
                        >
                          <div className="px-4 py-3 border-b border-white/10 bg-primary-fixed-dim/10 flex items-center gap-2">
                             {note.type === 'ai' ? <Sparkles className="w-4 h-4 text-primary-fixed-dim shrink-0" /> : <MessageSquare className="w-4 h-4 text-primary-fixed-dim shrink-0" />}
                             <p className="font-sans text-[11px] font-semibold text-white/80 line-clamp-2 italic leading-relaxed">"{note.selectedText}"</p>
                          </div>
                          <div className="p-4 flex flex-col gap-3 max-h-[350px] overflow-y-auto no-scrollbar">
                            {note.type === 'ai' && note.aiChat && note.aiChat.map((msg, i) => (
                                <div key={i} className={`p-3 rounded-lg border ${
                                  msg.role === 'user' 
                                    ? 'bg-surface-container-high border-white/10 text-white' 
                                    : 'bg-primary-fixed-dim/10 border-primary-fixed-dim/20 text-white'
                                } text-sm relative shrink-0`}>
                                  <div className={`flex items-center gap-2 mb-1.5 ${msg.role === 'user' ? 'opacity-50' : 'text-primary-fixed-dim'}`}>
                                    {msg.role === 'user' ? <User className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                                    <span className="text-xs">{msg.role === 'user' ? 'You' : 'AI Assistant'}</span>
                                  </div>
                                  <p className="leading-relaxed text-sm whitespace-pre-wrap">{msg.content}</p>
                                </div>
                            ))}

                            {note.isAiLoading && note.type === 'ai' && (
                                <div className="p-3 bg-primary-fixed-dim/10 rounded-lg flex items-center gap-2 shrink-0">
                                  <Bot className="w-4 h-4 text-primary-fixed-dim animate-pulse" />
                                  <span className="text-sm text-primary-fixed-dim animate-pulse">Thinking...</span>
                                </div>
                            )}

                            {note.isEditing ? (
                              <textarea
                                autoFocus
                                className="w-full bg-background border border-white/10 rounded-lg p-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-primary-fixed-dim/50 min-h-[90px] resize-y font-sans shadow-inner shrink-0"
                                placeholder={note.type === 'ai' ? "Ask AI about this phrase..." : "Type your note here..."}
                                defaultValue={note.type !== 'ai' ? note.noteText : ''}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    if (e.currentTarget.value.trim()) {
                                        if (note.type === 'ai') {
                                          submitAiPrompt(note.id, e.currentTarget.value);
                                        } else {
                                          saveNote(note.id, e.currentTarget.value);
                                        }
                                        e.currentTarget.value = '';
                                    }
                                  }
                                }}
                                onBlur={(e) => {
                                  if (note.type !== 'ai') saveNote(note.id, e.currentTarget.value);
                                }}
                              />
                            ) : note.type !== 'ai' && (
                              <div className="relative group cursor-pointer shrink-0" onClick={() => editNote(note.id)}>
                                <p className="font-sans text-sm leading-relaxed text-slate-300 whitespace-pre-wrap">{note.noteText}</p>
                                <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 p-1.5 bg-surface-container rounded-lg backdrop-blur transition-opacity shadow-lg border border-white/10">
                                  <Edit3 className="w-4 h-4 text-slate-400" />
                                </div>
                              </div>
                            )}
                          </div>
                          {!note.isEditing && note.type !== 'ai' && (
                            <div className="px-4 py-2 border-t border-white/5 flex justify-end bg-surface-container/50">
                               <button onClick={() => deleteNote(note.id)} className="text-[10px] text-red-400/80 hover:text-red-400 uppercase tracking-widest font-semibold flex items-center gap-1.5 transition-colors">
                                 <Trash2 className="w-3 h-3" /> Delete Note
                               </button>
                            </div>
                          )}
                          {!note.isEditing && note.type === 'ai' && !note.isAiLoading && (
                            <div className="px-4 py-2 border-t border-white/5 flex justify-between items-center bg-surface-container/50">
                               <button onClick={() => editNote(note.id)} className="text-[10px] text-slate-400 hover:text-white uppercase tracking-widest font-semibold flex items-center gap-1.5 transition-colors">
                                 <MessageSquare className="w-3 h-3" /> Follow up
                               </button>
                               <button onClick={() => deleteNote(note.id)} className="text-[10px] text-red-400/80 hover:text-red-400 uppercase tracking-widest font-semibold flex items-center gap-1.5 transition-colors">
                                 <Trash2 className="w-3 h-3" /> Delete
                               </button>
                            </div>
                          )}
                        </div>
                      )}
                    </React.Fragment>
                  ))}

                  {/* Selection Toolbar */}
                  {selectionPos && (
                    <div 
                      className="absolute z-50 flex items-center bg-surface-container-highest border border-white/10 rounded-lg shadow-[0_10px_40px_-10px_rgba(0,0,0,0.8)] overflow-hidden transform transition-all animate-in zoom-in-95 duration-200"
                      style={{ top: selectionPos.top, left: selectionPos.left }}
                      onMouseUp={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <button onClick={() => addDocNote('highlight', 'bg-yellow-400/50')} className="p-3 hover:bg-white/10 text-yellow-500 transition-colors tooltip-target" title="Highlight Yellow">
                        <Highlighter className="w-[18px] h-[18px]" />
                      </button>
                      <button onClick={() => addDocNote('highlight', 'bg-emerald-400/50')} className="p-3 hover:bg-white/10 text-emerald-500 transition-colors tooltip-target" title="Highlight Green">
                        <Highlighter className="w-[18px] h-[18px]" />
                      </button>
                      <div className="w-px h-6 bg-white/10 mx-1"></div>
                      <button onClick={() => addDocNote('note', 'border-blue-500/50')} className="px-4 py-2.5 hover:bg-white/10 text-primary-fixed-dim transition-colors tooltip-target font-sans text-xs font-bold flex items-center gap-2" title="Add Note">
                        <MessageSquare className="w-4 h-4" /> Add Note
                      </button>
                      <div className="w-px h-6 bg-white/10 mx-1"></div>
                      <button onClick={() => addDocNote('ai', 'border-primary-fixed-dim/50')} className="px-4 py-2.5 hover:bg-white/10 text-primary-fixed-dim transition-colors tooltip-target font-sans text-xs font-bold flex items-center gap-2" title="Ask AI">
                        <Sparkles className="w-4 h-4" /> Ask AI
                      </button>
                    </div>
                  )}

                  <header className="border-b border-slate-300 pb-8 mb-12">
                    <h1 className="text-4xl md:text-5xl font-bold text-slate-900 tracking-tight mb-4">{selectedDoc.split('.')[0].replace(/_/g, ' ')}</h1>
                    <p className="text-slate-500 font-sans text-sm uppercase tracking-widest">Biology 301 • Fall 2026</p>
                  </header>
                  
                  <h2 className="text-2xl font-bold text-slate-800">4.1 Synaptic Transmission Overview</h2>
                  <p className="text-lg text-slate-700">
                    Synaptic transmission is the biological process by which a neuron communicates with a target cell across a synapse. Chemical synaptic transmission involves the release of a neurotransmitter from the pre-synaptic neuron...
                  </p>
                  <p className="text-lg text-slate-700">
                    Upon the arrival of an action potential at the presynaptic terminal, voltage-gated calcium channels open, allowing an influx of Ca2+ ions. This calcium entry signals synaptic vesicles to fuse with the presynaptic membrane, emptying their neurotransmitter contents into the synaptic cleft.
                  </p>
                  
                  <div className="my-12 py-12 border-y border-slate-200">
                     <p className="text-center italic text-slate-400 font-sans text-sm">Figure 1: Synaptic cleft diagram (Image missing in preview)</p>
                  </div>

                  <h3 className="text-2xl font-bold text-slate-800">4.2 Neurotransmitters</h3>
                  <p className="text-lg text-slate-700">
                    Neurotransmitters are endogenous chemicals that enable neurotransmission. It is a type of chemical messenger which transmits signals across a chemical synapse, such as a neuromuscular junction, from one neuron to another "target" neuron, muscle cell, or gland cell.
                  </p>
                  
                  <div className="mt-20 p-8 rounded bg-slate-100 border border-slate-200 flex items-center justify-center">
                    <p className="text-slate-500 italic font-sans text-sm text-center">
                      End of simulated preview.<br/>In a real environment, this would render the actual PDF, DOCX, or PPTX file contents.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}

