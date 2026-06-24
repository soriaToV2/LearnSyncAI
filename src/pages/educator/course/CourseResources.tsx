import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Plus, FileText, PlayCircle, File, Trash2,
  X, CloudUpload, FileArchive, CheckCircle2,
  Loader2, AlertCircle, RefreshCw, Cpu
} from 'lucide-react';
import CourseLayout from '../../../components/layout/CourseLayout';
import { api } from '../../../lib/api';

// ─── Types ────────────────────────────────────────────────
interface Material {
  id: string;
  course_id: string;
  title: string;
  storage_path: string;
  parsed_status: 'pending' | 'processing' | 'completed';
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────
const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv';

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (dateString?: string) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const getDocIcon = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return { icon: FileText, color: 'text-red-400', bg: 'bg-red-400/10' };
  if (['ppt', 'pptx'].includes(ext || '')) return { icon: FileText, color: 'text-orange-400', bg: 'bg-orange-400/10' };
  if (['doc', 'docx'].includes(ext || '')) return { icon: File, color: 'text-blue-400', bg: 'bg-blue-400/10' };
  if (['mp4', 'mov', 'webm'].includes(ext || '')) return { icon: PlayCircle, color: 'text-indigo-400', bg: 'bg-indigo-400/10' };
  return { icon: FileArchive, color: 'text-slate-400', bg: 'bg-surface-variant' };
};

// ─── Upload Modal Component ───────────────────────────────
function UploadModal({ courseId, onClose, onSuccess }: {
  courseId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setError(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const executeUpload = async () => {
    if (!selectedFile || !courseId) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('course_id', courseId);
      formData.append('title', selectedFile.name);

      await api.upload('/materials', formData);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Upload failed. Please try again.');
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg bg-surface-container rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/5">
          <h2 className="font-display text-xl font-bold text-on-surface">
            Upload Document
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors" disabled={uploading}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}
          
          {/* Upload Dropzone */}
          <div>
            <input ref={docInputRef} type="file" accept={DOCUMENT_ACCEPT} className="hidden" onChange={e => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); }} disabled={uploading} />
            <div
              onDragOver={e => { e.preventDefault(); if (!uploading) setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={uploading ? undefined : handleDrop}
              onClick={() => { if (!uploading) docInputRef.current?.click(); }}
              className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center text-center transition-all ${
                uploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              } ${
                dragOver ? 'border-primary-fixed-dim bg-primary-fixed-dim/5' : 'border-white/20 hover:border-primary-fixed-dim/50 hover:bg-surface-container-high'
              }`}
            >
              <CloudUpload className={`w-10 h-10 mb-3 ${dragOver ? 'text-primary-fixed-dim' : 'text-slate-500'}`} />
              {selectedFile ? (
                <div>
                  <p className="font-display text-sm font-semibold text-on-surface">{selectedFile.name}</p>
                  <p className="text-xs text-slate-400 mt-1">{formatBytes(selectedFile.size)}</p>
                </div>
              ) : (
                <div>
                  <p className="font-display text-sm font-semibold text-on-surface mb-1">Drop your file here</p>
                  <p className="text-xs text-slate-400">or click to browse · PDF, DOCX, PPTX, TXT</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex justify-end gap-3">
          <button onClick={onClose} disabled={uploading} className="px-5 py-2.5 rounded-lg text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={executeUpload}
            disabled={!selectedFile || uploading}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-primary-fixed-dim text-on-primary-fixed hover:bg-primary-container transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
          >
            {uploading ? (
              <><Loader2 className="animate-spin w-4 h-4" /> Uploading...</>
            ) : (
              <><CloudUpload className="w-4 h-4" /> Upload</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────
export default function CourseResources() {
  const { courseId } = useParams();
  
  const [materials, setMaterials] = useState<Material[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const fetchMaterials = useCallback(async () => {
    if (!courseId) return;
    try {
      const res = await api.get<Material[]>(`/materials/course/${courseId}`);
      setMaterials(res.data ?? []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch materials.');
    } finally {
      setIsLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    fetchMaterials();
    
    // Set up polling for material status updates (every 5 seconds)
    // In a real production app, you'd use Supabase Realtime subscriptions here instead of polling.
    const pollInterval = setInterval(() => {
      fetchMaterials();
    }, 5000);
    return () => clearInterval(pollInterval);
  }, [fetchMaterials]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleUploadSuccess = () => {
    fetchMaterials();
    showToast(`File uploaded successfully! AI extraction started.`);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this resource?")) return;
    try {
      await api.delete(`/materials/${id}`);
      setMaterials(prev => prev.filter(m => m.id !== id));
      showToast("Resource deleted.");
    } catch (err: any) {
      alert(err.message || 'Failed to delete resource');
    }
  };

  return (
    <CourseLayout>
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4">
          <div className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-4 py-3 rounded-xl flex items-center gap-3 shadow-lg backdrop-blur-md">
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-sans font-medium text-sm">{toast}</span>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showModal && <UploadModal courseId={courseId!} onClose={() => setShowModal(false)} onSuccess={handleUploadSuccess} />}

      <div className="space-y-6">
        {/* Header row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-xl font-semibold text-on-surface">Learning Resources</h3>
            <p className="font-sans text-sm text-on-surface-variant mt-0.5">{materials.length} resource{materials.length !== 1 ? 's' : ''} uploaded</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-display text-sm font-semibold hover:bg-primary-container transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" /> Upload Resource
          </button>
        </div>

        {/* States */}
        {isLoading && (
          <div className="flex items-center justify-center py-24 gap-3 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="font-sans text-sm">Loading resources...</span>
          </div>
        )}
        
        {!isLoading && error && (
           <div className="flex items-center gap-3 p-5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="font-sans text-sm">{error}</p>
          </div>
        )}

        {/* Resources Grid */}
        {!isLoading && !error && materials.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {materials.map(r => {
              const { icon: Icon, color, bg } = getDocIcon(r.title);
              return (
                <div
                  key={r.id}
                  className={`bg-surface-container rounded-xl p-4 border border-white/5 hover:border-white/10 transition-colors shadow-lg flex flex-col justify-between group relative overflow-hidden min-h-[120px]`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
                      <Icon className={`w-6 h-6 ${color}`} />
                    </div>
                    <div className="flex-1 min-w-0 pr-6">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-sans text-sm font-medium text-on-surface truncate group-hover:text-primary-fixed-dim transition-colors" title={r.title}>{r.title}</h4>
                      </div>
                      <p className="font-sans text-xs text-on-surface-variant truncate mb-2">{formatDate(r.created_at)}</p>
                      
                      {/* AI Parsing Status Badge */}
                      {r.parsed_status === 'completed' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 className="w-3 h-3" /> Processed
                        </span>
                      ) : r.parsed_status === 'processing' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          <RefreshCw className="w-3 h-3 animate-spin" /> Processing
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                          <Cpu className="w-3 h-3" /> Queued
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <button
                    onClick={(e) => { e.preventDefault(); handleDelete(r.id); }}
                    className="absolute top-4 right-4 p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors opacity-0 group-hover:opacity-100"
                    title="Remove resource"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : !isLoading && !error && (
          <div className="text-center py-20 border-2 border-dashed border-white/10 rounded-2xl flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-surface-variant flex items-center justify-center">
              <CloudUpload className="w-7 h-7 text-slate-500" />
            </div>
            <p className="text-slate-400 font-sans text-sm">No resources yet. Click <span className="text-white font-semibold">Upload Resource</span> to get started.</p>
            <p className="text-slate-500 font-sans text-xs max-w-xs mt-1">Uploaded documents will be automatically parsed by AI to extract key learning concepts.</p>
          </div>
        )}
      </div>
    </CourseLayout>
  );
}
