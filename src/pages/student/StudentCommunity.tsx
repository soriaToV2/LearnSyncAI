import React, { useState, useMemo } from 'react';
import { Search, UserPlus, UserCheck, MapPin, Building, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { MOCK_STUDENTS, Student } from '../../data/mockStudents';

export default function StudentCommunity() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'explore' | 'following' | 'followers'>('explore');
  const [students, setStudents] = useState<Student[]>(MOCK_STUDENTS.filter(s => s.id !== 'me')); // Exclude self

  const filteredStudents = useMemo(() => {
    let list = students;
    
    // First apply tab filter
    if (activeTab === 'following') {
      list = list.filter(s => s.isFollowing);
    } else if (activeTab === 'followers') {
      list = list.filter(s => s.isFollower);
    }

    // Then apply search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s => 
        s.name.toLowerCase().includes(q) || 
        s.university.toLowerCase().includes(q)
      );
    }

    return list;
  }, [students, searchQuery, activeTab]);

  const toggleFollow = (e: React.MouseEvent, studentId: string) => {
    e.preventDefault(); // Prevent navigating to profile when clicking follow
    setStudents(prev => prev.map(s => {
      if (s.id === studentId) {
        return {
          ...s,
          isFollowing: !s.isFollowing,
          followers: s.isFollowing ? s.followers - 1 : s.followers + 1
        };
      }
      return s;
    }));
  };

  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 w-full border-b border-white/10 bg-[#020617]/80 backdrop-blur-md shadow-sm z-40 px-8 py-5 flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-on-background">Community</h1>
            <p className="text-sm font-sans text-slate-400 mt-1">Connect with fellow students, share study spaces, and grow your network.</p>
          </div>

          <div className="relative w-full md:w-96">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-slate-400" />
            </div>
            <input
              type="text"
              className="block w-full pl-10 pr-3 py-2.5 border border-white/10 rounded-xl leading-5 bg-surface-container-high text-slate-300 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-primary-fixed-dim focus:border-primary-fixed-dim sm:text-sm font-sans transition-all"
              placeholder="Search by name or university..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-6 border-b border-white/10 px-2">
          <button 
            className={`pb-4 px-2 font-display font-semibold transition-colors relative ${activeTab === 'explore' ? 'text-primary-fixed-dim' : 'text-slate-400 hover:text-white'}`}
            onClick={() => setActiveTab('explore')}
          >
            Explore
            {activeTab === 'explore' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary-fixed-dim rounded-t-full shadow-[0_0_10px_rgba(0,218,243,0.5)]"></div>}
          </button>
          <button 
            className={`pb-4 px-2 font-display font-semibold transition-colors relative ${activeTab === 'following' ? 'text-primary-fixed-dim' : 'text-slate-400 hover:text-white'}`}
            onClick={() => setActiveTab('following')}
          >
            Following
            {activeTab === 'following' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary-fixed-dim rounded-t-full shadow-[0_0_10px_rgba(0,218,243,0.5)]"></div>}
          </button>
          <button 
            className={`pb-4 px-2 font-display font-semibold transition-colors relative ${activeTab === 'followers' ? 'text-primary-fixed-dim' : 'text-slate-400 hover:text-white'}`}
            onClick={() => setActiveTab('followers')}
          >
            Followers
            {activeTab === 'followers' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-primary-fixed-dim rounded-t-full shadow-[0_0_10px_rgba(0,218,243,0.5)]"></div>}
          </button>
        </div>
      </header>

      <main className="flex-1 p-8 overflow-y-auto">
        {filteredStudents.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
            {filteredStudents.map(student => (
              <Link 
                to={`/student/profile/${student.id}`} 
                key={student.id}
                className="glass-card rounded-2xl p-6 flex flex-col hover:-translate-y-1 hover:shadow-[0_10px_30px_rgba(0,218,243,0.1)] transition-all duration-300 group relative overflow-hidden"
              >
                {/* Decorative background blur based on whether we follow them or not */}
                <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-20 transition-colors ${student.isFollowing ? 'bg-primary-fixed-dim' : 'bg-transparent'}`} />
                
                <div className="flex items-start justify-between mb-4 relative z-10">
                  <div className="flex gap-4 items-center">
                    <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-surface-container ring-1 ring-white/10 group-hover:ring-primary-fixed-dim/30 transition-all">
                      <img src={student.avatar} alt={student.name} className="w-full h-full object-cover" />
                    </div>
                    <div>
                      <h3 className="font-display font-semibold text-lg text-on-surface group-hover:text-primary-fixed-dim transition-colors flex items-center gap-2">
                        {student.name}
                        {student.isFollower && (
                          <span className="text-[9px] font-sans font-bold uppercase tracking-wider bg-white/10 text-slate-300 px-1.5 py-0.5 rounded">Follows You</span>
                        )}
                      </h3>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400 font-sans">
                        <span className="flex items-center gap-1"><Building className="w-3 h-3" /> {student.university}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-6 border-y border-white/5 py-4 relative z-10">
                  <div className="text-center">
                    <p className="text-on-surface font-semibold font-display">{student.followers}</p>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">Followers</p>
                  </div>
                  <div className="text-center border-l border-white/5">
                    <p className="text-on-surface font-semibold font-display">{student.following}</p>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">Following</p>
                  </div>
                  <div className="text-center border-l border-white/5">
                    <p className="text-primary-fixed-dim font-semibold font-display">{student.completedSpaces}</p>
                    <p className="text-[10px] text-primary-fixed-dim/60 uppercase tracking-widest mt-0.5">Spaces</p>
                  </div>
                </div>

                <div className="mt-auto pt-2 flex items-center justify-between gap-4 relative z-10">
                  <button 
                    onClick={(e) => toggleFollow(e, student.id)}
                    className={`flex-1 py-2 rounded-lg font-sans text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-95 ${
                      student.isFollowing 
                        ? 'bg-surface-container-high text-slate-300 hover:bg-surface-container-highest border border-white/10' 
                        : 'bg-primary-fixed-dim text-black hover:bg-primary-fixed-dim/90 shadow-[0_0_15px_rgba(0,218,243,0.3)]'
                    }`}
                  >
                    {student.isFollowing ? (
                      <><UserCheck className="w-4 h-4" /> Following</>
                    ) : (
                      <><UserPlus className="w-4 h-4" /> Follow</>
                    )}
                  </button>
                  <div className="w-9 h-9 rounded-lg bg-surface-container flex items-center justify-center text-slate-400 group-hover:bg-primary-fixed-dim/10 group-hover:text-primary-fixed-dim transition-colors">
                    <ChevronRight className="w-5 h-5" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center mb-4">
              <Search className="w-6 h-6 text-slate-500" />
            </div>
            <h3 className="text-lg font-display font-medium text-slate-300">No students found</h3>
            <p className="text-sm text-slate-500 mt-1 max-w-sm">We couldn't find anyone matching "{searchQuery}". Try a different name or university.</p>
          </div>
        )}
      </main>
    </div>
  );
}
