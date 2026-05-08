import React from 'react';
import { useParams } from 'react-router-dom';
import { CloudUpload, FileText, PlayCircle, Box, MoreVertical, File, Trash2 } from 'lucide-react';
import CourseLayout from '../../../components/layout/CourseLayout';
import { getCourseById } from '../../../data/mockEducatorData';

const typeIcon: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
  pdf: { icon: FileText, color: 'text-red-400' },
  video: { icon: PlayCircle, color: 'text-indigo-400' },
  document: { icon: File, color: 'text-slate-400' },
  model: { icon: Box, color: 'text-primary-fixed-dim' },
};

export default function CourseResources() {
  const { courseId } = useParams();
  const course = getCourseById(courseId || '');

  return (
    <CourseLayout>
      <div className="space-y-6">
        {/* Upload Zone */}
        <div className="border-2 border-dashed border-white/20 rounded-xl p-10 bg-surface-container-low/50 backdrop-blur-sm flex flex-col items-center justify-center text-center hover:bg-surface-container-low transition-colors hover:border-primary-fixed-dim/50 cursor-pointer group">
          <div className="w-16 h-16 rounded-full bg-surface-variant/50 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <CloudUpload className="text-primary-fixed-dim w-8 h-8" />
          </div>
          <h3 className="font-display text-xl font-medium mb-2 text-on-surface">Upload Resources</h3>
          <p className="font-sans text-sm text-on-surface-variant max-w-md mx-auto">
            Drag and drop files here, or click to browse. Supports PDF, MP4, DOCX, and 3D object formats.
          </p>
        </div>

        {/* Resources Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {course?.resources.map(r => {
            const t = typeIcon[r.type] || typeIcon.document;
            const Icon = t.icon;
            const isAR = r.type === 'model';
            return (
              <div key={r.id} className={`bg-surface-container rounded-xl p-4 border ${isAR ? 'border-primary-fixed-dim/20 hover:border-primary-fixed-dim/50' : 'border-white/5 hover:border-white/10'} transition-colors shadow-lg flex items-start gap-4 group relative overflow-hidden`}>
                {isAR && <div className="absolute top-0 right-0 w-24 h-24 bg-primary-fixed-dim/10 rounded-full blur-2xl -mr-8 -mt-8 pointer-events-none" />}
                <div className={`w-12 h-12 rounded-lg ${isAR ? 'bg-primary-fixed-dim/20' : 'bg-surface-variant'} flex items-center justify-center shrink-0`}>
                  <Icon className={`w-6 h-6 ${t.color}`} />
                </div>
                <div className="flex-1 min-w-0 relative z-10">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h4 className="font-sans text-sm font-medium text-on-surface truncate group-hover:text-primary-fixed-dim transition-colors">{r.name}</h4>
                    {isAR && <span className="px-1.5 py-0.5 rounded bg-primary-fixed-dim/20 text-primary-fixed-dim font-sans font-semibold text-[9px] tracking-[0.1em]">AR-READY</span>}
                  </div>
                  <p className="font-sans text-xs text-on-surface-variant truncate">{r.uploadedAt} · {r.size}</p>
                </div>
                <button className="text-on-surface-variant hover:text-on-surface transition-colors relative z-10">
                  <MoreVertical className="w-5 h-5" />
                </button>
              </div>
            );
          })}
        </div>
        {(!course || course.resources.length === 0) && (
          <div className="text-center py-12 border-2 border-dashed border-white/10 rounded-2xl">
            <p className="text-slate-400 font-sans">No resources uploaded yet.</p>
          </div>
        )}
      </div>
    </CourseLayout>
  );
}
