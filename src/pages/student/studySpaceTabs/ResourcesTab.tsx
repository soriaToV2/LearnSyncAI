import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link as LinkIcon, FileText, BookOpen, Sparkles, MessageSquare, Send, CheckSquare, Square, X, Bot, User, FileImage, Download, Highlighter, Trash2, Edit3 } from 'lucide-react';
import Modal from '../../../components/ui/Modal';

// Sample document text used for annotation features (no external deps).

const SIM_CONTENT: Record<string, { title: string; pages: { label: string; body: string }[] }> = {
  'pdf': {
    title: '',
    pages: [
      {
        label: 'Introduction',
        body: `Information and Communication Technology (ICT) has become an essential pillar of modern society. From healthcare and education to commerce and governance, digital systems permeate every facet of daily life. With this pervasive integration comes a growing set of ethical responsibilities for the professionals who design, implement, and maintain these systems.

The scope of IT professional responsibility extends well beyond technical competence. Practitioners must navigate complex issues involving data privacy, equitable access, cybersecurity, intellectual property, and the societal impact of algorithmic decision-making. These challenges require not only technical skill but also moral judgment, legal literacy, and a commitment to the public good.

This document explores the evolving landscape of IT professional responsibilities in the modern era, drawing on established codes of conduct, emerging regulatory frameworks, and real-world case studies. It argues that the next generation of IT professionals must adopt a holistic view of their role—one that places ethical practice alongside technical excellence.`,
      },
      {
        label: 'Core Responsibilities',
        body: `1. Data Privacy and Protection

IT professionals routinely handle sensitive personal and organizational data. A core responsibility is to ensure this data is collected lawfully, stored securely, and used only for stated purposes. Key principles include:
  • Minimizing data collection to what is strictly necessary
  • Implementing strong encryption and access controls
  • Complying with regulations such as the GDPR, PDPA, and CCPA
  • Promptly disclosing breaches to affected parties

2. Security Engineering

Systems must be designed with security as a foundational concern, not an afterthought. Professionals should conduct threat modeling, perform regular vulnerability assessments, and apply secure coding practices throughout the software development lifecycle (SDLC).

3. Transparency and Accountability

Developing AI and automated decision systems creates obligations around explainability. When algorithms affect hiring, credit scoring, or medical diagnoses, professionals must ensure stakeholders can understand and contest outcomes. Documentation, audit trails, and independent reviews are essential safeguards.`,
      },
      {
        label: 'Emerging Challenges',
        body: `The rapid pace of technological change continuously introduces new ethical frontiers:

Artificial Intelligence and Bias — Machine learning models trained on historical data can perpetuate or amplify existing societal biases. IT professionals must rigorously test models for disparate impact and implement corrective measures before deployment.

Environmental Impact — Large-scale data centers consume significant energy. Professionals have a responsibility to design efficient systems, advocate for renewable energy sources, and measure carbon footprints transparently.

Digital Inclusion — As essential services migrate online, the digital divide becomes an equity issue. Developers must consider accessibility standards (WCAG), support low-bandwidth environments, and design for diverse user populations.

Intellectual Property — Open-source usage, software patents, and licensing compliance require vigilance. Professionals must respect the IP rights of others and contribute fairly to open communities they benefit from.`,
      },
      {
        label: 'Conclusion',
        body: `The responsibilities of IT professionals have never been greater. Society's dependence on digital infrastructure means that the decisions made by software engineers, system architects, and data scientists carry real-world consequences for millions of people.

Meeting these responsibilities requires a commitment to continuous learning, active participation in professional communities, and a willingness to speak up when ethical concerns arise—even when doing so is professionally uncomfortable.

Code of ethics from organizations such as the ACM, IEEE, and ISACA provide valuable frameworks, but ultimately the burden falls on individual professionals to internalize these principles and apply them with integrity in every project they undertake.

The future of technology is being written today. IT professionals have the opportunity—and the obligation—to ensure that future is equitable, secure, and worthy of public trust.`,
      },
    ],
  },
  'pptx': {
    title: '',
    pages: [
      {
        label: 'Slide 1 — Title',
        body: 'Errors, Failures, and Risks in IT Systems\n\nUnderstanding how and why digital systems fail — and how to prevent, detect, and respond to failures responsibly.\n\nDepartment of Information Technology · Academic Year 2025–2026',
      },
      {
        label: 'Slide 2 — Key Definitions',
        body: 'ERRORS vs. FAILURES vs. RISKS\n\n▸ Error — A human mistake that introduces a defect into a system (e.g., off-by-one bug, incorrect assumption in a requirement).\n\n▸ Failure — When a system deviates from its specified behavior during operation. A failure is usually caused by one or more latent errors.\n\n▸ Risk — The probability that a threat will exploit a vulnerability, multiplied by the impact of that exploitation. Risk = Likelihood × Impact.',
      },
      {
        label: 'Slide 3 — Taxonomy of Errors',
        body: 'Classification of Software Errors:\n\n1. Syntactic Errors — Violations of language grammar; caught by compilers or linters.\n2. Semantic Errors — Code is syntactically correct but produces unintended behavior.\n3. Logic Errors — Flawed algorithm or decision-making leads to wrong outputs.\n4. Runtime Errors — Faults that manifest only during execution (e.g., null pointer, stack overflow).\n5. Specification Errors — Misunderstanding of requirements causes the system to solve the wrong problem.',
      },
      {
        label: 'Slide 4 — Failure Modes',
        body: 'Common Failure Modes:\n\n• Hardware Failure — Physical degradation of storage, network, or compute components.\n• Software Fault — Bugs that were not caught during testing.\n• Human Error — Misconfiguration, accidental deletion, phishing victim.\n• Environmental Failure — Power outages, natural disasters disrupting infrastructure.\n• Dependency Failure — Third-party service or library becomes unavailable.\n\nKey Insight: Most catastrophic failures involve a chain of smaller failures amplified by inadequate safeguards.',
      },
      {
        label: 'Slide 5 — Risk Management',
        body: 'The Risk Management Process:\n\n1. Identify — Enumerate all potential threats and vulnerabilities.\n2. Assess — Evaluate likelihood and impact for each risk.\n3. Prioritize — Focus resources on high-risk items first.\n4. Mitigate — Apply controls: redundancy, monitoring, patching, training.\n5. Monitor — Continuously observe system state and adjust controls.\n6. Review — After incidents, conduct post-mortems to update the risk register.',
      },
    ],
  },
  'default': {
    title: '',
    pages: [
      {
        label: 'Overview',
        body: `This document covers fundamental concepts in computer science and information technology. Topics include system design principles, data structures, algorithmic complexity, and software engineering best practices.

Through careful study of these foundations, students will develop the analytical skills necessary to solve complex technical problems and design robust, scalable systems. The material progresses from theoretical foundations to practical applications, emphasizing both depth of understanding and breadth of knowledge.`,
      },
      {
        label: 'Core Concepts',
        body: `Data Structures and Algorithms form the backbone of efficient software. A thorough understanding of arrays, linked lists, trees, graphs, hash tables, and heaps—along with their associated algorithms—is essential for any practitioner.

Time and Space Complexity analysis using Big-O notation allows engineers to reason about the scalability of their solutions. An algorithm that runs in O(n log n) time is fundamentally more scalable than one running in O(n²), which becomes critical when working with large datasets.

Design Patterns provide reusable solutions to common architectural problems. Familiarity with creational, structural, and behavioral patterns enables developers to communicate solutions clearly and avoid reinventing the wheel.`,
      },
      {
        label: 'Systems and Architecture',
        body: `Modern software systems are rarely monolithic. Distributed systems, microservices, and cloud-native architectures require a deep understanding of network protocols, consistency models, and fault tolerance strategies.

The CAP Theorem states that a distributed system can guarantee only two of three properties simultaneously: Consistency, Availability, and Partition Tolerance. System architects must make deliberate trade-offs based on the requirements of each application domain.

Databases — both relational and NoSQL — are central to nearly every application. Understanding ACID properties, transaction isolation levels, indexing strategies, and query optimization is crucial for building performant, reliable data-driven applications.`,
      },
    ],
  },
};

function getSimContent(docName: string) {
  if (docName.endsWith('.pptx')) {
    const c = { ...SIM_CONTENT['pptx'] };
    c.title = docName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    return c;
  }
  if (docName.endsWith('.pdf')) {
    const c = { ...SIM_CONTENT['pdf'] };
    c.title = docName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    return c;
  }
  const c = { ...SIM_CONTENT['default'] };
  c.title = docName.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  return c;
}

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
  description?: string;
  cardCount: number;
  cards: Flashcard[];
  isPublic: boolean;
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
  { name: 'Activity-2-The-Frozen-Identity.pdf', type: 'pdf', date: 'May 16, 2026' },
  { name: 'Blue and Purple Modern Future Technology Presentation.pdf', type: 'pdf', date: 'May 16, 2026' },
  { name: 'Chapter 7 - XPath-Syntax and Node_Principles.pdf', type: 'pdf', date: 'May 16, 2026' },
  { name: 'ERRORS-FAILURES-AND-RISKS.pptx', type: 'pptx', date: 'May 16, 2026' },
  { name: 'Future_Responsibilities_IT_Professionals_Enhanced.pptx', type: 'pptx', date: 'May 16, 2026' },
  { name: 'future_responsibilities_of_it_professionals.pdf', type: 'pdf', date: 'May 16, 2026' },
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

// DocViewer: Simulated document viewer with annotation support
interface DocViewerProps {
  selectedDoc: string;
  docNotes: DocNote[];
  updateDocNotes: (updater: (prev: DocNote[]) => DocNote[]) => void;
  openDoc: (doc: string | null) => void;
  setActiveTab: (tab: 'flashcards' | 'resources') => void;
  setIsGenerating: (v: boolean) => void;
  setSelectedSetContent: (id: number | null) => void;
  setFlashcardSets: React.Dispatch<React.SetStateAction<FlashcardSet[]>>;
  submitAiPrompt: (id: string, text: string) => void;
  saveNote: (id: string, text: string) => void;
  editNote: (id: string) => void;
  deleteNote: (id: string) => void;
  toggleNoteExpanded: (id: string) => void;
}

function DocViewer({
  selectedDoc,
  docNotes,
  updateDocNotes,
  openDoc,
  submitAiPrompt,
  saveNote,
  editNote,
  deleteNote,
  toggleNoteExpanded,
}: DocViewerProps) {
  // Simulated content
  const simContent = getSimContent(selectedDoc);

  const [selectionPos, setSelectionPos] = useState<{
    top: number; left: number; width: number; text: string; rects: HighlightRect[];
  } | null>(null);

  const fileExt = selectedDoc.split('.').pop()?.toUpperCase() ?? 'FILE';
  const isPptx = selectedDoc.endsWith('.pptx');

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
            height: rect.height,
          }));
          if (relativeRects.length > 0) {
            setSelectionPos({
              top: relativeRects[0].top - 52,
              left: relativeRects[0].left + relativeRects[0].width / 2 - 90,
              width: relativeRects[0].width,
              rects: relativeRects,
              text: sel.toString().trim(),
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
      expanded: type === 'note' || type === 'ai',
    };
    updateDocNotes(prev => [...prev, newNote]);
    setSelectionPos(null);
    window.getSelection()?.removeAllRanges();
  };



  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background/95 backdrop-blur-md animate-in fade-in duration-200">
      {/* Top Bar */}
      <div className="shrink-0 px-6 py-4 flex items-center justify-between border-b border-white/10 bg-surface-container/50">
        <div className="flex items-center gap-4 min-w-0">
          <div className={`w-12 h-12 rounded-xl border flex items-center justify-center shadow-sm ${
            isPptx ? 'bg-orange-500/20 border-orange-500/30 text-orange-400' : 'bg-red-500/20 border-red-500/30 text-red-400'
          }`}>
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <p className="font-sans text-sm text-slate-400 font-medium mb-0.5">Course Document · {fileExt}</p>
            <p className="font-display text-xl text-white truncate font-semibold leading-none">{simContent.title}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 border border-white/10 p-1.5 rounded-xl bg-surface-container-high/50">
          <span className="px-3 py-1.5 text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg font-bold uppercase tracking-wider flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Select text to annotate
          </span>
          <a
            href={`/assets/${selectedDoc}`}
            download
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
            title="Download original file"
          >
            <Download className="w-5 h-5" />
          </a>
          <div className="w-px h-5 bg-white/20" />
          <button
            onClick={() => openDoc(null)}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
            title="Close Viewer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-6 md:p-12 flex justify-center items-start w-full">
          {/* The white "paper" document */}
          <div
            className="w-full max-w-4xl bg-[#f8f9fa] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] rounded-lg z-10 animate-in slide-in-from-bottom-8 duration-500 relative h-fit mb-20"
            onClick={e => e.stopPropagation()}
          >
            <div
              className="p-10 md:p-16 font-serif leading-relaxed text-slate-900 selection:bg-blue-200/60 selection:text-slate-900 scroll-smooth"
              onMouseUp={handleSelection}
            >
              <div id="doc-content-wrapper" className="max-w-full mx-auto relative">

                {/* ── Highlight & Note Overlays (rendered on top of text) ── */}
                {docNotes.map(note => (
                  <React.Fragment key={note.id}>
                    {note.rects.map((rect, i) => (
                      <div
                        key={`${note.id}-rect-${i}`}
                        className={`absolute rounded-[2px] cursor-pointer pointer-events-auto mix-blend-multiply transition-colors hover:brightness-95 ${
                          note.type === 'note'
                            ? 'bg-blue-300/50 border-b-2 border-blue-500'
                            : note.type === 'ai'
                            ? 'bg-violet-300/40 border-b-2 border-violet-500'
                            : note.color
                        }`}
                        style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleNoteExpanded(note.id);
                        }}
                      />
                    ))}

                    {/* Inline note/AI popup */}
                    {note.type !== 'highlight' && (note.expanded || note.isEditing) && note.rects.length > 0 && (
                      <div
                        className="absolute z-40 w-80 bg-surface-container-highest border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                        style={{
                          top: Math.max(20, note.rects[0].top - 20),
                          left: Math.min(note.rects[0].left + note.rects[0].width + 16, 600),
                        }}
                        onClick={e => e.stopPropagation()}
                        onMouseUp={e => e.stopPropagation()}
                        onMouseDown={e => e.stopPropagation()}
                      >
                        <div className="px-4 py-3 border-b border-white/10 bg-primary-fixed-dim/10 flex items-center gap-2">
                          {note.type === 'ai'
                            ? <Sparkles className="w-4 h-4 text-primary-fixed-dim shrink-0" />
                            : <MessageSquare className="w-4 h-4 text-blue-400 shrink-0" />}
                          <p className="font-sans text-[11px] font-semibold text-white/80 line-clamp-2 italic leading-relaxed">
                            &ldquo;{note.selectedText}&rdquo;
                          </p>
                          <button
                            onClick={() => deleteNote(note.id)}
                            className="ml-auto p-1 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="p-4 flex flex-col gap-3 max-h-[350px] overflow-y-auto">
                          {/* AI chat messages */}
                          {note.type === 'ai' && note.aiChat?.map((msg, i) => (
                            <div key={i} className={`p-3 rounded-lg border text-sm ${
                              msg.role === 'user'
                                ? 'bg-surface-container-high border-white/10 text-white'
                                : 'bg-primary-fixed-dim/10 border-primary-fixed-dim/20 text-white'
                            }`}>
                              <div className={`flex items-center gap-2 mb-1.5 text-[11px] font-bold uppercase tracking-wider ${msg.role === 'user' ? 'text-slate-500' : 'text-primary-fixed-dim'}`}>
                                {msg.role === 'user' ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                                {msg.role === 'user' ? 'You' : 'AI Assistant'}
                              </div>
                              <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                            </div>
                          ))}
                          {note.isAiLoading && (
                            <div className="p-3 bg-primary-fixed-dim/10 rounded-lg flex items-center gap-2">
                              <Bot className="w-4 h-4 text-primary-fixed-dim animate-pulse" />
                              <span className="text-sm text-primary-fixed-dim animate-pulse">Thinking...</span>
                            </div>
                          )}

                          {/* Note text */}
                          {note.type === 'note' && !note.isEditing && note.noteText && (
                            <div className="relative group cursor-pointer" onClick={() => editNote(note.id)}>
                              <p className="font-sans text-sm leading-relaxed text-slate-300 whitespace-pre-wrap">{note.noteText}</p>
                              <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 p-1.5 bg-surface-container rounded-lg border border-white/10 transition-opacity">
                                <Edit3 className="w-3.5 h-3.5 text-slate-400" />
                              </div>
                            </div>
                          )}

                          {/* Note edit textarea */}
                          {note.type === 'note' && note.isEditing && (
                            <NoteEditor
                              initialValue={note.noteText}
                              onSave={text => saveNote(note.id, text)}
                              onCancel={() => saveNote(note.id, note.noteText)}
                            />
                          )}

                          {/* AI ask input */}
                          {note.type === 'ai' && !note.isAiLoading && (
                            <AiInput onSubmit={text => submitAiPrompt(note.id, text)} />
                          )}
                        </div>

                        {!note.isEditing && note.type === 'note' && (
                          <div className="px-4 py-2 border-t border-white/5 flex justify-between bg-surface-container/50">
                            <button onClick={() => editNote(note.id)} className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1 font-bold uppercase tracking-widest transition-colors">
                              <Edit3 className="w-3 h-3" /> Edit
                            </button>
                            <button onClick={() => deleteNote(note.id)} className="text-[10px] text-red-400/80 hover:text-red-400 flex items-center gap-1 font-bold uppercase tracking-widest transition-colors">
                              <Trash2 className="w-3 h-3" /> Delete
                            </button>
                          </div>
                        )}
                        {!note.isEditing && note.type === 'ai' && !note.isAiLoading && (
                          <div className="px-4 py-2 border-t border-white/5 flex justify-between bg-surface-container/50">
                            <button onClick={() => toggleNoteExpanded(note.id)} className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1 font-bold uppercase tracking-widest transition-colors">
                              <MessageSquare className="w-3 h-3" /> Follow up
                            </button>
                            <button onClick={() => deleteNote(note.id)} className="text-[10px] text-red-400/80 hover:text-red-400 flex items-center gap-1 font-bold uppercase tracking-widest transition-colors">
                              <Trash2 className="w-3 h-3" /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </React.Fragment>
                ))}

                {/* ── Floating Selection Toolbar ── */}
                {selectionPos && (
                  <div
                    className="absolute z-50 flex items-center bg-surface-container-highest border border-white/10 rounded-xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.9)] overflow-hidden animate-in zoom-in-95 duration-150"
                    style={{ top: selectionPos.top, left: selectionPos.left }}
                    onMouseUp={e => e.stopPropagation()}
                    onMouseDown={e => e.stopPropagation()}
                  >
                    <button
                      onClick={() => addDocNote('highlight', 'bg-yellow-400/60')}
                      className="p-3 hover:bg-white/10 text-yellow-500 transition-colors"
                      title="Highlight Yellow"
                    >
                      <Highlighter className="w-[18px] h-[18px]" />
                    </button>
                    <button
                      onClick={() => addDocNote('highlight', 'bg-emerald-400/60')}
                      className="p-3 hover:bg-white/10 text-emerald-500 transition-colors"
                      title="Highlight Green"
                    >
                      <Highlighter className="w-[18px] h-[18px]" />
                    </button>
                    <div className="w-px h-6 bg-white/10" />
                    <button
                      onClick={() => addDocNote('note', 'bg-blue-400/30')}
                      className="px-4 py-2.5 hover:bg-white/10 text-blue-400 font-sans text-xs font-bold flex items-center gap-2 transition-colors"
                      title="Add Note"
                    >
                      <MessageSquare className="w-4 h-4" /> Note
                    </button>
                    <div className="w-px h-6 bg-white/10" />
                    <button
                      onClick={() => addDocNote('ai', 'bg-violet-400/30')}
                      className="px-4 py-2.5 hover:bg-white/10 text-primary-fixed-dim font-sans text-xs font-bold flex items-center gap-2 transition-colors"
                      title="Ask AI"
                    >
                      <Sparkles className="w-4 h-4" /> Ask AI
                    </button>
                  </div>
                )}

                {/* ── Document Title Header ── */}
                <header className="border-b border-slate-300 pb-8 mb-10">
                  <div className="flex items-center gap-3 mb-3">
                    <span className={`px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider ${
                      isPptx ? 'bg-orange-100 text-orange-600' : 'bg-red-100 text-red-600'
                    }`}>{fileExt}</span>
                    <span className="text-xs text-slate-400 font-sans">{simContent.pages.length} {isPptx ? 'slides' : 'pages'}</span>
                  </div>
                  <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight mb-2 leading-tight">
                    {simContent.title}
                  </h1>
                  <p className="text-slate-500 font-sans text-sm">
                    Select any passage to <span className="text-yellow-600 font-semibold">highlight</span>, add a <span className="text-blue-600 font-semibold">note</span>, or <span className="text-violet-600 font-semibold">ask AI</span>.
                  </p>
                </header>

                {/* ── Simulated page/slide sections ── */}
                {simContent.pages.map((page, idx) => (
                  <section key={idx} className="mb-10 pb-10 border-b border-slate-200 last:border-0">
                    <div className="flex items-center gap-3 mb-4">
                      <span className={`text-[10px] font-sans uppercase tracking-widest font-semibold ${
                        isPptx ? 'text-orange-500' : 'text-slate-400'
                      }`}>{page.label}</span>
                      {isPptx && <div className="flex-1 h-px bg-orange-100" />}
                    </div>
                    <p className="text-[15px] leading-[1.9] text-slate-800 whitespace-pre-wrap font-serif">
                      {page.body}
                    </p>
                  </section>
                ))}
              </div>
            </div>
          </div>
      </div>
    </div>
  );
}

// Helper components (avoids closure issues in popup)
function NoteEditor({ initialValue, onSave, onCancel }: { initialValue: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initialValue);
  return (
    <div className="space-y-2">
      <textarea
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="Type your note here..."
        className="w-full bg-background border border-white/10 rounded-lg p-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-primary-fixed-dim/50 min-h-[90px] resize-y font-sans"
      />
      <div className="flex gap-2">
        <button onClick={() => onSave(value)} className="flex-1 py-1.5 bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-bold rounded-lg hover:bg-blue-500/30 transition-all">Save Note</button>
        <button onClick={onCancel} className="px-3 py-1.5 bg-white/5 border border-white/10 text-slate-400 text-xs font-bold rounded-lg hover:bg-white/10 transition-all">Cancel</button>
      </div>
    </div>
  );
}

function AiInput({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="flex gap-2">
      <input
        type="text"
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && value.trim()) { onSubmit(value); setValue(''); } }}
        placeholder="Ask AI about this selection..."
        className="flex-1 bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-primary-fixed-dim/50 font-sans"
      />
      <button
        onClick={() => { if (value.trim()) { onSubmit(value); setValue(''); } }}
        disabled={!value.trim()}
        className="p-2 bg-primary-fixed-dim text-on-primary-fixed rounded-lg disabled:opacity-40 hover:bg-primary-container transition-colors"
      >
        <Send className="w-4 h-4" />
      </button>
    </div>
  );
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
  const [chatDocs, setChatDocs] = useState<string[]>([]);
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; content: string }[]>([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [isCourseModalOpen, setIsCourseModalOpen] = useState(false);
  const [selectedCourseToConnect, setSelectedCourseToConnect] = useState<string | null>(null);

  const enrolledCourses = [
    { id: 'c1', name: 'Biology 301' },
    { id: 'c2', name: 'Physics 201' },
    { id: 'c3', name: 'World History' }
  ];

  const handleConfirmConnect = () => {
    if (selectedCourseToConnect) {
      handleConnectCourse();
      setIsCourseModalOpen(false);
    }
  };

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
            onClick={() => setIsCourseModalOpen(true)}
            className="px-8 py-4 bg-primary-fixed-dim hover:bg-primary-container text-on-primary-fixed rounded-xl font-sans font-bold text-sm uppercase tracking-wider transition-all shadow-lg shadow-primary-fixed-dim/20 hover:scale-105 active:scale-95"
          >
            Connect to your Enrolled Course
          </button>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row h-auto lg:h-[calc(100vh-140px)] gap-6 relative">
          
          {/* File Space */}
          <div className="h-[450px] lg:h-auto flex-1 bg-surface-container-lowest border border-white/5 rounded-2xl p-6 flex flex-col min-w-0">
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
          <div className="w-full lg:w-[380px] xl:w-[420px] h-[550px] lg:h-auto shrink-0 bg-surface-container-lowest border border-primary-fixed-dim/20 rounded-2xl flex flex-col relative overflow-hidden shadow-2xl">
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

      {/* Floating Document Viewer — Split Panel */}
      {selectedDoc && createPortal(
        <DocViewer
          selectedDoc={selectedDoc}
          docNotes={docNotes}
          updateDocNotes={updateDocNotes}
          openDoc={openDoc}
          setActiveTab={setActiveTab}
          setIsGenerating={setIsGenerating}
          setSelectedSetContent={setSelectedSetContent}
          setFlashcardSets={setFlashcardSets}
          submitAiPrompt={submitAiPrompt}
          saveNote={saveNote}
          editNote={editNote}
          deleteNote={deleteNote}
          toggleNoteExpanded={toggleNoteExpanded}
        />
        , document.body
      )}

      {/* Course Selection Modal */}
      <Modal
        isOpen={isCourseModalOpen}
        onClose={() => {
          setIsCourseModalOpen(false);
          setSelectedCourseToConnect(null);
        }}
        title="Select Course to Connect"
      >
        <div className="flex flex-col gap-6">
          <p className="font-sans text-sm text-slate-400">
            Choose an enrolled course to synchronize its resources with this study space.
          </p>
          <div className="space-y-3">
            {enrolledCourses.map(course => (
              <label 
                key={course.id} 
                className={`flex items-center p-4 border rounded-xl cursor-pointer transition-colors ${selectedCourseToConnect === course.id ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim' : 'bg-surface-container border-white/10 hover:bg-white/5'}`}
              >
                <input 
                  type="radio" 
                  name="courseSelection" 
                  value={course.id} 
                  checked={selectedCourseToConnect === course.id}
                  onChange={() => setSelectedCourseToConnect(course.id)}
                  className="hidden"
                />
                <div className={`w-5 h-5 rounded-full border flex items-center justify-center mr-4 ${selectedCourseToConnect === course.id ? 'border-primary-fixed-dim' : 'border-slate-500'}`}>
                  {selectedCourseToConnect === course.id && <div className="w-2.5 h-2.5 rounded-full bg-primary-fixed-dim" />}
                </div>
                <span className="font-display font-medium text-white">{course.name}</span>
              </label>
            ))}
          </div>
          
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => {
                setIsCourseModalOpen(false);
                setSelectedCourseToConnect(null);
              }}
              className="px-5 py-2.5 rounded-xl font-sans text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmConnect}
              disabled={!selectedCourseToConnect}
              className="px-5 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-sans text-sm font-bold shadow-lg shadow-primary-fixed-dim/20 hover:bg-primary-container transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Connect
            </button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
