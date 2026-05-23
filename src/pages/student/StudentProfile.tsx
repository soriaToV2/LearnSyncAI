import { useState } from 'react';
import { MapPin, Building, Users, Star, Award, BrainCircuit, Book, Box, UserPlus, UserCheck, Globe } from 'lucide-react';
import { useParams, Link } from 'react-router-dom';
import { MOCK_STUDENTS } from '../../data/mockStudents';
import StudySpacePreviewModal from './components/StudySpacePreviewModal';


export default function StudentProfile() {
  const { studentId } = useParams();
  const [activeTab, setActiveTab] = useState<'achievements' | 'spaces'>('achievements');
  const [previewSpaceId, setPreviewSpaceId] = useState<string | null>(null);

  // Look up student from mock data
  const student = MOCK_STUDENTS.find(s => s.id === studentId) || MOCK_STUDENTS.find(s => s.id === 'me');
  
  // Local state just for the UI toggle on this page.
  // In a real app this would reflect/update the backend.
  const [isFollowing, setIsFollowing] = useState(student?.isFollowing || false);
  const [followerCount, setFollowerCount] = useState(student?.followers || 0);

  if (!student) {
    return <div className="text-white p-10">Student not found.</div>;
  }

  const isMe = studentId === 'me' || studentId === undefined;

  const handleFollowToggle = () => {
    setIsFollowing(!isFollowing);
    setFollowerCount(prev => isFollowing ? prev - 1 : prev + 1);
  };

  const getIcon = (type: string, className: string) => {
    switch (type) {
      case 'BrainCircuit': return <BrainCircuit className={className} />;
      case 'Award': return <Award className={className} />;
      case 'Star': return <Star className={className} />;
      case 'Book': return <Book className={className} />;
      default: return <Award className={className} />;
    }
  };

  const getColorClasses = (colorType: string) => {
    switch (colorType) {
      case 'primary': return 'from-primary-fixed-dim/20 to-primary/5 text-primary-fixed-dim border-primary-fixed-dim/30 shadow-[inset_0_2px_10px_rgba(0,218,243,0.3)] hover:shadow-[0_10px_30px_rgba(0,218,243,0.15)]';
      case 'indigo': return 'from-indigo-500/20 to-indigo-300/5 text-indigo-400 border-indigo-400/30 shadow-[inset_0_2px_10px_rgba(99,102,241,0.3)] hover:shadow-[0_10px_30px_rgba(99,102,241,0.15)]';
      case 'emerald': return 'from-emerald-500/20 to-emerald-300/5 text-emerald-400 border-emerald-400/30 shadow-[inset_0_2px_10px_rgba(16,185,129,0.3)] hover:shadow-[0_10px_30px_rgba(16,185,129,0.15)]';
      case 'amber': return 'from-amber-500/20 to-amber-300/5 text-amber-400 border-amber-400/30 shadow-[inset_0_2px_10px_rgba(245,158,11,0.3)] hover:shadow-[0_10px_30px_rgba(245,158,11,0.15)]';
      default: return 'from-slate-500/20 to-slate-300/5 text-slate-400 border-slate-400/30';
    }
  };

  return (
    <>


      <main className="p-10 max-w-5xl mx-auto w-full">
        {/* Profile Header Area */}
        <div className="mb-12 flex flex-col md:flex-row items-center md:items-start gap-8">
          <div className="w-32 h-32 md:w-40 md:h-40 rounded-full overflow-hidden border-4 border-surface-container ring-2 ring-primary-fixed-dim/30 shadow-[0_0_30px_rgba(0,218,243,0.2)]">
            <img 
              src={student.avatar} 
              alt={student.name} 
              className="w-full h-full object-cover" 
            />
          </div>
          
          <div className="flex-1 text-center md:text-left flex flex-col items-center md:items-start">
            <h1 className="font-display text-4xl font-bold text-on-surface mb-2">{student.name}</h1>
            
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 mb-6 text-on-surface-variant font-sans text-sm">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary-container/10 border border-secondary-container/20 text-secondary-container font-semibold uppercase tracking-wider text-[11px]">
                <Building className="w-3.5 h-3.5" />
                {student.university}
              </span>
              <span className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4" />
                {student.location}
              </span>
            </div>

            <div className="flex gap-8 mb-6">
              <div className="text-center md:text-left">
                <p className="font-display text-2xl font-bold text-on-surface">{followerCount}</p>
                <p className="font-sans text-xs text-on-surface-variant uppercase tracking-widest">Followers</p>
              </div>
              <div className="text-center md:text-left">
                <p className="font-display text-2xl font-bold text-on-surface">{student.following}</p>
                <p className="font-sans text-xs text-on-surface-variant uppercase tracking-widest">Following</p>
              </div>
              <div className="text-center md:text-left">
                <p className="font-display text-2xl font-bold text-primary-fixed-dim">{student.completedSpaces}</p>
                <p className="font-sans text-xs text-primary-fixed-dim/70 uppercase tracking-widest">Completed</p>
              </div>
            </div>

            {!isMe && (
              <button 
                onClick={handleFollowToggle}
                className={`px-8 py-2.5 rounded-full font-display font-semibold transition-all active:scale-95 shadow-md flex items-center gap-2 ${
                  isFollowing 
                    ? 'bg-surface-container-high border border-white/20 text-white hover:bg-surface-container-highest' 
                    : 'bg-on-surface text-background hover:bg-white'
                }`}
              >
                {isFollowing ? (
                  <><UserCheck className="w-4 h-4" /> Following</>
                ) : (
                  <><UserPlus className="w-4 h-4" /> Follow</>
                )}
              </button>
            )}
            {isMe && (
               <button className="px-8 py-2.5 rounded-full font-display font-semibold transition-all active:scale-95 shadow-md bg-surface-container-high border border-white/20 text-white hover:bg-surface-container-highest flex items-center gap-2">
                 Edit Profile
               </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-white/10 mb-8 flex overflow-x-auto no-scrollbar gap-8">
          <button 
            onClick={() => setActiveTab('achievements')}
            className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'achievements' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
          >
            <Award className="w-4 h-4" /> Achievements
          </button>
          <button 
            onClick={() => setActiveTab('spaces')}
            className={`pb-3 font-display text-[15px] whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'spaces' ? 'text-primary-fixed-dim border-primary-fixed-dim' : 'text-on-surface-variant hover:text-on-surface border-transparent'}`}
          >
             <Box className="w-4 h-4" /> Public Study Spaces
             {student.spaces.filter(s => s.isPublic).length > 0 && (
               <span className="ml-1 px-2 py-0.5 rounded-full bg-primary-fixed-dim/10 text-primary-fixed-dim font-sans text-[11px] font-bold border border-primary-fixed-dim/20">
                 {student.spaces.filter(s => s.isPublic).length}
               </span>
             )}
          </button>
        </div>

        {/* Content */}
        {activeTab === 'achievements' && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {student.achievements.map((achievement) => {
              const colorClasses = getColorClasses(achievement.colorType);
              return (
                <div key={achievement.id} className={`glass-card rounded-2xl p-6 flex flex-col items-center text-center group transition-all duration-300 hover:-translate-y-1 ${colorClasses.includes('hover:shadow') ? colorClasses.split(' ').find(c => c.startsWith('hover:shadow')) : ''}`}>
                  <div className={`w-20 h-20 rounded-full bg-gradient-to-br flex items-center justify-center mb-4 border ${colorClasses}`}>
                    {getIcon(achievement.iconType, "w-10 h-10")}
                  </div>
                  <h4 className="font-display text-sm font-semibold text-on-surface mb-1 leading-tight">{achievement.title}</h4>
                  <p className="font-sans text-[10px] uppercase tracking-widest text-slate-400">{achievement.organization}</p>
                </div>
              );
            })}
            
            {/* Empty Slots */}
            {Array.from({ length: Math.max(0, 8 - student.achievements.length) }).map((_, i) => (
              <div key={`empty-${i}`} className="rounded-2xl p-6 flex flex-col items-center justify-center border-2 border-dashed border-white/5 opacity-50">
                 <div className="w-20 h-20 rounded-full bg-surface-container-high flex items-center justify-center mb-4">
                  <div className="w-6 h-6 rounded-full bg-surface-bright"></div>
                 </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'spaces' && (() => {
          const publicSpaces = student.spaces.filter(s => s.isPublic);
          return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {publicSpaces.map(space => (
                <div 
                  key={space.id} 
                  onClick={() => setPreviewSpaceId(space.id)}
                  className="glass-card p-6 rounded-xl border border-white/10 hover:border-primary-fixed-dim/40 transition-colors group cursor-pointer"
                >
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="font-display text-xl font-medium text-on-surface group-hover:text-primary-fixed-dim transition-colors">{space.title}</h3>
                    <div className="flex items-center gap-2">
                      {space.isTopRated && <span className="bg-primary-fixed-dim/20 text-primary-fixed-dim px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">Top Rated</span>}
                      <span className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-400/10 border border-emerald-400/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
                        <Globe className="w-3 h-3" /> Public
                      </span>
                    </div>
                  </div>
                  <p className="text-on-surface-variant text-sm mb-6">{space.description}</p>
                  <div className="flex items-center gap-4 text-xs font-semibold text-slate-400 uppercase tracking-widest">
                    <span className="flex items-center gap-1.5"><Users className="w-4 h-4"/> {space.studiedCount.toLocaleString()} Studied</span>
                  </div>
                </div>
              ))}

              {publicSpaces.length === 0 && (
                <div className="col-span-full py-14 text-center border-2 border-dashed border-white/10 rounded-2xl">
                  <Box className="w-8 h-8 text-slate-500 mx-auto mb-3" />
                  <p className="text-white font-display text-lg font-medium mb-1">
                    {isMe ? 'No public spaces yet' : 'No shared spaces'}
                  </p>
                  <p className="text-slate-400 font-sans text-sm max-w-xs mx-auto">
                    {isMe
                      ? 'Go to your Study Space and click "Publicize Space" to share your flashcard decks with followers.'
                      : `${student.name.split(' ')[0]} hasn't made any study spaces public yet.`}
                  </p>
                </div>
              )}
            </div>
          );
        })()}
      </main>
      <StudySpacePreviewModal 
        isOpen={previewSpaceId !== null} 
        onClose={() => setPreviewSpaceId(null)} 
        spaceId={previewSpaceId} 
      />
    </>
  );
}
