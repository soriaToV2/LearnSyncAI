import React, { useState, useRef, useEffect } from 'react';
import { Link as LinkIcon, FileText, CheckCircle2, MessageSquare, Send, Sparkles, User, BrainCircuit, Loader2 } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';

interface FlashcardSet {
  id: number;
  title: string;
  cardCount: number;
  cards: any[];
}

interface ResourcesTabProps {
  courseConnected: boolean;
  selectedDocs: string[];
  handleConnectCourse: () => void;
  setSelectedDocs: React.Dispatch<React.SetStateAction<string[]>>;
  setActiveTab: (tab: 'flashcards' | 'resources') => void;
  setIsGenerating: (isGenerating: boolean) => void;
  setSelectedSetContent: (id: number | null) => void;
  setFlashcardSets: React.Dispatch<React.SetStateAction<FlashcardSet[]>>;
}

interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
}

export default function ResourcesTab({
  courseConnected,
  selectedDocs,
  handleConnectCourse,
  setSelectedDocs,
  setActiveTab,
  setIsGenerating,
  setSelectedSetContent,
  setFlashcardSets
}: ResourcesTabProps) {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'model', content: "Hello! I'm your EduSpace AI assistant. Select documents from the left to include them in our context, then ask me anything or tell me to summarize them!" }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const toggleDocument = (doc: string) => {
    setSelectedDocs(prev => 
      prev.includes(doc) 
        ? prev.filter(d => d !== doc)
        : [...prev, doc]
    );
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      // Setup context message implicitly
      const contextPrefix = selectedDocs.length > 0 
        ? `[Context: The user has selected the following resources: ${selectedDocs.join(', ')}.] ` 
        : '';
        
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `${contextPrefix}${userMessage}`,
      });

      setMessages(prev => [...prev, { 
        id: Date.now().toString(), 
        role: 'model', 
        content: response.text || "I couldn't generate a response." 
      }]);
    } catch (error) {
      console.error("AI Generation Error", error);
      setMessages(prev => [...prev, { 
        id: Date.now().toString(), 
        role: 'model', 
        content: "Sorry, I ran into an error connecting to the AI service. Please check your API key or try again." 
      }]);
    } finally {
      setIsLoading(false);
    }
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
        <div className="flex h-[calc(100vh-140px)] gap-6">
          
          {/* File Selection Sidebar */}
          <div className="w-1/3 bg-surface-container-lowest border border-white/5 rounded-2xl p-4 flex flex-col">
            <div className="px-2 py-3 mb-4 space-y-1">
              <div className="flex justify-between items-center">
                <span className="font-display font-medium text-white text-lg">Course Materials</span>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded-full border border-emerald-500/30 uppercase tracking-widest font-semibold flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div> Connected
                </span>
              </div>
              <p className="text-xs text-slate-400 font-sans">Select files to include in AI context</p>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-2 space-y-2">
              {['Synaptic_Pathways_Ch4.pdf', 'Lecture_03_Action_Potentials.pptx', 'Study_Guide_Midterm.docx'].map(doc => {
                const isSelected = selectedDocs.includes(doc);
                return (
                  <button 
                    key={doc}
                    onClick={() => toggleDocument(doc)}
                    className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-all text-left relative overflow-hidden ${
                      isSelected 
                        ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim/30' 
                        : 'bg-surface-container border-white/5 hover:border-white/20'
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute top-0 right-0 w-full h-full border-2 border-primary-fixed-dim rounded-xl pointer-events-none opacity-50"></div>
                    )}
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                      isSelected ? 'bg-primary-fixed-dim/20 text-primary-fixed-dim' : 'bg-surface-container-high text-slate-400'
                    }`}>
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="overflow-hidden flex-1">
                      <p className={`font-sans text-sm font-medium truncate ${isSelected ? 'text-primary-fixed' : 'text-white'}`}>
                        {doc}
                      </p>
                      <p className="font-sans text-xs text-slate-500 truncate mt-1">Found in Biology 301</p>
                    </div>
                    {isSelected && (
                      <CheckCircle2 className="w-5 h-5 text-primary-fixed-dim shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* AI Chat Interface */}
          <div className="flex-1 bg-surface-container-lowest border border-white/5 rounded-2xl flex flex-col relative overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between border-b border-white/5 bg-surface-container/30 shrink-0">
               <div className="flex items-center gap-3">
                 <div className="w-10 h-10 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center shadow-[0_0_15px_rgba(0,218,243,0.2)]">
                   <BrainCircuit className="w-5 h-5" />
                 </div>
                 <div>
                   <h3 className="font-display text-white font-medium">EduSpace Copilot</h3>
                   <p className="font-sans text-xs text-primary-fixed-dim">
                     {selectedDocs.length} document{selectedDocs.length !== 1 ? 's' : ''} connected
                   </p>
                 </div>
               </div>
               {selectedDocs.length > 0 && (
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
                           title: `Generated from ${selectedDocs.length} file(s)`,
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
                   <Sparkles className="w-3.5 h-3.5" /> Generate Flashcards
                 </button>
               )}
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-gradient-to-b from-white/[0.01] to-transparent bg-fixed">
              {messages.map((message) => (
                <div 
                  key={message.id} 
                  className={`flex gap-4 max-w-[85%] ${message.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}
                >
                  <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex shrink-0 items-center justify-center ${message.role === 'user' ? 'bg-surface-container-high border border-white/10' : 'bg-primary-container/80 text-on-primary-container shadow-lg shadow-primary-container/20'}`}>
                    {message.role === 'user' ? <User className="w-4 h-4 sm:w-5 sm:h-5 text-slate-300" /> : <BrainCircuit className="w-4 h-4 sm:w-5 sm:h-5" />}
                  </div>
                  <div className={`p-4 rounded-2xl ${
                    message.role === 'user' 
                      ? 'bg-surface-container-high border border-white/5 text-white' 
                      : 'bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 text-slate-200'
                  }`}>
                    <p className="font-sans text-sm sm:text-base leading-relaxed whitespace-pre-wrap">{message.content}</p>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-4 max-w-[85%]">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-primary-container/80 text-on-primary-container flex items-center justify-center">
                    <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                  </div>
                  <div className="p-4 rounded-2xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 text-slate-300 flex items-center">
                    <span className="flex gap-1 items-center">
                      <span className="w-1.5 h-1.5 bg-primary-fixed-dim rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                      <span className="w-1.5 h-1.5 bg-primary-fixed-dim rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                      <span className="w-1.5 h-1.5 bg-primary-fixed-dim rounded-full animate-bounce"></span>
                    </span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-surface-container/50 border-t border-white/5 backdrop-blur-md">
              <form onSubmit={handleSendMessage} className="relative">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={selectedDocs.length > 0 ? "Ask a question about the selected files..." : "Select files first, or chat with me generally..."}
                  className="w-full bg-surface-container-high border border-white/10 rounded-full pl-6 pr-14 py-4 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/50 focus:border-primary-fixed-dim transition-all shadow-inner"
                />
                <button 
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  className="absolute right-2 top-2 p-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-full hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_15px_rgba(0,218,243,0.2)]"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
              <p className="text-center text-[10px] text-slate-500 mt-3 font-sans tracking-wide">
                EduSpace AI Copilot can make mistakes. Consider verifying important information.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
