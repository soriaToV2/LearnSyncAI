import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  UploadCloud, FileText, Trash2, Send, Sparkles,
  Loader2, AlertCircle, BookOpen, MessageSquare, Lightbulb, HelpCircle, X,
  File as FileIcon, FileImage, FileSpreadsheet
} from 'lucide-react';
import { api } from '../../../lib/api';
import type { Material } from '../../../../server/types/database';
import { supabase } from '../../../lib/supabase';
import Modal from '../../../components/ui/Modal';
import Markdown from '../../../components/ui/Markdown';
import PdfViewer from '../../../components/ui/PdfViewer';

interface ResourcesTabProps {
  spaceId: string;
  courseConnected: boolean;
  selectedDoc: string | null;
  handleConnectCourse: () => void;
  setSelectedDoc: (doc: string | null) => void;
  setActiveTab: (tab: 'flashcards' | 'resources') => void;
  setIsGenerating: (isGenerating: boolean) => void;
  setSelectedSetContent: (id: number | null) => void;
  setFlashcardSets: React.Dispatch<React.SetStateAction<any[]>>;
}

interface UploadedFile {
  id: string;
  name: string;
  size: string;
  type: string;
  selected: boolean;
  parsed_status: 'pending' | 'processing' | 'completed' | 'failed' | null;
  conceptCount?: number;
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

export default function ResourcesTab({
  spaceId,
  courseConnected,
  selectedDoc,
  handleConnectCourse,
  setSelectedDoc,
  setActiveTab,
  setIsGenerating,
  setSelectedSetContent,
  setFlashcardSets
}: ResourcesTabProps) {
  // ─── Files state ───────────────────────────────────────────
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Chat state ────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
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

  // ─── Delete Confirmation state ──────────────────────────────
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ─── Derived state ─────────────────────────────────────────
  const selectedCompletedFiles = files.filter(f => f.selected && f.parsed_status === 'completed');
  const canChat = selectedCompletedFiles.length > 0 && !isStreaming;
  // The single active material drives both the document viewer and the chat context.
  const activeFile = files.find(f => f.selected) ?? null;

  // ─── Auto-scroll chat ──────────────────────────────────────
  useEffect(() => {
    if (!isChatOpen) return;
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming, isChatOpen]);

  // ─── Load the signed view URL whenever the active material changes ──
  const loadViewerUrl = useCallback(async (fileId: string) => {
    setViewerLoading(true);
    setViewerError(null);
    try {
      const res = await api.get<{ url: string }>(`/materials/${fileId}/view`);
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
    if (!activeFile) {
      setViewerUrl(null);
      setViewerError(null);
      setViewerLoading(false);
      return;
    }
    loadViewerUrl(activeFile.id);
  }, [activeFile?.id, loadViewerUrl]);

  // ─── 1. Fetch materials on mount ───────────────────────────
  useEffect(() => {
    async function fetchMaterials() {
      try {
        const res = await api.get<Material[]>(`/materials/space/${spaceId}`);
        console.log('Fetched materials:', res.data);

        if (res.data && Array.isArray(res.data)) {
          const mappedFiles: UploadedFile[] = res.data.map(m => ({
            id: m.id,
            name: m.title,
            size: 'Unknown size',
            type: m.storage_path ? m.storage_path.split('.').pop() || 'unknown' : 'unknown',
            selected: false,
            parsed_status: m.parsed_status,
          }));
          setFiles(mappedFiles);

          // Fetch concept counts for completed materials
          mappedFiles.filter(f => f.parsed_status === 'completed').forEach(async f => {
            try {
              const conceptRes = await api.get<any[]>(`/materials/${f.id}/concepts`);
              if (conceptRes.data && Array.isArray(conceptRes.data)) {
                setFiles(prev => prev.map(pf => pf.id === f.id ? { ...pf, conceptCount: conceptRes.data.length } : pf));
              }
            } catch (e) {
              console.error(`Failed to fetch concepts for ${f.id}`, e);
            }
          });
        }
      } catch (err) {
        console.error('Failed to load materials:', err);
      }
    }
    fetchMaterials();
  }, [spaceId]);

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
          // Show welcome message if no history
          setMessages([{
            id: 'welcome',
            role: 'ai',
            content: 'Hello! I\'m your AI Study Assistant. Select your uploaded materials on the left and ask me anything about them — I can summarize, explain, quiz you, and more!'
          }]);
        }
      } catch (err) {
        console.error('Failed to load chat history:', err);
        setMessages([{
          id: 'welcome',
          role: 'ai',
          content: 'Hello! I\'m your AI Study Assistant. Select your uploaded materials on the left and ask me anything about them!'
        }]);
      } finally {
        setHistoryLoaded(true);
      }
    }
    fetchHistory();
  }, [spaceId]);

  // ─── 3. Poll status for pending/processing files ───────────
  useEffect(() => {
    const pendingFiles = files.filter(f => f.parsed_status === 'pending' || f.parsed_status === 'processing');
    if (pendingFiles.length === 0) return;

    const interval = setInterval(async () => {
      for (const file of pendingFiles) {
        try {
          const res = await api.get<{ parsed_status: 'pending' | 'processing' | 'completed' | 'failed' }>(`/materials/${file.id}/status`);
          if (res.data.parsed_status !== file.parsed_status) {
            setFiles(prev => prev.map(f => f.id === file.id ? { ...f, parsed_status: res.data.parsed_status } : f));

            if (res.data.parsed_status === 'completed') {
              const conceptRes = await api.get<any[]>(`/materials/${file.id}/concepts`);
              setFiles(prev => prev.map(f => f.id === file.id ? { ...f, conceptCount: conceptRes.data.length } : f));
            }
          }
        } catch (err) {
          console.error(`Failed to poll status for ${file.id}`, err);
        }
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [files]);

  // ─── 4. Send message (streaming) ───────────────────────────
  const handleSendMessage = useCallback(async (overrideMessage?: string, overrideMode?: 'rag' | 'full') => {
    const messageText = (overrideMessage ?? input).trim();
    if (!messageText || isStreaming) return;
    if (selectedCompletedFiles.length === 0) {
      setChatError('Please select at least one fully processed material to chat with.');
      return;
    }

    setChatError(null);
    const userMsgId = Date.now().toString();
    const aiMsgId = Date.now().toString() + '-ai';

    // Add user message
    const userMessage: ChatMessage = { id: userMsgId, role: 'user', content: messageText };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Add streaming placeholder for AI
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

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          space_id: spaceId,
          message: messageText,
          material_ids: selectedCompletedFiles.map(f => f.id),
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

      // Mark as done streaming
      setMessages(prev => prev.map(m =>
        m.id === aiMsgId ? { ...m, isStreaming: false } : m
      ));

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
  }, [input, isStreaming, selectedCompletedFiles, messages, spaceId]);

  // ─── File management ───────────────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    setUploadError(null);
    setIsUploading(true);

    for (let i = 0; i < e.target.files.length; i++) {
      const file = e.target.files[i];
      if (file.type !== 'application/pdf') {
        setUploadError('Only PDF files are currently supported.');
        setIsUploading(false);
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        setUploadError('File size exceeds the 20MB limit.');
        setIsUploading(false);
        return;
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('space_id', spaceId);
      formData.append('title', file.name);

      try {
        const res = await api.upload<Material>('/materials', formData);
        setFiles(prev => [
          {
            id: res.data.id,
            name: res.data.title,
            size: (file.size / (1024 * 1024)).toFixed(1) + ' MB',
            type: 'pdf',
            selected: true,
            parsed_status: 'pending'
          },
          ...prev.map(f => ({ ...f, selected: false }))
        ]);
      } catch (err: any) {
        setUploadError(err.message || 'Failed to upload file');
      }
    }

    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const toggleFileSelection = (id: string) => {
    // Only allow selecting ONE file at a time to prevent exceeding Groq token limits
    setFiles(prev => prev.map(f => ({
      ...f,
      selected: f.id === id ? !f.selected : false
    })));
  };

  const deleteFile = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setFileToDelete(id);
    setIsDeleteConfirmOpen(true);
  };

  const confirmDeleteFile = async () => {
    if (!fileToDelete) return;
    setIsDeleting(true);
    try {
      await api.delete(`/materials/${fileToDelete}`);
      setFiles(prev => prev.filter(f => f.id !== fileToDelete));
      setIsDeleteConfirmOpen(false);
      setFileToDelete(null);
    } catch (err) {
      console.error('Failed to delete file', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const getFileIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'pdf': return <FileText className="w-5 h-5 text-red-400" />;
      case 'doc':
      case 'docx': return <FileText className="w-5 h-5 text-blue-400" />;
      case 'ppt':
      case 'pptx': return <FileText className="w-5 h-5 text-orange-400" />;
      case 'xls':
      case 'xlsx': return <FileSpreadsheet className="w-5 h-5 text-emerald-400" />;
      case 'png':
      case 'jpg':
      case 'jpeg': return <FileImage className="w-5 h-5 text-purple-400" />;
      default: return <FileIcon className="w-5 h-5 text-slate-400" />;
    }
  };

  // ─── Textarea auto-resize ──────────────────────────────────
  const handleAutoResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
  };

  return (
    <div className="relative animate-in fade-in duration-500 h-[calc(100vh-140px)] flex flex-col xl:flex-row gap-4">

      {/* ─── LEFT: Materials ─────────────────────────────────── */}
      <aside className="w-full xl:w-[300px] shrink-0 flex flex-col gap-3 h-[38vh] xl:h-full bg-surface-container-lowest border border-white/5 rounded-2xl shadow-sm p-3">
        {/* Title + count */}
        <div className="flex items-center justify-between px-1 shrink-0">
          <h2 className="font-display font-semibold text-[15px] text-white">Materials</h2>
          <span className="font-mono text-[11px] text-slate-500 tabular-nums bg-white/5 px-1.5 py-0.5 rounded">
            {files.length}
          </span>
        </div>

        {/* Upload */}
        <div className="shrink-0 space-y-1.5">
          <input
            type="file"
            multiple
            accept="application/pdf"
            className="hidden"
            onChange={handleFileSelect}
            ref={fileInputRef}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="w-full py-2.5 rounded-xl border border-dashed border-white/12 hover:border-primary-fixed-dim/40 hover:bg-primary-fixed-dim/5 flex items-center justify-center gap-2 text-slate-400 hover:text-white transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <UploadCloud className="w-4 h-4" />}
            {isUploading ? 'Uploading…' : 'Upload PDF'}
          </button>
          {uploadError && (
            <p className="text-red-400 text-[11px] flex items-center gap-1 px-1">
              <AlertCircle className="w-3 h-3 shrink-0" /> {uploadError}
            </p>
          )}
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-0.5 no-scrollbar min-h-0">
          {files.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4 text-slate-600">
              <FileText className="w-7 h-7 mb-2 opacity-30" />
              <p className="font-sans text-xs">No materials yet</p>
            </div>
          ) : (
            files.map(file => (
              <div
                key={file.id}
                onClick={() => toggleFileSelection(file.id)}
                className={`group flex items-center gap-2.5 pl-2.5 pr-1.5 py-2 rounded-lg cursor-pointer transition-colors border-l-2 ${file.selected
                  ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim'
                  : 'border-transparent hover:bg-white/5'
                  }`}
              >
                <div className="shrink-0 opacity-90">{getFileIcon(file.type)}</div>

                <div className="flex-1 min-w-0">
                  <p className={`font-sans text-[13px] font-medium truncate leading-tight ${file.selected ? 'text-white' : 'text-slate-300'}`}>
                    {file.name}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5 text-[10.5px] leading-none">
                    {(file.parsed_status === 'pending' || file.parsed_status === 'processing') && (
                      <span className="flex items-center gap-1 text-amber-400/90">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Processing
                      </span>
                    )}
                    {file.parsed_status === 'failed' && (
                      <span className="text-red-400/90">Failed to process</span>
                    )}
                    {file.parsed_status === 'completed' && (
                      <span className="text-emerald-400/80">Ready</span>
                    )}
                    {file.parsed_status === 'completed' && file.conceptCount !== undefined && (
                      <span className="text-slate-500">· {file.conceptCount} concepts</span>
                    )}
                  </div>
                </div>

                <button
                  onClick={(e) => deleteFile(e, file.id)}
                  aria-label="Delete material"
                  className="shrink-0 p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ─── RIGHT: Document Viewer ──────────────────────────── */}
      <PdfViewer
        url={viewerUrl}
        title={activeFile?.name}
        loading={viewerLoading}
        error={viewerError}
        onRetry={activeFile ? () => loadViewerUrl(activeFile.id) : undefined}
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
                  {isStreaming ? 'Thinking…' : activeFile ? activeFile.name : 'No material selected'}
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
                <Loader2 className="w-6 h-6 text-primary-fixed-dim animate-spin" />
              </div>
            ) : (
              messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-1 duration-300`}
                >
                  <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 ${msg.role === 'user'
                    ? 'bg-primary-fixed-dim text-on-primary-fixed rounded-br-md'
                    : 'bg-surface-container-high text-slate-200 rounded-bl-md'
                    }`}>
                    {msg.content ? (
                      msg.role === 'ai'
                        ? <Markdown content={msg.content} />
                        : <p className="font-sans text-[13.5px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
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
          {!chatError && selectedCompletedFiles.length === 0 && historyLoaded && (
            <p className="px-4 py-1.5 text-[11px] text-amber-400/80 shrink-0">
              {files.some(f => f.selected)
                ? 'This material is still processing…'
                : 'Select a processed material to start chatting.'}
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
                    : selectedCompletedFiles.length > 0
                      ? 'Ask about this material…'
                      : 'Select a processed material…'
                }
                className="flex-1 bg-transparent border-none outline-none font-sans text-[13.5px] text-white placeholder:text-slate-500 min-h-[36px] max-h-[150px] resize-none py-2 px-1.5 scrollbar-thin overflow-hidden disabled:opacity-50"
                rows={1}
              />
              <button
                type="submit"
                disabled={!input.trim() || isStreaming || selectedCompletedFiles.length === 0}
                className="shrink-0 w-9 h-9 bg-primary-fixed-dim text-on-primary-fixed rounded-lg flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-container transition-colors"
              >
                {isStreaming
                  ? <Loader2 className="w-4 h-4 animate-spin" />
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

      {/* ─── Delete Confirmation Modal ──────────────────────── */}
      <Modal
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        title="Delete Document"
      >
        <div className="space-y-4">
          <p className="text-slate-300 font-sans text-sm">
            Are you sure you want to delete this document? This will permanently remove the file and all its extracted concepts. This action cannot be undone.
          </p>
          <div className="mt-8 flex gap-3">
            <button
              onClick={() => setIsDeleteConfirmOpen(false)}
              className="flex-1 px-4 py-3 rounded-xl border border-white/10 text-white font-medium hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmDeleteFile}
              disabled={isDeleting}
              className="flex-1 px-4 py-3 rounded-xl bg-red-500/20 text-red-400 font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isDeleting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
              Delete Document
            </button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
