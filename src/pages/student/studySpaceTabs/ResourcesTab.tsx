import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  FileText, Send, Sparkles, AlertCircle, BookOpen,
  MessageSquare, Lightbulb, HelpCircle, X, Inbox, Download, ScanLine, Lock
} from 'lucide-react';
import Spinner from '../../../components/ui/Spinner';
import { api } from '../../../lib/api';
import { supabase } from '../../../lib/supabase';
import Markdown from '../../../components/ui/Markdown';
import PdfViewer from '../../../components/ui/PdfViewer';
import SubjectBadge from '../../../components/educator/SubjectBadge';
import { useSubjectName } from '../../../context/SubjectsContext';
import { useBadges } from '../../../context/BadgeContext';

/**
 * The student's read-only view of the materials their educators published.
 *
 * Students cannot upload, delete, or remove anything here — the paper is explicit
 * that "only authenticated educators are authorized to upload learning resources.
 * Students are not permitted to upload instructional materials". The single write
 * a student can make is pulling newly published materials into their own space,
 * and even that does not choose what arrives: the server derives the set from the
 * space's subject and the student's grade level.
 */

interface ResourcesTabProps {
  spaceId: string;
  // Retained but unused — kept until the study space container is revisited.
  courseConnected: boolean;
  selectedDoc: string | null;
  handleConnectCourse: () => void;
  setSelectedDoc: (doc: string | null) => void;
  setActiveTab: (tab: 'flashcards' | 'resources') => void;
  setIsGenerating: (isGenerating: boolean) => void;
  setSelectedSetContent: (id: number | null) => void;
  setFlashcardSets: React.Dispatch<React.SetStateAction<any[]>>;
  /**
   * PRE/POST GATE — temporary (migration 0024).
   *
   * ⚠️ THIS TAB IS THE ONE PLACE A LOCKED MATERIAL STAYS VISIBLE. Everywhere else
   * it drops out of the picker; here the student must still see that the lesson
   * exists and be told why they cannot open it — a lesson that simply vanished
   * from the library reads as the app losing their teacher's work.
   *
   * The PDF and the chatbot are both blocked, because a pre-test is a BASELINE:
   * a student who reads the lesson first has an inflated baseline and a shrunken
   * measured gain, which is precisely what paper RQ4 (p. 55) measures.
   */
  lockedIds?: Set<string>;
  /** Sync can pull in a material that is already locked, which the parent's map
   *  does not know about yet. Same idiom as FlashcardsTab's `onRefresh`. */
  onLocksChanged?: () => void;
}

/** One material as GET /api/spaces/:id/materials returns it. */
interface SpaceMaterial {
  id: string;
  title: string;
  description: string | null;
  subject: string;
  file_size_bytes: number | null;
  page_count: number | null;
  is_scanned: boolean;
  parsed_status: 'pending' | 'processing' | 'completed' | 'failed' | null;
  parse_error: string | null;
  concept_count: number;
}

interface SpaceMaterialsResponse {
  space: { id: string; title: string; subject: string };
  materials: SpaceMaterial[];
  available_count: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
  isStreaming?: boolean;
}

// Quick action prompt shortcuts
const QUICK_ACTIONS = [
  { icon: BookOpen, label: 'Summarize', prompt: 'Please provide a comprehensive summary of all the key topics and concepts covered in my selected materials.', mode: 'full' as const },
  { icon: Lightbulb, label: 'Explain Simply', prompt: 'Explain the main concepts of my selected materials in simple, easy-to-understand terms as if I\'m a beginner.', mode: 'full' as const },
  { icon: HelpCircle, label: 'Quiz Me', prompt: 'Ask me 5 challenging questions to test my understanding of the key concepts in my selected materials. After I answer each one, give me feedback.', mode: 'rag' as const },
  { icon: MessageSquare, label: 'Key Terms', prompt: 'List and briefly explain the most important terms and definitions from my selected materials.', mode: 'full' as const },
];

/** Bytes to a short human size. Materials always carry file_size_bytes now. */
function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Why a material cannot be used, in words a student can act on. A scanned module
 * is the common case: the upload pipeline stores it but never extracts concepts
 * from it, so there is nothing for the assistant to read.
 */
function unavailableReason(material: SpaceMaterial): string | null {
  if (material.parsed_status === 'completed') return null;
  if (material.parsed_status === 'pending' || material.parsed_status === 'processing') {
    return 'Your teacher just added this. It is still being prepared.';
  }
  if (material.is_scanned) {
    return 'This is a scan of printed pages, so there is no text the study assistant can read. Ask your teacher for a text version.';
  }
  return material.parse_error?.trim()
    ? material.parse_error
    : 'This document could not be prepared, so the study assistant cannot use it. Your teacher can re-upload it.';
}

export default function ResourcesTab({
  spaceId,
  courseConnected,
  selectedDoc,
  handleConnectCourse,
  setSelectedDoc,
  setActiveTab,
  setIsGenerating,
  setSelectedSetContent,
  setFlashcardSets,
  lockedIds,
  onLocksChanged,
}: ResourcesTabProps) {
  const subjectNameOf = useSubjectName();

  // ─── Materials state ───────────────────────────────────────
  const [materials, setMaterials] = useState<SpaceMaterial[]>([]);
  const [subject, setSubject] = useState<string>('');
  const [availableCount, setAvailableCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [materialsLoading, setMaterialsLoading] = useState(true);
  const [materialsError, setMaterialsError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  // ─── Chat state ────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const { celebrate } = useBadges();
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ─── Document viewer state ─────────────────────────────────
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);

  // ─── Derived state ─────────────────────────────────────────
  const activeMaterial = materials.find(m => m.id === selectedId) ?? null;
  // Only a fully processed material has concepts, and concepts are the only thing
  // the assistant is allowed to answer from.
  // PRE/POST GATE: a locked material is not chattable, whatever its parse status.
  const chatMaterial =
    activeMaterial?.parsed_status === 'completed' && !lockedIds?.has(activeMaterial.id)
      ? activeMaterial
      : null;
  const canChat = !!chatMaterial && !isStreaming;

  // ─── Auto-scroll chat ──────────────────────────────────────
  useEffect(() => {
    if (!isChatOpen) return;
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming, isChatOpen]);

  // ─── Load the signed view URL whenever the active material changes ──
  const loadViewerUrl = useCallback(async (materialId: string) => {
    setViewerLoading(true);
    setViewerError(null);
    try {
      const res = await api.get<{ url: string }>(`/materials/${materialId}/view`);
      setViewerUrl(res.data.url);
    } catch (err: any) {
      console.error('Failed to load document URL:', err);
      setViewerUrl(null);
      setViewerError(err.message ?? 'Could not load this document. Please try again.');
    } finally {
      setViewerLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setViewerUrl(null);
      setViewerError(null);
      setViewerLoading(false);
      return;
    }
    loadViewerUrl(selectedId);
  }, [selectedId, loadViewerUrl]);

  /** Applies a materials payload from either the load or the sync endpoint. */
  const applyPayload = useCallback((payload: SpaceMaterialsResponse) => {
    setMaterials(payload.materials ?? []);
    setSubject(payload.space?.subject ?? '');
    setAvailableCount(payload.available_count ?? 0);
  }, []);

  // ─── 1. Load the space's materials once on mount ───────────
  //
  // No polling. Materials reach a student already processed — extraction finishes
  // during the educator's upload — and the "new materials" count is computed
  // server-side as part of this same request, so there is nothing to watch for.
  useEffect(() => {
    let cancelled = false;

    async function fetchMaterials() {
      setMaterialsLoading(true);
      setMaterialsError(null);
      try {
        const res = await api.get<SpaceMaterialsResponse>(`/spaces/${spaceId}/materials`);
        if (cancelled) return;
        applyPayload(res.data);
      } catch (err: any) {
        if (cancelled) return;
        console.error('Failed to load materials:', err);
        setMaterialsError(err.message ?? 'Could not load your materials.');
      } finally {
        if (!cancelled) setMaterialsLoading(false);
      }
    }

    fetchMaterials();
    return () => { cancelled = true; };
  }, [spaceId, applyPayload]);

  // ─── 2. Load chat history on mount ─────────────────────────
  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await api.get<Array<{ id: string; message: string; response: string; created_at: string }>>(`/chat/history/${spaceId}`);
        if (res.data && Array.isArray(res.data) && res.data.length > 0) {
          const historicMessages: ChatMessage[] = [];
          res.data.forEach(log => {
            historicMessages.push({ id: `${log.id}-user`, role: 'user', content: log.message });
            historicMessages.push({ id: `${log.id}-ai`, role: 'ai', content: log.response });
          });
          setMessages(historicMessages);
        } else {
          setMessages([{
            id: 'welcome',
            role: 'ai',
            content: 'Hello! I\'m your AI Study Assistant. Pick one of your teacher\'s materials on the left and ask me anything about it — I can summarize, explain, quiz you, and more!'
          }]);
        }
      } catch (err) {
        console.error('Failed to load chat history:', err);
        setMessages([{
          id: 'welcome',
          role: 'ai',
          content: 'Hello! I\'m your AI Study Assistant. Pick one of your teacher\'s materials on the left and ask me anything about it!'
        }]);
      } finally {
        setHistoryLoaded(true);
      }
    }
    fetchHistory();
  }, [spaceId]);

  // ─── 3. Pull in newly published materials ──────────────────
  const handleSync = async () => {
    setIsSyncing(true);
    setMaterialsError(null);
    try {
      const res = await api.post<SpaceMaterialsResponse & { added_count: number }>(
        `/spaces/${spaceId}/materials/sync`,
        {}
      );
      applyPayload(res.data);
      const added = res.data.added_count;
      setSyncNotice(added === 1 ? '1 new material added.' : `${added} new materials added.`);
      // PRE/POST GATE: a newly pulled-in material may already be locked, and the
      // parent's map was fetched before it existed.
      onLocksChanged?.();
      setTimeout(() => setSyncNotice(null), 4000);
    } catch (err: any) {
      console.error('Failed to add new materials:', err);
      setMaterialsError(err.message ?? 'Could not add the new materials. Please try again.');
    } finally {
      setIsSyncing(false);
    }
  };

  // ─── 4. Send message (streaming) ───────────────────────────
  const handleSendMessage = useCallback(async (overrideMessage?: string, overrideMode?: 'rag' | 'full') => {
    const messageText = (overrideMessage ?? input).trim();
    if (!messageText || isStreaming) return;
    if (!chatMaterial) {
      setChatError('Please select a material that has finished processing.');
      return;
    }

    setChatError(null);
    const userMsgId = Date.now().toString();
    const aiMsgId = Date.now().toString() + '-ai';

    const userMessage: ChatMessage = { id: userMsgId, role: 'user', content: messageText };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const aiPlaceholder: ChatMessage = { id: aiMsgId, role: 'ai', content: '', isStreaming: true };
    setMessages(prev => [...prev, aiPlaceholder]);
    setIsStreaming(true);

    // Build history from last 4 messages (2 exchanges) excluding welcome msg
    const recentHistory = messages
      .filter(m => m.id !== 'welcome')
      .slice(-4)
      .map(m => ({ role: m.role === 'ai' ? 'assistant' as const : 'user' as const, content: m.content }));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? '';

      // Raw fetch rather than the api helper: this endpoint streams Server-Sent
      // Events, which the JSON wrapper cannot represent.
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          space_id: spaceId,
          message: messageText,
          material_ids: [chatMaterial.id],
          history: recentHistory,
          mode: overrideMode ?? 'rag',
        }),
      });

      if (!response.ok || !response.body) {
        const errJson = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errJson.message ?? errJson.error ?? 'Chat request failed');
      }

      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const payload = JSON.parse(jsonStr);
            if (payload.done) break;
            if (payload.error) throw new Error(payload.error);
            if (payload.token) {
              fullContent += payload.token;
              setMessages(prev => prev.map(m =>
                m.id === aiMsgId ? { ...m, content: fullContent } : m
              ));
            }
          } catch (parseErr) {
            // ignore malformed chunks
          }
        }
      }

      setMessages(prev => prev.map(m =>
        m.id === aiMsgId ? { ...m, isStreaming: false } : m
      ));

      /*
       * On the SUCCESS path only, never in `finally`. A failed turn writes no
       * chatbot_logs row and logs no activity, so checking there would be a
       * request guaranteed to find nothing.
       *
       * Chat awards no first-time badge of its own — it can only carry a streak
       * over a threshold — but that is exactly the case no other checkpoint can
       * cover: the server logs this activity AFTER res.end(), so the stream the
       * student just read could not have carried the answer.
       */
      celebrate();

    } catch (err: any) {
      console.error('[Chat] Error:', err);
      setMessages(prev => prev.map(m =>
        m.id === aiMsgId
          ? { ...m, content: '⚠️ Sorry, something went wrong. Please try again.', isStreaming: false }
          : m
      ));
      setChatError(err.message ?? 'An error occurred');
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, chatMaterial, messages, spaceId, celebrate]);

  // ─── Textarea auto-resize ──────────────────────────────────
  const handleAutoResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
  };

  const subjectLabel = subject ? subjectNameOf(subject) : 'course';

  return (
    /*
     * `h-full`, not `h-[calc(100vh-140px)]`.
     *
     * That 140px was a guess at the chrome above this tab, and it was wrong on
     * every phone: the parent <main> is ALREADY a definite-height flex child
     * (`flex-1` inside StudySpace's `h-[calc(100vh-4rem)] md:h-screen` column)
     * and it carries its own `p-4 sm:p-6 md:p-8`, while the mobile header is
     * taller than the desktop one because the tab bar collapses into a dropdown.
     * So the panel was measured against a constant that matched no layout.
     * `h-full` inherits the height main already computed correctly.
     *
     * The height must stay DEFINITE rather than becoming `min-h-full`: the chat
     * drawer and its FAB are positioned `absolute` against this element, so a
     * content-driven height would stretch the drawer past the viewport.
     */
    <div className="relative fade-in duration-500 h-full flex flex-col xl:flex-row gap-4">

      {/* ─── LEFT: Materials ─────────────────────────────────── */}
      {/*
        * `max-h-[40vh]` on mobile rather than a fixed `h-[38vh]`.
        *
        * A hard height reserved 38% of the screen whether the space held twelve
        * materials or one — and one is the common case early in a term, so the
        * panel sat mostly empty while the document below it was squeezed. A max
        * lets the panel shrink to its content and only cap out when the list is
        * genuinely long; the inner list keeps its own `overflow-y-auto`, so
        * scrolling behaviour is unchanged.
        */}
      <aside className="w-full xl:w-[300px] shrink-0 flex flex-col gap-3 max-h-[40vh] xl:max-h-none xl:h-full bg-surface-container-lowest border border-white/5 rounded-2xl shadow-sm p-3">
        {/* Title + count */}
        <div className="flex items-center justify-between gap-2 px-1 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {/* Same tinted icon chip the dashboard cards use, so the two screens
                read as one system rather than two. */}
            <div className="w-7 h-7 rounded-lg bg-primary-fixed-dim/10 text-primary-fixed-dim flex items-center justify-center shrink-0">
              <BookOpen className="w-4 h-4" />
            </div>
            <h2 className="font-display font-semibold text-[15px] text-white truncate">Materials</h2>
          </div>
          <span className="font-mono text-[11px] text-slate-400 tabular-nums bg-white/5 border border-white/5 px-2 py-0.5 rounded-md shrink-0">
            {materials.length}
          </span>
        </div>

        {/* New materials from the teacher. Absent entirely when there is nothing new. */}
        {availableCount > 0 && (
          <div className="shrink-0 rounded-xl border border-primary-fixed-dim/25 bg-primary-fixed-dim/8 p-2.5 space-y-2">
            <div className="flex items-start gap-2">
              <Inbox className="w-4 h-4 text-primary-fixed-dim shrink-0 mt-0.5" />
              <p className="font-sans text-[12px] text-slate-200 leading-snug">
                {availableCount === 1
                  ? `1 new ${subjectLabel} material from your teacher.`
                  : `${availableCount} new ${subjectLabel} materials from your teacher.`}
              </p>
            </div>
            <button
              onClick={handleSync}
              disabled={isSyncing}
              className="w-full py-2 rounded-lg bg-primary-fixed-dim text-on-primary-fixed font-sans text-[12.5px] font-semibold hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {isSyncing
                ? <><Spinner className="w-3.5 h-3.5" /> Adding…</>
                : <><Download className="w-3.5 h-3.5" /> Add to my space</>}
            </button>
          </div>
        )}

        {syncNotice && (
          <p className="shrink-0 px-1 font-sans text-[11px] text-emerald-400/90">{syncNotice}</p>
        )}

        {materialsError && (
          <p className="shrink-0 text-red-400 text-[11px] flex items-start gap-1 px-1">
            <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" /> {materialsError}
          </p>
        )}

        {/* Material list */}
        <div className="flex-1 overflow-y-auto -mx-1 px-1 no-scrollbar min-h-0">
          {materialsLoading ? (
            <div className="h-full flex items-center justify-center">
              <Spinner className="w-5 h-5 text-primary-fixed-dim" />
            </div>
          ) : materials.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4 text-slate-500 animate-tab-in">
              <FileText className="w-7 h-7 mb-2 opacity-30" />
              <p className="font-sans text-xs leading-relaxed">
                {availableCount > 0
                  ? `Your teacher has shared new ${subjectLabel} materials. Add them above to get started.`
                  : `Your teacher hasn't shared any ${subjectLabel} materials for your grade yet.`}
              </p>
            </div>
          ) : (
            /* Wrapped so the list has something to animate — `.map()` returns an
               array and a class cannot go on an array. `space-y-0.5` moves here
               from the scroll container: the rows are this div's children now,
               so the spacing has to follow them or the list loses its gaps.
               Entrance on the loaded rows, never on the spinner above. */
            <div className="space-y-0.5 animate-tab-in">
            {materials.map(material => {
              const isSelected = material.id === selectedId;
              const locked = lockedIds?.has(material.id) ?? false;   // PRE/POST GATE
              const blocked = material.parsed_status !== 'completed' || locked;

              return (
                /* A real <button>, not a <div onClick>. The whole materials list
                   was unreachable by keyboard — no Tab stop and no focus ring —
                   and this row is the only way to open a document. It contains no
                   nested interactive element, so a plain button is valid here.
                   `aria-pressed` carries the selected state, which the border
                   colour was conveying visually and to nobody else. */
                <button
                  key={material.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedId(isSelected ? null : material.id)}
                  /* ⚠️ THE FOCUS RING MUST BE `ring-inset` HERE. A default ring is
                     an OUTWARD `box-shadow: 0 0 0 2px`, and this list is
                     `space-y-0.5` — a 2px gap — so an outward 2px ring exactly
                     fills the space between rows and butts against its
                     neighbours. Instead of a crisp outline you get a continuous
                     cyan bloom, compounded on the selected row by the ring being
                     the same accent as its `/10` tint and its `border-l-2`.
                     Inset draws inside the row's own rounded edge: no bleed into
                     the gap, no collision, same 2px visibility. */
                  className={`w-full text-left flex items-start gap-2.5 pl-2.5 pr-2 py-2.5 rounded-lg cursor-pointer transition-colors border-l-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)] ${isSelected
                    ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim'
                    : 'border-transparent hover:bg-white/5'
                    }`}
                >
                  {/* A READY document is no longer red. Red is the alarm colour
                      this list uses for "Not available", so painting the healthy
                      state red — while locked and scanned both got a calmer
                      amber — inverted the whole scale. */}
                  <div className="shrink-0 opacity-90 mt-0.5">
                    {locked
                      ? <Lock className="w-5 h-5 text-amber-400" />
                      : material.is_scanned
                        ? <ScanLine className="w-5 h-5 text-amber-400" />
                        : material.parsed_status === 'failed'
                          ? <FileText className="w-5 h-5 text-red-400" />
                          : <FileText className="w-5 h-5 text-primary-fixed-dim" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className={`font-sans text-[13px] font-medium truncate leading-tight ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                      {material.title}
                    </p>

                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <SubjectBadge code={material.subject} />
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                        {formatFileSize(material.file_size_bytes)}
                      </span>
                    </div>

                    {/* `text-[10.5px]` and `text-[10px]` were below any sensible
                        floor for a 12-to-16-year-old reader, and this row is where
                        the status ("Being prepared", "Take the test first") is
                        stated. Wraps rather than overflowing the 300px panel. */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] leading-tight">
                      {(material.parsed_status === 'pending' || material.parsed_status === 'processing') && (
                        <span className="flex items-center gap-1 text-amber-400/90">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Being prepared
                        </span>
                      )}
                      {material.parsed_status === 'failed' && (
                        <span className="text-red-400/90">Not available</span>
                      )}
                      {/* PRE/POST GATE: replaces "Ready", because a locked lesson
                          is emphatically not ready to open. */}
                      {locked && <span className="text-amber-400/90">Take the test first</span>}
                      {!locked && material.parsed_status === 'completed' && (
                        <>
                          <span className="text-emerald-400/80">Ready</span>
                          <span className="text-slate-500">
                            · {material.concept_count} {material.concept_count === 1 ? 'concept' : 'concepts'}
                          </span>
                        </>
                      )}
                    </div>

                    {isSelected && blocked && (
                      <p className="mt-1.5 font-sans text-[11px] text-slate-400 leading-relaxed">
                        {locked
                          ? 'Open the Pre-Test or Post-Test tab and finish the test for this lesson. It unlocks straight afterwards.'
                          : unavailableReason(material)}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
            </div>
          )}
        </div>
      </aside>

      {/* ─── RIGHT: Document Viewer ──────────────────────────── */}
      <PdfViewer
        url={viewerUrl}
        title={activeMaterial?.title}
        loading={viewerLoading}
        error={viewerError}
        onRetry={activeMaterial ? () => loadViewerUrl(activeMaterial.id) : undefined}
      />

      {/* ─── Study Assistant drawer ──────────────────────────── */}
      {isChatOpen && (
        <div className="absolute z-40 top-3 bottom-3 right-3 lg:top-4 lg:bottom-4 lg:right-4 left-3 sm:left-auto sm:w-[min(400px,calc(100vw-1.5rem))] bg-surface-container-lowest border border-white/10 rounded-2xl flex flex-col overflow-hidden shadow-2xl animate-drawer-in">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/5 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-primary-fixed-dim/15 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4 text-primary-fixed-dim" />
              </div>
              <div className="min-w-0">
                <h3 className="font-display font-semibold text-sm text-white leading-tight">Study Assistant</h3>
                <p className="font-sans text-[11px] text-slate-500 truncate">
                  {isStreaming ? 'Thinking…' : activeMaterial ? activeMaterial.title : 'No material selected'}
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsChatOpen(false)}
              aria-label="Close Study Assistant"
              className="shrink-0 p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Quick actions */}
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/5 overflow-x-auto no-scrollbar shrink-0">
            {QUICK_ACTIONS.map(action => (
              <button
                key={action.label}
                onClick={() => handleSendMessage(action.prompt, action.mode)}
                disabled={!canChat}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 hover:bg-primary-fixed-dim/10 text-slate-400 hover:text-white transition-colors text-[11px] font-medium whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                <action.icon className="w-3 h-3" />
                {action.label}
              </button>
            ))}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 scroll-smooth no-scrollbar">
            {!historyLoaded ? (
              <div className="h-full flex items-center justify-center">
                <Spinner className="w-6 h-6 text-primary-fixed-dim" />
              </div>
            ) : (
              messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} fade-in duration-300`}
                >
                  <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 ${msg.role === 'user'
                    ? 'bg-primary-fixed-dim text-on-primary-fixed rounded-br-md'
                    : 'bg-surface-container-high text-slate-200 rounded-bl-md'
                    }`}>
                    {msg.content ? (
                      msg.role === 'ai'
                        ? <Markdown content={msg.content} />
                        : <p className="font-sans text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <div className="flex items-center gap-1.5 py-0.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary-fixed-dim animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-1.5 h-1.5 rounded-full bg-primary-fixed-dim animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-1.5 h-1.5 rounded-full bg-primary-fixed-dim animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    )}
                    {msg.isStreaming && msg.content && (
                      <span className="inline-block w-0.5 h-4 bg-primary-fixed-dim ml-0.5 animate-pulse align-middle" />
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Inline status hints */}
          {chatError && (
            <div className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] text-red-400 shrink-0">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1">{chatError}</span>
              <button onClick={() => setChatError(null)} className="text-red-400/60 hover:text-red-400">✕</button>
            </div>
          )}
          {!chatError && !chatMaterial && historyLoaded && (
            <p className="px-4 py-1.5 text-[11px] text-amber-400/80 shrink-0 leading-snug">
              {activeMaterial
                ? unavailableReason(activeMaterial)
                : 'Select one of your materials to start chatting.'}
            </p>
          )}

          {/* Input */}
          <div className="p-3 border-t border-white/5 shrink-0">
            <form
              onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
              className="flex items-end gap-2 bg-surface-container border border-white/10 rounded-xl px-2 py-1.5 focus-within:border-primary-fixed-dim/40 transition-colors"
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); handleAutoResize(e); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                disabled={isStreaming}
                placeholder={
                  isStreaming
                    ? 'AI is responding…'
                    : chatMaterial
                      ? 'Ask about this material…'
                      : 'Select a material…'
                }
                /* `scrollbar-thin` was undefined — same dead family as the
                   `scrollbar-none` on the study-space tab strip; the real utility
                   in index.css is `.no-scrollbar`. Dropped rather than swapped,
                   since `overflow-hidden` beside it means there is no scrollbar
                   to style in the first place. */
                className="flex-1 bg-transparent border-none outline-none font-sans text-sm text-white placeholder:text-slate-500 min-h-[36px] max-h-[150px] resize-none py-2 px-1.5 overflow-hidden disabled:opacity-50"
                rows={1}
              />
              <button
                type="submit"
                disabled={!input.trim() || isStreaming || !chatMaterial}
                className="shrink-0 w-9 h-9 bg-primary-fixed-dim text-on-primary-fixed rounded-lg flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-container transition-colors"
              >
                {isStreaming
                  ? <Spinner className="w-4 h-4" />
                  : <Send className="w-4 h-4 ml-0.5" />}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ─── Chat toggle (FAB) ───────────────────────────────── */}
      {!isChatOpen && (
        <button
          onClick={() => setIsChatOpen(true)}
          aria-label="Open Study Assistant"
          className="absolute z-40 bottom-5 right-5 lg:bottom-6 lg:right-6 w-14 h-14 rounded-2xl bg-primary-fixed-dim text-on-primary-fixed flex items-center justify-center shadow-lg shadow-primary-fixed-dim/25 hover:brightness-110 active:scale-95 transition-all"
        >
          <Sparkles className="w-6 h-6" />
          <span className={`absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-surface-container-lowest ${isStreaming ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`} />
        </button>
      )}

    </div>
  );
}
