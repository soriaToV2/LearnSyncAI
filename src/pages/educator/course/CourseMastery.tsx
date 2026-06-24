import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  BrainCircuit, Sparkles, TrendingUp, Award, Users, ChevronDown,
  BookOpen, FileText, PlayCircle, File, FileArchive, Search, UserMinus, Loader2
} from 'lucide-react';
import CourseLayout from '../../../components/layout/CourseLayout';
import { api } from '../../../lib/api';
import clsx from 'clsx';

// BKT generator
const getBktMastery = (studentId: string, resourceId: string): number => {
  const codeSum = studentId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) +
                  resourceId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return 55 + (codeSum % 41); // 55% to 95%
};

const getDocIcon = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return { icon: FileText, color: 'text-red-400', bg: 'bg-red-400/10' };
  if (['ppt', 'pptx'].includes(ext || '')) return { icon: FileText, color: 'text-orange-400', bg: 'bg-orange-400/10' };
  if (['doc', 'docx'].includes(ext || '')) return { icon: File, color: 'text-blue-400', bg: 'bg-blue-400/10' };
  if (['mp4', 'mov', 'webm'].includes(ext || '')) return { icon: PlayCircle, color: 'text-indigo-400', bg: 'bg-indigo-400/10' };
  return { icon: FileArchive, color: 'text-slate-400', bg: 'bg-white/5' };
};

const COURSE_COLORS = ['#00DAF3', '#818CF8', '#34D399', '#F59E0B', '#F472B6', '#A78BFA'];
function getCourseColor(id: string) {
  const hash = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return COURSE_COLORS[hash % COURSE_COLORS.length];
}

export default function CourseMastery() {
  const { courseId } = useParams();
  
  const [course, setCourse] = useState<any>(null);
  const [resources, setResources] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [viewFilter, setViewFilter] = useState<'all' | 'highest-lowest' | 'overall-only'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [localStudents, setLocalStudents] = useState<any[]>([
    { id: 's1', name: 'Sarah Jenkins', email: 'sarah.j@mit.edu', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150' },
    { id: 's2', name: 'Marcus Thorne', email: 'marcus.t@mit.edu', avatar: 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?auto=format&fit=crop&q=80&w=150' },
    { id: 's4', name: 'Aisha Patel', email: 'aisha.p@mit.edu', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150' }
  ]);

  useEffect(() => {
    async function loadData() {
      if (!courseId) return;
      try {
        const [cRes, mRes] = await Promise.all([
          api.get(`/courses/${courseId}`),
          api.get(`/materials/course/${courseId}`)
        ]);
        setCourse(cRes.data);
        const formattedResources = ((mRes.data || []) as any[]).map((m: any) => ({
          id: m.id,
          name: m.title || m.name,
          type: m.title?.split('.').pop() || 'document',
        }));
        setResources(formattedResources);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [courseId]);

  if (isLoading) {
    return (
      <CourseLayout>
        <div className="flex items-center justify-center py-20 gap-3 text-slate-400 bg-surface-container/10 border border-white/5 rounded-2xl">
          <Loader2 className="w-6 h-6 animate-spin text-primary-fixed-dim" />
          <span className="font-sans text-sm">Loading mastery data...</span>
        </div>
      </CourseLayout>
    );
  }

  if (!course) {
    return (
      <CourseLayout>
        <div className="p-10 text-white font-sans">Course not found.</div>
      </CourseLayout>
    );
  }

  const filteredStudents = localStudents.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const courseTitle = course.course_title;
  const courseColor = getCourseColor(course.id);
  const courseCode = course.course_code || 'COURSE';

  // Calculate statistics
  let classSubjectMastery = 0;
  let highestResourceMastery = 0;
  let highestResourceName = 'None';

  if (localStudents.length > 0 && resources.length > 0) {
    let totalBkt = 0;
    let bktCount = 0;
    const resourceAverages: Record<string, { sum: number; count: number; name: string }> = {};

    localStudents.forEach(student => {
      resources.forEach(res => {
        const score = getBktMastery(student.id, res.id);
        totalBkt += score;
        bktCount++;

        if (!resourceAverages[res.id]) {
          resourceAverages[res.id] = { sum: 0, count: 0, name: res.name };
        }
        resourceAverages[res.id].sum += score;
        resourceAverages[res.id].count++;
      });
    });

    // Class average
    classSubjectMastery = Math.round(totalBkt / bktCount);

    // Highest resource
    Object.keys(resourceAverages).forEach(resId => {
      const avg = Math.round(resourceAverages[resId].sum / resourceAverages[resId].count);
      if (avg > highestResourceMastery) {
        highestResourceMastery = avg;
        highestResourceName = resourceAverages[resId].name;
      }
    });
  } else if (resources.length > 0) {
    // Fallback values
    classSubjectMastery = 75;
    highestResourceMastery = 88;
    highestResourceName = resources[0].name;
  }

  return (
    <CourseLayout>
      <div className="space-y-8">
        {/* Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-xl font-bold text-white tracking-tight">BKT Cognitive Mastery</h3>
            <p className="font-sans text-xs text-slate-400 mt-1">
              Active Bayesian Knowledge Tracing analysis for cognitive learning resources.
            </p>
          </div>

          {/* Course badge */}
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 font-sans text-xs font-semibold text-slate-300 shrink-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: courseColor }} />
            <span>{courseCode} · {courseTitle}</span>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {/* Card 1 */}
          <div className="group relative rounded-2xl bg-white/[0.02] border border-white/5 p-6 backdrop-blur-md transition-all duration-500 hover:bg-white/[0.04] hover:border-white/10 hover:shadow-[0_12px_30px_rgba(0,0,0,0.5)] overflow-hidden">
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"
              style={{ background: `radial-gradient(circle at 100% 0%, ${courseColor}12 0%, transparent 65%)` }} />
            
            <div className="flex items-center justify-between mb-4">
              <span className="font-sans text-xs text-slate-400 font-extrabold uppercase tracking-wider">Subject BKT Mastery</span>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center border border-white/10 bg-indigo-500/10 text-indigo-400">
                <BrainCircuit className="w-5 h-5" />
              </div>
            </div>
            <p className="font-display text-4xl font-black text-white tracking-tight">{classSubjectMastery}%</p>
            <p className="font-sans text-xs text-slate-500 mt-2">Class average latent skill vector</p>
          </div>

          {/* Card 2 */}
          <div className="group relative rounded-2xl bg-white/[0.02] border border-white/5 p-6 backdrop-blur-md transition-all duration-500 hover:bg-white/[0.04] hover:border-white/10 hover:shadow-[0_12px_30px_rgba(0,0,0,0.5)] overflow-hidden">
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"
              style={{ background: `radial-gradient(circle at 100% 0%, #34d39912 0%, transparent 65%)` }} />

            <div className="flex items-center justify-between mb-4">
              <span className="font-sans text-xs text-slate-400 font-extrabold uppercase tracking-wider">Highest Resource Mastery</span>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center border border-white/10 bg-emerald-500/10 text-emerald-400">
                <Award className="w-5 h-5" />
              </div>
            </div>
            <p className="font-display text-4xl font-black text-white tracking-tight">{highestResourceMastery}%</p>
            <p className="font-sans text-[11px] text-slate-400 mt-2 truncate font-semibold" title={highestResourceName}>
              {highestResourceName}
            </p>
          </div>

          {/* Card 3 */}
          <div className="group relative rounded-2xl bg-white/[0.02] border border-white/5 p-6 backdrop-blur-md transition-all duration-500 hover:bg-white/[0.04] hover:border-white/10 hover:shadow-[0_12px_30px_rgba(0,0,0,0.5)] overflow-hidden">
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"
              style={{ background: `radial-gradient(circle at 100% 0%, #22d3ee12 0%, transparent 65%)` }} />

            <div className="flex items-center justify-between mb-4">
              <span className="font-sans text-xs text-slate-400 font-extrabold uppercase tracking-wider">Enrolled Students</span>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center border border-white/10 bg-cyan-500/10 text-cyan-400">
                <Users className="w-5 h-5" />
              </div>
            </div>
            <p className="font-display text-4xl font-black text-white tracking-tight">{localStudents.length}</p>
            <p className="font-sans text-xs text-slate-500 mt-2">Active students in this course</p>
          </div>
        </div>

        {/* Student list */}
        <div className="space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-1.5 h-6 rounded" style={{ backgroundColor: courseColor }}></div>
              <h4 className="font-display text-lg font-bold text-white tracking-tight">Student-Specific BKT Breakdown</h4>
            </div>

            {/* Search and Filters */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search students..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-1.5 bg-white/5 border border-white/10 rounded-xl font-sans text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 transition-colors"
                />
              </div>

              <div className="flex bg-white/5 border border-white/10 rounded-xl p-1 gap-1 shrink-0 justify-between sm:justify-start overflow-x-auto no-scrollbar">
                {[
                  { id: 'all', label: 'All Resources' },
                  { id: 'highest-lowest', label: 'Highest & Lowest' },
                  { id: 'overall-only', label: 'Overall Only' }
                ].map(f => (
                  <button
                    key={f.id}
                    onClick={() => setViewFilter(f.id as any)}
                    className={clsx(
                      "px-3 py-1.5 rounded-lg text-xs font-semibold font-sans transition-all duration-200 shrink-0",
                      viewFilter === f.id
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                        : "text-slate-400 hover:text-white"
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filteredStudents.length > 0 ? (
            <div key={viewFilter} className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-300">
              {filteredStudents.map(student => {
                // Student average
                const resourceScores = resources.map(res => ({
                  resource: res,
                  score: getBktMastery(student.id, res.id)
                }));

                const averageBkt = resourceScores.length > 0
                  ? Math.round(resourceScores.reduce((acc, curr) => acc + curr.score, 0) / resourceScores.length)
                  : 60;

                // Find extremes
                let filteredScores = [...resourceScores];
                let highestId = '';
                let lowestId = '';

                if (resourceScores.length > 0) {
                  const sorted = [...resourceScores].sort((a, b) => b.score - a.score);
                  highestId = sorted[0].resource.id;
                  lowestId = sorted[sorted.length - 1].resource.id;

                  if (viewFilter === 'highest-lowest') {
                    if (resourceScores.length > 1) {
                      // Filter extremes
                      filteredScores = [
                        sorted[0], // High
                        sorted[sorted.length - 1] // Low
                      ];
                    } else {
                      filteredScores = [sorted[0]];
                    }
                  }
                }

                return (
                  <div
                    key={student.id}
                    className="glass-card rounded-2xl border border-white/5 p-6 space-y-6 hover:border-white/10 transition-colors"
                  >
                    {/* Student header */}
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        {student.avatar ? (
                          <img
                            src={student.avatar}
                            alt={student.name}
                            className="w-12 h-12 rounded-full object-cover border border-white/10 shrink-0"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-base uppercase shrink-0">
                            {student.name.charAt(0)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <h5 className="font-sans text-sm font-semibold text-white truncate">{student.name}</h5>
                          <p className="font-sans text-xs text-slate-500 truncate mt-0.5">{student.email}</p>
                        </div>
                      </div>

                      {/* Badge */}
                      <div className="text-right shrink-0">
                        <span className={clsx(
                          "px-2.5 py-1 rounded-lg text-xs font-bold font-mono border",
                          averageBkt >= 85
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                            : averageBkt >= 70
                            ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                            : "bg-rose-500/10 border-rose-500/20 text-rose-400"
                        )}>
                          {averageBkt}% Mastery
                        </span>
                      </div>
                    </div>

                    {/* Resources */}
                    {viewFilter !== 'overall-only' && (
                      <div className="space-y-4">
                        <p className="font-sans text-[10px] text-slate-500 font-extrabold uppercase tracking-widest border-b border-white/5 pb-2">
                          {viewFilter === 'highest-lowest' ? 'Key Cognitive Retentions' : 'Learning Resource BKT Values'}
                        </p>

                        {filteredScores.length > 0 ? (
                          <div className="space-y-3">
                            {filteredScores.map(({ resource, score }) => {
                              const { icon: Icon, color, bg } = getDocIcon(resource.name);
                              const isHighest = viewFilter === 'highest-lowest' && resource.id === highestId;
                              const isLowest = viewFilter === 'highest-lowest' && resource.id === lowestId && highestId !== lowestId;

                              return (
                                <div key={resource.id} className="space-y-1.5">
                                  <div className="flex items-center justify-between text-xs gap-3">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <div className={clsx("w-6 h-6 rounded flex items-center justify-center shrink-0", bg)}>
                                        <Icon className={clsx("w-3.5 h-3.5", color)} />
                                      </div>
                                      <span className="font-sans text-slate-300 font-medium truncate">{resource.name}</span>
                                      
                                      {/* High/low labels */}
                                      {isHighest && (
                                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[9px] font-bold uppercase tracking-wider border border-emerald-500/20 shrink-0">
                                          Highest
                                        </span>
                                      )}
                                      {isLowest && (
                                        <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 text-[9px] font-bold uppercase tracking-wider border border-rose-500/20 shrink-0">
                                          Lowest
                                        </span>
                                      )}
                                    </div>
                                    <span className={clsx(
                                      "font-mono font-bold shrink-0",
                                      score >= 85 ? "text-emerald-400" : score >= 70 ? "text-amber-400" : "text-rose-400"
                                    )}>
                                      {score}%
                                    </span>
                                  </div>
                                  <div className="w-full bg-white/5 rounded-full h-1.5 relative overflow-hidden">
                                    <div
                                      className={clsx(
                                        "h-1.5 rounded-full transition-all duration-500",
                                        score >= 85 ? "bg-emerald-400" : score >= 70 ? "bg-amber-400" : "bg-rose-400"
                                      )}
                                      style={{ width: `${score}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 py-4 text-center justify-center">
                            <BookOpen className="w-4 h-4 text-slate-500 shrink-0" />
                            <p className="font-sans text-xs text-slate-500">No learning resources uploaded yet.</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-20 border border-white/5 rounded-2xl bg-white/[0.01]">
              <Users className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <h5 className="font-sans text-sm font-semibold text-slate-300">
                {searchQuery ? 'No matching students found.' : 'No Students Enrolled'}
              </h5>
              <p className="font-sans text-xs text-slate-500 mt-1">
                {searchQuery ? 'Try adjusting your search terms.' : 'There are no students registered in this course cohort.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </CourseLayout>
  );
}
