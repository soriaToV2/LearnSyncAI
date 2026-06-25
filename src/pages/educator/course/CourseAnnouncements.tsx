import React, { useState, useEffect } from 'react';
import { Megaphone, Send, Clock, Trash2, Edit2, CheckCircle2, X, Loader2, AlertCircle } from 'lucide-react';
import CourseLayout from '../../../components/layout/CourseLayout';
import Modal from '../../../components/ui/Modal';
import { useParams } from 'react-router-dom';
import { api } from '../../../lib/api';

interface Announcement {
  id: string;
  title: string;
  description: string;
  created_at: string;
  seenCount?: number;
}

const formatDate = (dateString?: string) => {
  if (!dateString) return 'Just now';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export default function CourseAnnouncements() {
  const { courseId } = useParams();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [announcementToDelete, setAnnouncementToDelete] = useState<Announcement | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  useEffect(() => {
    async function fetchAnnouncements() {
      if (!courseId) return;
      try {
        const res = await api.get<{ data: Announcement[] }>(`/courses/${courseId}/announcements`);
        setAnnouncements(res.data?.data || res.data || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load announcements.');
      } finally {
        setIsLoading(false);
      }
    }
    fetchAnnouncements();
  }, [courseId]);

  const handlePost = async () => {
    if (content.trim() && title.trim()) {
      setIsSubmitting(true);
      try {
        const res = await api.post<{ data: Announcement }>(`/courses/${courseId}/announcements`, {
          title: title.trim(),
          description: content.trim()
        });
        const newAnnouncement = res.data?.data || res.data;
        setAnnouncements([newAnnouncement, ...announcements]);
        setContent('');
        setTitle('');
        showToast("Announcement posted successfully!");
      } catch (err: any) {
        alert(err.message || "Failed to post announcement");
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleDeleteClick = (announcement: Announcement) => {
    setAnnouncementToDelete(announcement);
  };

  const confirmDelete = async () => {
    if (!announcementToDelete || !courseId) return;
    setIsDeleting(true);
    try {
      await api.delete(`/courses/${courseId}/announcements/${announcementToDelete.id}`);
      setAnnouncements(announcements.filter(a => a.id !== announcementToDelete.id));
      showToast("Announcement deleted.");
      setAnnouncementToDelete(null);
    } catch (err: any) {
      alert(err.message || "Failed to delete announcement");
    } finally {
      setIsDeleting(false);
    }
  };

  const startEditing = (announcement: Announcement) => {
    setEditingId(announcement.id);
    setEditTitle(announcement.title);
    setEditDescription(announcement.description);
  };

  const saveEdit = async () => {
    if (editTitle.trim() && editDescription.trim()) {
      setIsSubmitting(true);
      try {
        const res = await api.put<{ data: Announcement }>(`/courses/${courseId}/announcements/${editingId}`, {
          title: editTitle.trim(),
          description: editDescription.trim()
        });
        const updatedAnnouncement = res.data?.data || res.data;
        setAnnouncements(announcements.map(a =>
          a.id === editingId ? updatedAnnouncement : a
        ));
        setEditingId(null);
        showToast("Announcement updated.");
      } catch (err: any) {
        alert(err.message || "Failed to update announcement");
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  return (
    <CourseLayout>
      <div className="space-y-6 max-w-3xl relative">
        {toastMessage && (
          <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4">
            <div className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-4 py-3 rounded-xl flex items-center gap-3 shadow-lg backdrop-blur-md">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-sans font-medium text-sm">{toastMessage}</span>
            </div>
          </div>
        )}

        {/* Post Input */}
        <div className="glass-card rounded-xl p-6 border border-white/5 mb-8">
          <h3 className="font-display text-lg font-medium text-on-surface mb-4">Create New Announcement</h3>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Announcement Title"
            className="w-full bg-surface-container-high border border-white/10 rounded-xl px-4 py-3 text-on-surface font-display text-md placeholder:text-slate-500 outline-none focus:border-primary-fixed-dim/50 mb-4"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What do you want to announce to your students in this course?"
            className="w-full bg-surface-container-high border border-white/10 rounded-xl p-4 text-on-surface font-sans text-sm placeholder:text-slate-500 outline-none focus:border-primary-fixed-dim/50 min-h-[120px] resize-y mb-4"
          ></textarea>
          <div className="flex justify-end">
            <button
              onClick={handlePost}
              disabled={!title.trim() || !content.trim() || isSubmitting}
              className="px-6 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-lg font-display text-sm font-semibold hover:bg-primary-container transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Post Now
            </button>
          </div>
        </div>

        <h3 className="font-display text-xl font-semibold text-on-surface mb-4">Recent Announcements</h3>

        {isLoading && (
          <div className="flex items-center justify-center py-20 gap-3 text-slate-400 bg-surface-container/10 border border-white/5 rounded-2xl">
            <Loader2 className="w-6 h-6 animate-spin text-primary-fixed-dim" />
            <span className="font-sans text-sm">Loading announcements...</span>
          </div>
        )}

        {!isLoading && error && (
          <div className="flex items-center gap-3 p-5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="font-sans text-sm">{error}</p>
          </div>
        )}

        {!isLoading && !error && announcements.map((announcement) => (
          <article key={announcement.id} className="glass-card rounded-xl p-6 relative overflow-hidden border border-white/5 hover:border-white/10 transition-colors group">
            {editingId === announcement.id ? (
              <div className="space-y-4">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full bg-surface-container-high border border-white/10 rounded-lg px-3 py-2 text-on-surface font-display text-md outline-none focus:border-primary-fixed-dim/50"
                />
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full bg-surface-container-high border border-white/10 rounded-lg p-3 text-on-surface font-sans text-sm outline-none focus:border-primary-fixed-dim/50 min-h-[100px] resize-y"
                />
                <div className="flex justify-end gap-2">
                  <button onClick={cancelEdit} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors flex items-center gap-2">
                    <X className="w-4 h-4" /> Cancel
                  </button>
                  <button onClick={saveEdit} disabled={isSubmitting} className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary-fixed-dim text-on-primary-fixed hover:bg-primary-container transition-colors flex items-center gap-2 disabled:opacity-50">
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Save
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="absolute top-6 right-6 flex md:opacity-0 md:group-hover:opacity-100 transition-opacity items-center gap-1.5">
                  <button onClick={() => startEditing(announcement)} className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all" title="Edit">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDeleteClick(announcement)} className="p-1.5 rounded-lg bg-rose-500/5 border border-rose-500/10 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 hover:border-rose-500/20 transition-all" title="Delete">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary-fixed-dim/20 flex items-center justify-center shrink-0 self-start">
                    <Megaphone className="w-5 h-5 text-primary-fixed-dim" />
                  </div>
                  <div className="flex-1 min-w-0 pr-12 md:pr-16">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 mb-2">
                      <h3 className="font-display text-base sm:text-lg font-semibold text-on-surface leading-snug">{announcement.title}</h3>
                      <span className="flex items-center gap-1 text-[11px] text-slate-400 font-sans shrink-0">
                        <Clock className="w-3 h-3" /> {formatDate(announcement.created_at)}
                      </span>
                    </div>
                    <p className="font-sans text-sm text-on-surface-variant leading-relaxed mb-3 whitespace-pre-wrap">
                      {announcement.description}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-slate-400 font-sans">
                      <span>Seen by {announcement.seenCount || 0} students</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </article>
        ))}

        {!isLoading && !error && announcements.length === 0 && (
          <div className="text-center py-12 border-2 border-dashed border-white/10 rounded-2xl">
            <p className="text-slate-400 font-sans">No announcements posted yet.</p>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!announcementToDelete}
        onClose={() => setAnnouncementToDelete(null)}
        title="Delete Announcement?"
        maxWidth="max-w-sm"
      >
        {announcementToDelete && (
          <div className="space-y-6 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
              <Trash2 className="w-5 h-5" />
            </div>
            
            <div className="space-y-2">
              <p className="font-sans text-sm text-slate-300 leading-relaxed">
                Are you sure you want to delete <span className="text-white font-semibold">"{announcementToDelete.title}"</span>?
              </p>
              <p className="font-sans text-xs text-slate-500">
                This action is permanent and cannot be undone.
              </p>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setAnnouncementToDelete(null)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 font-sans text-xs font-bold uppercase transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={isDeleting}
                className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-sans text-xs font-bold uppercase transition-all shadow-lg shadow-rose-600/20 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        )}
      </Modal>
    </CourseLayout>
  );
}
