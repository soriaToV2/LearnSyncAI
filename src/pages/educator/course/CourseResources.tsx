import React, { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  Plus, FileText, PlayCircle, File, Trash2,
  X, CloudUpload, FileArchive, CheckCircle2
} from 'lucide-react';
import CourseLayout from '../../../components/layout/CourseLayout';
import { getCourseById } from '../../../data/mockEducatorData';

// Types
type ResourceType = 'document';

interface LocalResource {
  id: string;
  name: string;
  type: string;
  size: string;
  uploadedAt: string;
}

// Helpers
const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv';

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getDocIcon = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return { icon: FileText, color: 'text-red-400', bg: 'bg-red-400/10' };
  if (['ppt', 'pptx'].includes(ext || '')) return { icon: FileText, color: 'text-orange-400', bg: 'bg-orange-400/10' };
  if (['doc', 'docx'].includes(ext || '')) return { icon: File, color: 'text-blue-400', bg: 'bg-blue-400/10' };
  if (['mp4', 'mov', 'webm'].includes(ext || '')) return { icon: PlayCircle, color: 'text-indigo-400', bg: 'bg-indigo-400/10' };
  return { icon: FileArchive, color: 'text-slate-400', bg: 'bg-surface-variant' };
};

// Upload Modal
function UploadModal({ onClose, onUpload }: {
  onClose: () => void;
  onUpload: (resource: LocalResource) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const docInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const simulateUpload = () => {
    if (!selectedFile) return;
    setUploading(true);
    setTimeout(() => {
      onUpload({
        id: Date.now().toString(),
        name: selectedFile.name,
        type: selectedFile.name.split('.').pop() || 'document',
        size: formatBytes(selectedFile.size),
        uploadedAt: 'Just now',
      });
      setUploading(false);
      onClose();
    }, 1200);
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
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {/* Upload Document */}
          <div>
            <input ref={docInputRef} type="file" accept={DOCUMENT_ACCEPT} className="hidden" onChange={e => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); }} />
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => docInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${dragOver ? 'border-primary-fixed-dim bg-primary-fixed-dim/5' : 'border-white/20 hover:border-primary-fixed-dim/50 hover:bg-surface-container-high'}`}
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
                  <p className="text-xs text-slate-400">or click to browse · PDF, DOCX, PPTX, XLSX, TXT</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 rounded-lg text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors">
            Cancel
          </button>
          <button
            onClick={simulateUpload}
            disabled={!selectedFile || uploading}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-primary-fixed-dim text-on-primary-fixed hover:bg-primary-container transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
          >
            {uploading ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Uploading…
              </>
            ) : (
              <>
                <CloudUpload className="w-4 h-4" /> Upload
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Main Component
export default function CourseResources() {
  const { courseId } = useParams();
  const course = getCourseById(courseId || '');
  const [showModal, setShowModal] = useState(false);
  const [localResources, setLocalResources] = useState<LocalResource[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleUpload = (resource: LocalResource) => {
    setLocalResources(prev => [resource, ...prev]);
    showToast(`"${resource.name}" uploaded successfully!`);
  };

  const handleDelete = (id: string) => {
    setLocalResources(prev => prev.filter(r => r.id !== id));
    showToast("Resource removed.");
  };

  // Combine mock + local
  const allResources = [
    ...localResources,
    ...(course?.resources.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      size: r.size,
      uploadedAt: r.uploadedAt,
    })) ?? [])
  ];

  return (
    <CourseLayout>
      {/* Toast */}
      {toast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-4 py-3 rounded-xl flex items-center gap-3 shadow-lg backdrop-blur-md">
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-sans font-medium text-sm">{toast}</span>
          </div>
        </div>
      )}

      {showModal && <UploadModal onClose={() => setShowModal(false)} onUpload={handleUpload} />}

      <div className="space-y-6">
        {/* Header row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-xl font-semibold text-on-surface">Learning Resources</h3>
            <p className="font-sans text-sm text-on-surface-variant mt-0.5">{allResources.length} resource{allResources.length !== 1 ? 's' : ''} uploaded</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-xl font-display text-sm font-semibold hover:bg-primary-container transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" /> Upload Resource
          </button>
        </div>

        {/* Resources Grid */}
        {allResources.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {allResources.map(r => {
              const { icon: Icon, color, bg } = getDocIcon(r.name);
              return (
                <div
                  key={r.id}
                  className={`bg-surface-container rounded-xl p-4 border border-white/5 hover:border-white/10 transition-colors shadow-lg flex items-start gap-4 group relative overflow-hidden`}
                >
                  <div className={`w-12 h-12 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-6 h-6 ${color}`} />
                  </div>
                  <div className="flex-1 min-w-0 relative z-10">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h4 className="font-sans text-sm font-medium text-on-surface truncate group-hover:text-primary-fixed-dim transition-colors">{r.name}</h4>
                    </div>
                    <p className="font-sans text-xs text-on-surface-variant truncate">{r.uploadedAt} · {r.size}</p>
                  </div>
                  <button
                    onClick={() => handleDelete(r.id)}
                    className="text-slate-600 hover:text-red-400 transition-colors relative z-10 opacity-0 group-hover:opacity-100"
                    title="Remove resource"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-20 border-2 border-dashed border-white/10 rounded-2xl flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-surface-variant flex items-center justify-center">
              <CloudUpload className="w-7 h-7 text-slate-500" />
            </div>
            <p className="text-slate-400 font-sans text-sm">No resources yet. Click <span className="text-white font-semibold">Upload Resource</span> to get started.</p>
          </div>
        )}
      </div>
    </CourseLayout>
  );
}
