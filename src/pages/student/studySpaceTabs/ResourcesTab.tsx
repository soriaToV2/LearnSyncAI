import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  UploadCloud, FileText, Trash2, Send, Bot, User,
  File as FileIcon, FileImage, FileSpreadsheet, Sparkles,
  CheckCircle2, Circle, Loader2, AlertCircle, BookOpen,
  MessageSquare, Lightbulb, HelpCircle, RefreshCw
} from 'lucide-react';
import { api, apiFetch } from '../../../lib/api';
import type { Material } from '../../../../server/types/database';
import { supabase } from '../../../lib/supabase';
import Modal from '../../../components/ui/Modal';

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
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ─── Delete Confirmation state ──────────────────────────────
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ─── Derived state ─────────────────────────────────────────
  const selectedCompletedFiles = files.filter(f => f.selected && f.parsed_status === 'completed');
  const canChat = selectedCompletedFiles.length > 0 && !isStreaming;

  // ─── Auto-scroll chat ──────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

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

  // ─── Render markdown-ish content simply (bold, line breaks) ─
  const renderContent = (content: string) => {
    return content;
  };

  return (
    <div className="animate-in fade-in duration-500 h-[calc(100vh-140px)] flex flex-col xl:flex-row gap-6 p-2 lg:p-4">

      {/* ─── LEFT PANEL: Materials Management ─────────────────── */}
      <div className="w-full xl:w-[380px] flex-shrink-0 flex flex-col gap-4 h-[50vh] xl:h-full">
        {/* Header */}
        <div className="bg-surface-container-lowest border border-white/5 rounded-2xl p-5 shadow-sm shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-fixed-dim/10 flex items-center justify-center border border-primary-fixed-dim/20">
              <UploadCloud className="w-5 h-5 text-primary-fixed-dim" />
            </div>
            <div>
              <h2 className="font-display font-semibold text-lg text-white leading-tight">Learning Materials</h2>
              <p className="font-sans text-xs text-slate-400 mt-0.5">Upload PDFs to power the AI assistant</p>
            </div>
          </div>
        </div>

        {/* Upload Button */}
        <div className="shrink-0 space-y-2">
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
            className="w-full py-3.5 bg-surface-container border border-white/10 hover:border-primary-fixed-dim/50 hover:bg-primary-fixed-dim/10 rounded-xl flex items-center justify-center gap-2 transition-all group shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <Loader2 className="w-5 h-5 text-primary-fixed-dim animate-spin" />
            ) : (
              <UploadCloud className="w-5 h-5 text-slate-400 group-hover:text-primary-fixed-dim transition-colors" />
            )}
            <span className="font-sans text-sm font-semibold text-slate-300 group-hover:text-white transition-colors">
              {isUploading ? 'Uploading...' : 'Upload PDF Materials'}
            </span>
          </button>
          {uploadError && (
            <p className="text-red-400 text-xs text-center flex items-center justify-center gap-1">
              <AlertCircle className="w-3 h-3" /> {uploadError}
            </p>
          )}
        </div>

        {/* Files List */}
        <div className="flex-1 bg-surface-container-lowest border border-white/5 rounded-2xl overflow-hidden flex flex-col min-h-0 shadow-sm">
          <div className="px-5 py-4 border-b border-white/5 bg-surface-container/30 flex items-center justify-between shrink-0">
            <h3 className="font-sans font-semibold text-sm text-slate-200">Uploaded Files</h3>
            <span className="font-sans text-xs font-medium bg-white/10 px-2 py-0.5 rounded-full text-slate-400">
              {files.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2 no-scrollbar">
            {files.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                <FileText className="w-8 h-8 mb-3 opacity-20" />
                <p className="font-sans text-sm">No materials uploaded yet.</p>
                <p className="font-sans text-xs opacity-70 mt-1">Upload PDF files above to begin studying.</p>
              </div>
            ) : (
              files.map(file => (
                <div
                  key={file.id}
                  onClick={() => toggleFileSelection(file.id)}
                  className={`group flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border ${file.selected
                    ? 'bg-primary-fixed-dim/10 border-primary-fixed-dim/30 shadow-sm shadow-primary-fixed-dim/5'
                    : 'bg-surface-container/30 border-transparent hover:bg-surface-container-high'
                    }`}
                >
                  <button className="shrink-0 text-primary-fixed-dim transition-transform group-active:scale-90">
                    {file.selected ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5 opacity-30 group-hover:opacity-100" />}
                  </button>

                  <div className="relative w-10 h-10 rounded-lg bg-surface-container-high border border-white/5 flex items-center justify-center shrink-0">
                    {getFileIcon(file.type)}
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <p className="font-sans text-sm font-medium text-slate-200 truncate leading-tight">{file.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {(file.parsed_status === 'pending' || file.parsed_status === 'processing') && (
                        <span className="flex items-center gap-1.5 text-[10px] font-medium text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded-md">
                          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse"></span>
                          Processing
                        </span>
                      )}
                      {file.parsed_status === 'failed' && (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded-md">
                          <AlertCircle className="w-3 h-3" />
                          Failed
                        </span>
                      )}
                      {file.parsed_status === 'completed' && (
                        <span className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded-md">
                          <CheckCircle2 className="w-3 h-3" />
                          Ready
                        </span>
                      )}
                      {file.parsed_status === 'completed' && file.conceptCount !== undefined && (
                        <span className="text-[10px] text-slate-400 font-medium">
                          {file.conceptCount} concepts
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={(e) => deleteFile(e, file.id)}
                    className="shrink-0 p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ─── RIGHT PANEL: AI Chatbot ────────────────────────────── */}
      <div className="flex-1 bg-surface-container-lowest border border-white/5 rounded-2xl flex flex-col overflow-hidden shadow-xl relative min-h-[50vh]">
        {/* Background glow */}
        <div className="absolute top-0 inset-x-0 h-64 bg-gradient-to-b from-primary-fixed-dim/5 to-transparent pointer-events-none" />

        {/* Chat Header */}
        <div className="px-6 py-5 border-b border-white/5 bg-surface-container/20 flex items-center justify-between backdrop-blur-md shrink-0 relative z-10">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-fixed-dim to-violet-600 flex items-center justify-center shadow-lg shadow-primary-fixed-dim/20">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-surface-container-lowest rounded-full" />
            </div>
            <div>
              <h2 className="font-display font-semibold text-lg text-white leading-tight">Study Assistant</h2>
              <p className="font-sans text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {isStreaming ? 'Thinking...' : 'Ready to help'}
              </p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-lg border border-white/5">
            <span className="font-sans text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Context:</span>
            <span className={`font-sans text-xs font-bold px-2 py-0.5 rounded ml-1 ${selectedCompletedFiles.length > 0
              ? 'text-primary-fixed-dim bg-primary-fixed-dim/10'
              : 'text-slate-500 bg-white/5'
              }`}>
              {selectedCompletedFiles.length} File{selectedCompletedFiles.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Quick Actions Bar */}
        <div className="px-4 py-3 border-b border-white/5 bg-surface-container/10 flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0 relative z-10">
          <span className="font-sans text-[10px] text-slate-500 uppercase tracking-widest font-semibold shrink-0">Quick actions:</span>
          {QUICK_ACTIONS.map(action => (
            <button
              key={action.label}
              onClick={() => handleSendMessage(action.prompt, action.mode)}
              disabled={!canChat}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-primary-fixed-dim/10 hover:border-primary-fixed-dim/30 text-slate-400 hover:text-white transition-all text-xs font-medium whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <action.icon className="w-3 h-3" />
              {action.label}
            </button>
          ))}
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth relative z-10 no-scrollbar">
          {!historyLoaded ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-primary-fixed-dim animate-spin" />
            </div>
          ) : (
            messages.map(msg => (
              <div
                key={msg.id}
                className={`flex items-start gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''} animate-in fade-in slide-in-from-bottom-2 duration-300`}
              >
                {/* Avatar */}
                <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm ${msg.role === 'user'
                  ? 'bg-surface-container-high border border-white/10'
                  : 'bg-primary-fixed-dim/20 border border-primary-fixed-dim/30'
                  }`}>
                  {msg.role === 'user'
                    ? <User className="w-4 h-4 text-slate-300" />
                    : <Bot className="w-4 h-4 text-primary-fixed-dim" />
                  }
                </div>

                {/* Bubble */}
                <div className={`max-w-[85%] sm:max-w-[78%] rounded-2xl px-5 py-3.5 shadow-sm ${msg.role === 'user'
                  ? 'bg-surface-container-high text-white rounded-tr-sm border border-white/5'
                  : 'bg-primary-fixed-dim/10 text-slate-200 rounded-tl-sm border border-primary-fixed-dim/20'
                  }`}>
                  {msg.content ? (
                    <p className="font-sans text-[15px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  ) : (
                    // Streaming typing indicator
                    <div className="flex items-center gap-1.5 py-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary-fixed-dim animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-primary-fixed-dim animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-primary-fixed-dim animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  )}
                  {/* Streaming cursor */}
                  {msg.isStreaming && msg.content && (
                    <span className="inline-block w-0.5 h-4 bg-primary-fixed-dim ml-0.5 animate-pulse align-middle" />
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Chat Error */}
        {chatError && (
          <div className="mx-4 mb-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2 text-red-400 text-sm z-10 relative">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1 font-sans text-xs">{chatError}</span>
            <button onClick={() => setChatError(null)} className="text-red-400/50 hover:text-red-400">✕</button>
          </div>
        )}

        {/* No materials warning */}
        {selectedCompletedFiles.length === 0 && historyLoaded && (
          <div className="mx-4 mb-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl flex items-center gap-2 text-yellow-400 text-sm z-10 relative">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="font-sans text-xs">
              {files.filter(f => f.selected).length > 0
                ? 'Selected materials are still processing. Please wait for them to finish.'
                : 'Please select at least one fully processed material from the left panel to start chatting.'
              }
            </span>
          </div>
        )}

        {/* Chat Input */}
        <div className="p-4 bg-surface-container/30 border-t border-white/5 backdrop-blur-md shrink-0 relative z-10">
          <form
            onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
            className="flex items-end gap-3 bg-surface-container-lowest border border-white/10 rounded-2xl p-2 shadow-inner focus-within:border-primary-fixed-dim/50 focus-within:ring-1 focus-within:ring-primary-fixed-dim/50 transition-all"
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
                  ? 'AI is responding...'
                  : selectedCompletedFiles.length > 0
                    ? 'Ask anything about your selected materials...'
                    : 'Select a processed material to start chatting...'
              }
              className="flex-1 bg-transparent border-none outline-none font-sans text-[15px] text-white placeholder:text-slate-500 min-h-[44px] max-h-[150px] resize-none py-3 px-3 scrollbar-thin overflow-hidden disabled:opacity-50"
              rows={1}
            />
            <button
              type="submit"
              disabled={!input.trim() || isStreaming || selectedCompletedFiles.length === 0}
              className="shrink-0 w-11 h-11 bg-primary-fixed-dim text-on-primary-fixed rounded-xl flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-container transition-all shadow-md shadow-primary-fixed-dim/20 mb-0.5 mr-0.5"
            >
              {isStreaming
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4 ml-0.5" />
              }
            </button>
          </form>
          <div className="mt-3 text-center">
            <p className="font-sans text-[10px] text-slate-500 flex items-center justify-center gap-1.5">
              <Sparkles className="w-3 h-3 text-primary-fixed-dim" />
              AI answers are based only on your uploaded study materials. Always verify with your source.
            </p>
          </div>
        </div>
      </div>

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
