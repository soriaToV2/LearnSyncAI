import ClassroomLayout from '../../components/layout/ClassroomLayout';
import { CloudUpload, FileText, PlayCircle, Box, MoreVertical } from 'lucide-react';

export default function ClassroomResources() {
  return (
    <ClassroomLayout>
      <div className="space-y-6">
        {/* Drag & Drop Zone */}
        <div className="border-2 border-dashed border-white/20 rounded-xl p-10 bg-surface-container-low/50 backdrop-blur-sm flex flex-col items-center justify-center text-center hover:bg-surface-container-low transition-colors hover:border-primary-fixed-dim/50 cursor-pointer group">
          <div className="w-16 h-16 rounded-full bg-surface-variant/50 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]">
            <CloudUpload className="text-primary-fixed-dim w-8 h-8" />
          </div>
          <h3 className="font-display text-2xl font-medium mb-2 text-on-surface">Upload Resources</h3>
          <p className="font-sans text-sm text-on-surface-variant max-w-md mx-auto">
            Drag and drop files here, or click to browse. Supports PDF, MP4, and standard 3D object formats (.obj, .gltf) for AR viewer.
          </p>
        </div>

        {/* Resources Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          
          {/* File Card: PDF */}
          <div className="bg-surface-container rounded-xl p-4 border border-white/5 hover:border-white/10 transition-colors shadow-lg flex items-start gap-4 group">
            <div className="w-12 h-12 rounded-lg bg-surface-variant flex items-center justify-center shrink-0">
              <FileText className="text-error w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-sans text-base font-medium text-on-surface truncate group-hover:text-primary-fixed-dim transition-colors">Synaptic Pathways Ch.4</h4>
              <p className="font-sans text-sm text-on-surface-variant truncate">Added 2 days ago • 2.4 MB</p>
            </div>
            <button className="text-on-surface-variant hover:text-on-surface transition-colors">
              <MoreVertical className="w-5 h-5" />
            </button>
          </div>

          {/* File Card: Video */}
          <div className="bg-surface-container rounded-xl p-4 border border-white/5 hover:border-white/10 transition-colors shadow-lg flex items-start gap-4 group">
            <div className="w-12 h-12 rounded-lg bg-surface-variant flex items-center justify-center shrink-0">
              <PlayCircle className="text-indigo-400 w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-sans text-base font-medium text-on-surface truncate group-hover:text-primary-fixed-dim transition-colors">Lecture: Neuroplasticity</h4>
              <p className="font-sans text-sm text-on-surface-variant truncate">Added yesterday • 145 MB</p>
            </div>
            <button className="text-on-surface-variant hover:text-on-surface transition-colors">
              <MoreVertical className="w-5 h-5" />
            </button>
          </div>

          {/* File Card: AR Ready */}
          <div className="bg-surface-container rounded-xl p-4 border border-primary-fixed-dim/20 hover:border-primary-fixed-dim/50 transition-colors shadow-lg flex items-start gap-4 group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-primary-fixed-dim/10 rounded-full blur-2xl -mr-8 -mt-8 pointer-events-none"></div>
            
            <div className="w-12 h-12 rounded-lg bg-primary-fixed-dim/20 flex items-center justify-center shrink-0 shadow-inner">
              <Box className="text-primary-fixed-dim w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0 relative z-10">
              <div className="flex items-center gap-2 mb-0.5">
                <h4 className="font-sans text-base font-medium text-on-surface truncate group-hover:text-primary-fixed-dim transition-colors">Human Brain Model</h4>
                <span className="px-1.5 py-0.5 rounded bg-primary-fixed-dim/20 text-primary-fixed-dim font-sans font-semibold text-[10px] tracking-[0.1em]">AR-READY</span>
              </div>
              <p className="font-sans text-sm text-on-surface-variant truncate">Added today • .gltf • 12 MB</p>
            </div>
            <button className="text-on-surface-variant hover:text-primary-fixed-dim transition-colors relative z-10">
              <MoreVertical className="w-5 h-5" />
            </button>
          </div>

        </div>
      </div>
    </ClassroomLayout>
  );
}
