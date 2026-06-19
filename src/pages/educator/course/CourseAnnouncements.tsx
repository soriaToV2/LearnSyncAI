import React, { useState } from 'react';
import { Megaphone, Send, Clock, Trash2, Edit2, CheckCircle2, X } from 'lucide-react';
import CourseLayout from '../../../components/layout/CourseLayout';
import { useParams } from 'react-router-dom';

interface Announcement {
  id: string;
  title: string;
  content: string;
  timestamp: string;
  seenCount: number;
}

const initialAnnouncements: Announcement[] = [
  {
    id: '1',
    title: 'Midterm Exam Details',
    content: 'Hello class, just a reminder that our midterm exam is scheduled for next Tuesday. Please ensure you have reviewed chapters 1 through 4. The exam will utilize Lockdown Mode, so make sure your system is ready.',
    timestamp: '2 days ago',
    seenCount: 42
  },
  {
    id: '2',
    title: 'New Reading Material Uploaded',
    content: "I've uploaded the new interactive AR model for the human brain. Please take a look at it before our next lecture as we will be using it for our discussion on neuroplasticity.",
    timestamp: 'Last week',
    seenCount: 115
  }
];

export default function CourseAnnouncements() {
  const { courseId } = useParams();
  const [announcements, setAnnouncements] = useState<Announcement[]>(initialAnnouncements);
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handlePost = () => {
    if (content.trim() && title.trim()) {
      const newAnnouncement: Announcement = {
        id: Date.now().toString(),
        title: title.trim(),
        content: content.trim(),
        timestamp: 'Just now',
        seenCount: 0
      };
      setAnnouncements([newAnnouncement, ...announcements]);
      setContent('');
      setTitle('');
      showToast("Announcement posted successfully!");
    }
  };

  const handleDelete = (id: string) => {
    setAnnouncements(announcements.filter(a => a.id !== id));
    showToast("Announcement deleted.");
  };

  const startEditing = (announcement: Announcement) => {
    setEditingId(announcement.id);
    setEditTitle(announcement.title);
    setEditContent(announcement.content);
  };

  const saveEdit = () => {
    if (editTitle.trim() && editContent.trim()) {
      setAnnouncements(announcements.map(a =>
        a.id === editingId
          ? { ...a, title: editTitle.trim(), content: editContent.trim() }
          : a
      ));
      setEditingId(null);
      showToast("Announcement updated.");
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
              disabled={!title.trim() || !content.trim()}
              className="px-6 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-lg font-display text-sm font-semibold hover:bg-primary-container transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
            >
              <Send className="w-4 h-4" /> Post Now
            </button>
          </div>
        </div>

        <h3 className="font-display text-xl font-semibold text-on-surface mb-4">Recent Announcements</h3>

        {announcements.map((announcement) => (
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
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full bg-surface-container-high border border-white/10 rounded-lg p-3 text-on-surface font-sans text-sm outline-none focus:border-primary-fixed-dim/50 min-h-[100px] resize-y"
                />
                <div className="flex justify-end gap-2">
                  <button onClick={cancelEdit} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-300 hover:bg-white/5 transition-colors flex items-center gap-2">
                    <X className="w-4 h-4" /> Cancel
                  </button>
                  <button onClick={saveEdit} className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary-fixed-dim text-on-primary-fixed hover:bg-primary-container transition-colors flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Save
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="absolute top-6 right-6 flex md:opacity-0 md:group-hover:opacity-100 transition-opacity items-center gap-2">
                  <button onClick={() => startEditing(announcement)} className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors" title="Edit">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(announcement.id)} className="p-1.5 rounded-md text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-colors" title="Delete">
                    <Trash2 className="w-4 h-4" />
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
                        <Clock className="w-3 h-3" /> {announcement.timestamp}
                      </span>
                    </div>
                    <p className="font-sans text-sm text-on-surface-variant leading-relaxed mb-3 whitespace-pre-wrap">
                      {announcement.content}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-slate-400 font-sans">
                      <span>Seen by {announcement.seenCount} students</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </article>
        ))}

        {announcements.length === 0 && (
          <div className="text-center py-12 border-2 border-dashed border-white/10 rounded-2xl">
            <p className="text-slate-400 font-sans">No announcements posted yet.</p>
          </div>
        )}
      </div>
    </CourseLayout>
  );
}
