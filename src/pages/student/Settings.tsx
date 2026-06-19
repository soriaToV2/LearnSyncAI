import React, { useState } from 'react';
import {
  User, Palette, MapPin, Building, Award, BrainCircuit, Book, Box, Globe, Users, CheckCircle, Edit, Check
} from 'lucide-react';
import { MOCK_STUDENTS } from '../../data/mockStudents';
import { useStudentTheme, THEMES } from '../../context/ThemeContext';

export default function Settings() {
  const [activeTab, setActiveTab] = useState<'profile' | 'preferences'>('profile');
  const [studentData, setStudentData] = useState(MOCK_STUDENTS[0]); // current user

  // Profile sub-tabs
  const [profileSubTab, setProfileSubTab] = useState<'achievements' | 'spaces'>('achievements');

  // Profile editing states
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(studentData.name);
  const [editUniversity, setEditUniversity] = useState(studentData.university);
  const [editLocation, setEditLocation] = useState(studentData.location);
  const [editAvatar, setEditAvatar] = useState(studentData.avatar);

  // Theme & toast states
  const { theme: activeTheme, setTheme } = useStudentTheme();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleProfileSave = (e: React.FormEvent) => {
    e.preventDefault();
    setStudentData(prev => ({
      ...prev,
      name: editName,
      university: editUniversity,
      location: editLocation,
      avatar: editAvatar
    }));
    setIsEditing(false);
    
    // Show save toast
    setToastMessage('Profile details updated successfully.');
    setTimeout(() => setToastMessage(null), 3000);
  };

  const getIcon = (type: string, className: string) => {
    switch (type) {
      case 'BrainCircuit': return <BrainCircuit className={className} />;
      case 'Award': return <Award className={className} />;
      case 'Star': return <Award className={className} />;
      case 'Book': return <Book className={className} />;
      default: return <Award className={className} />;
    }
  };

  const getColorClasses = (colorType: string) => {
    switch (colorType) {
      case 'primary': return 'from-[#22d3ee]/20 to-[#22d3ee]/5 text-[#22d3ee] border-[#22d3ee]/30';
      case 'indigo': return 'from-indigo-500/20 to-indigo-300/5 text-indigo-400 border-indigo-400/30';
      case 'emerald': return 'from-emerald-500/20 to-emerald-300/5 text-emerald-400 border-emerald-400/30';
      case 'amber': return 'from-amber-500/20 to-amber-300/5 text-amber-400 border-amber-400/30';
      default: return 'from-slate-500/20 to-slate-300/5 text-slate-400 border-slate-400/30';
    }
  };

  return (
    <main className="flex-1 overflow-y-auto bg-page relative">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-6 py-4 rounded-2xl backdrop-blur-xl shadow-[0_20px_50px_rgba(16,185,129,0.15)] animate-slide-in">
          <CheckCircle className="w-5 h-5 text-emerald-400" />
          <span className="font-sans text-sm font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Premium Ambient Aura Blurs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full blur-[130px] animate-pulse" style={{ animationDuration: '8s', backgroundColor: activeTheme.accentSoft.replace('0.1', '0.12') }} />
        <div className="absolute bottom-[20%] left-[-10%] w-[500px] h-[500px] rounded-full blur-[100px] animate-pulse" style={{ animationDuration: '12s', backgroundColor: activeTheme.accentSoft.replace('0.1', '0.06') }} />
        <div className="absolute inset-0 opacity-[0.02]"
          style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '45px 45px' }} />
      </div>

      <div className="relative z-10 max-w-[1400px] mx-auto px-4 md:px-8 pt-12 pb-16 w-full">
        {/* Header Section */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping shrink-0"></span>
            <p className="font-mono text-xs text-slate-400 tracking-widest uppercase">
              student.settings · system.online
            </p>
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-extrabold text-on-surface tracking-tight flex items-center gap-3">
            Settings <span className="bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent">Overview</span>
          </h1>
          <p className="font-sans text-base text-slate-400 font-medium mt-2 max-w-xl">
            Customize student profile options and visual layout display preferences.
          </p>
        </div>

        {/* Settings Columns */}
        <div className="grid grid-cols-12 gap-8 items-start">
          
          {/* Tabs Navigation sidebar inside page - 3 cols */}
          <div className="col-span-12 lg:col-span-3 flex flex-col gap-2 bg-white/[0.01] border border-white/5 p-4 rounded-2xl backdrop-blur-md shadow-xl">
            {[
              { id: 'profile', label: 'My Student Profile', icon: User },
              { id: 'preferences', label: 'Visual Preferences', icon: Palette },
            ].map(t => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setActiveTab(t.id as any);
                    setIsEditing(false);
                  }}
                  className={`flex items-center gap-3.5 px-4 py-3.5 rounded-xl font-display text-sm font-semibold tracking-wide transition-all active:scale-98 text-left ${
                    activeTab === t.id
                      ? 'text-cyan-400 bg-cyan-400/10 border-l-4 border-cyan-400 shadow-md shadow-cyan-500/5'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border-l-4 border-transparent'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Form Content Area - 9 cols */}
          <div className="col-span-12 lg:col-span-9 bg-white/[0.02] border border-white/5 rounded-2xl backdrop-blur-md shadow-xl p-8 min-h-[500px]">
            
            {/* PROFILE TAB */}
            {activeTab === 'profile' && (
              <div className="animate-fade-in">
                {/* Profile Header Area */}
                <div className="mb-10 flex flex-col md:flex-row items-center md:items-start gap-8 border-b border-white/5 pb-8">
                  <div className="w-32 h-32 md:w-36 md:h-36 rounded-full overflow-hidden border-4 border-surface-deep ring-2 shadow-[0_0_30px_rgba(34,211,238,0.2)] shrink-0" style={{ ringColor: `${activeTheme.accent}50` }}>
                    <img 
                      src={studentData.avatar} 
                      alt={studentData.name} 
                      className="w-full h-full object-cover" 
                    />
                  </div>
                  
                  <div className="flex-1 text-center md:text-left flex flex-col items-center md:items-start w-full">
                    {!isEditing ? (
                      /* Read-Only Profile Info */
                      <div className="w-full">
                        <div className="flex flex-col md:flex-row md:items-center gap-3 mb-2">
                          <h2 className="font-display text-3xl font-black text-on-surface">{studentData.name}</h2>
                          <span className="font-mono text-[9px] px-2.5 py-0.5 rounded-md border border-cyan-400/20 bg-cyan-400/5 text-cyan-400 font-bold uppercase tracking-wider self-center">
                            Student Account
                          </span>
                        </div>
                        
                        <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 mb-6 text-slate-400 font-sans text-sm font-medium">
                          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container border border-white/10 text-on-surface font-semibold uppercase tracking-wider text-[11px]">
                            <Building className="w-3.5 h-3.5 text-cyan-400" />
                            {studentData.university}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <MapPin className="w-4 h-4 text-slate-500" />
                            {studentData.location}
                          </span>
                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 w-full">
                          <div className="flex gap-8">
                            <div className="text-center md:text-left">
                              <p className="font-display text-2xl font-bold text-on-surface">{studentData.followers}</p>
                              <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest font-bold">Followers</p>
                            </div>
                            <div className="text-center md:text-left">
                              <p className="font-display text-2xl font-bold text-on-surface">{studentData.following}</p>
                              <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest font-bold">Following</p>
                            </div>
                            <div className="text-center md:text-left">
                              <p className="font-display text-2xl font-bold text-cyan-400">{studentData.completedSpaces}</p>
                              <p className="font-sans text-[10px] text-cyan-400/70 uppercase tracking-widest font-bold">Completed</p>
                            </div>
                          </div>
                          
                          <button 
                            onClick={() => {
                              setEditName(studentData.name);
                              setEditUniversity(studentData.university);
                              setEditLocation(studentData.location);
                              setEditAvatar(studentData.avatar);
                              setIsEditing(true);
                            }}
                            className="px-6 py-2 rounded-full font-display text-xs font-bold bg-surface-container border border-white/10 text-on-surface hover:bg-cyan-400/10 hover:text-cyan-400 hover:border-cyan-400/30 transition-all active:scale-95 flex items-center gap-1.5 justify-center cursor-pointer shadow-md"
                          >
                            <Edit className="w-3.5 h-3.5" /> Edit Profile Card
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Profile Edit Form */
                      <form onSubmit={handleProfileSave} className="w-full flex flex-col gap-4 animate-fade-in">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                          <div className="flex flex-col gap-1.5">
                            <label className="font-sans text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">Full Name</label>
                            <input 
                              type="text" 
                              value={editName} 
                              onChange={e => setEditName(e.target.value)}
                              className="bg-surface-container border border-white/10 rounded-xl px-4 py-2.5 text-on-surface font-sans text-sm outline-none focus:border-cyan-400/50 transition-colors"
                              required
                            />
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <label className="font-sans text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">University</label>
                            <input 
                              type="text" 
                              value={editUniversity} 
                              onChange={e => setEditUniversity(e.target.value)}
                              className="bg-surface-container border border-white/10 rounded-xl px-4 py-2.5 text-on-surface font-sans text-sm outline-none focus:border-cyan-400/50 transition-colors"
                              required
                            />
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <label className="font-sans text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">Location</label>
                            <input 
                              type="text" 
                              value={editLocation} 
                              onChange={e => setEditLocation(e.target.value)}
                              className="bg-surface-container border border-white/10 rounded-xl px-4 py-2.5 text-on-surface font-sans text-sm outline-none focus:border-cyan-400/50 transition-colors"
                              required
                            />
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <label className="font-sans text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">Avatar URL</label>
                            <input 
                              type="text" 
                              value={editAvatar} 
                              onChange={e => setEditAvatar(e.target.value)}
                              className="bg-surface-container border border-white/10 rounded-xl px-4 py-2.5 text-on-surface font-sans text-sm outline-none focus:border-cyan-400/50 transition-colors"
                              required
                            />
                          </div>
                        </div>

                        <div className="flex items-center gap-3 justify-end mt-2">
                          <button 
                            type="button" 
                            onClick={() => setIsEditing(false)}
                            className="px-5 py-2 rounded-xl bg-white/5 border border-white/5 text-slate-300 font-display text-xs font-semibold hover:bg-white/10 transition-all active:scale-95"
                          >
                            Cancel
                          </button>
                          <button 
                            type="submit" 
                            className="px-5 py-2 rounded-xl bg-cyan-400 text-page font-display text-xs font-bold hover:bg-cyan-300 transition-all active:scale-95 shadow-md shadow-cyan-500/10 flex items-center gap-1 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" /> Save Changes
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>

                {/* Achievements and spaces tabs */}
                <div className="border-b border-white/10 mb-8 flex gap-8">
                  <button 
                    onClick={() => setProfileSubTab('achievements')}
                    className={`pb-3 font-display text-sm font-bold whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 ${profileSubTab === 'achievements' ? 'text-cyan-400 border-cyan-400' : 'text-slate-400 hover:text-slate-200 border-transparent'}`}
                  >
                    <Award className="w-4 h-4" /> Achievements ({studentData.achievements.length})
                  </button>
                  <button 
                    onClick={() => setProfileSubTab('spaces')}
                    className={`pb-3 font-display text-sm font-bold whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 ${profileSubTab === 'spaces' ? 'text-cyan-400 border-cyan-400' : 'text-slate-400 hover:text-slate-200 border-transparent'}`}
                  >
                     <Box className="w-4 h-4" /> Shared Spaces ({studentData.spaces.filter(s => s.isPublic).length})
                  </button>
                </div>

                {/* Sub tab contents */}
                {profileSubTab === 'achievements' && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
                    {studentData.achievements.map((achievement) => {
                      const colorClasses = getColorClasses(achievement.colorType);
                      return (
                        <div key={achievement.id} className="relative rounded-2xl p-5 border border-white/5 bg-white/[0.01] flex flex-col items-center text-center hover:bg-white/[0.02] hover:border-white/10 transition-all duration-300">
                          <div className={`w-16 h-16 rounded-full bg-gradient-to-br flex items-center justify-center mb-3 border ${colorClasses}`}>
                            {getIcon(achievement.iconType, "w-8 h-8")}
                          </div>
                          <h4 className="font-display text-xs font-bold text-on-surface mb-0.5">{achievement.title}</h4>
                          <p className="font-sans text-[9px] uppercase tracking-widest text-slate-500">{achievement.organization}</p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {profileSubTab === 'spaces' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {studentData.spaces.filter(s => s.isPublic).map(space => (
                      <div key={space.id} className="p-5 rounded-xl border border-white/5 bg-white/[0.01] hover:border-cyan-400/20 hover:bg-white/[0.02] transition-all">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-display text-base font-bold text-on-surface">{space.title}</h3>
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-400/10 border border-emerald-400/20 text-emerald-400 text-[9px] font-bold uppercase tracking-wider">
                            Public
                          </span>
                        </div>
                        <p className="text-slate-400 text-xs line-clamp-2 mb-4">{space.description}</p>
                        <div className="flex items-center text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                          <Users className="w-3.5 h-3.5 mr-1" /> {space.studiedCount.toLocaleString()} Studied
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* VISUAL TAB */}
            {activeTab === 'preferences' && (
              <div className="flex flex-col gap-8 animate-fade-in">
                {/* Header */}
                <div>
                  <h3 className="font-display text-lg font-bold text-on-surface mb-1">Visual Preferences</h3>
                  <p className="font-sans text-xs text-slate-400">Pick a color theme to instantly apply across the entire LearnSyncAI UI.</p>
                </div>

                {/* Active theme badge */}
                <div className="flex items-center gap-3 px-5 py-3.5 rounded-xl border border-white/5 bg-white/[0.01]">
                  <div className="w-4 h-4 rounded-full ring-2 ring-white/20" style={{ backgroundColor: activeTheme.accent }} />
                  <div>
                    <p className="font-display text-sm font-bold text-on-surface">Active Theme</p>
                    <p className="font-mono text-[10px] text-slate-400 tracking-widest uppercase">{activeTheme.label}</p>
                  </div>
                </div>

                {/* Theme grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {THEMES.map(t => {
                    const isActive = t.id === activeTheme.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => {
                          setTheme(t.id);
                          setToastMessage(`Theme switched to ${t.label}`);
                          setTimeout(() => setToastMessage(null), 3000);
                        }}
                        className={`relative group flex flex-col items-start gap-3 p-5 rounded-2xl border transition-all duration-300 active:scale-95 text-left cursor-pointer ${
                          isActive
                            ? 'border-white/30 bg-white/[0.04] shadow-lg'
                            : 'border-white/5 bg-white/[0.01] hover:bg-white/[0.03] hover:border-white/15'
                        }`}
                        style={isActive ? { boxShadow: `0 0 20px ${t.glow}` } : {}}
                      >
                        {/* Color swatch row */}
                        <div className="flex items-center gap-2">
                          <div
                            className="w-8 h-8 rounded-full ring-2 ring-white/10 shadow-md transition-transform duration-300 group-hover:scale-110"
                            style={{ backgroundColor: t.accent, boxShadow: isActive ? `0 0 14px ${t.glow}` : 'none' }}
                          />
                          <div
                            className="w-5 h-5 rounded-full opacity-60"
                            style={{ backgroundColor: t.accentDim }}
                          />
                          <div
                            className="w-3 h-3 rounded-full opacity-30"
                            style={{ backgroundColor: t.accent }}
                          />
                        </div>

                        {/* Label */}
                        <div>
                          <p className="font-display text-sm font-bold text-on-surface leading-tight">{t.label}</p>
                          <p className="font-mono text-[9px] uppercase tracking-widest mt-0.5" style={{ color: t.accent }}>{t.accent}</p>
                        </div>

                        {/* Active checkmark */}
                        {isActive && (
                          <span
                            className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center"
                            style={{ backgroundColor: t.accentSoft, border: `1px solid ${t.accent}` }}
                          >
                            <Check className="w-3 h-3" style={{ color: t.accent }} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Subtle note */}
                <p className="font-sans text-[11px] text-slate-500 leading-relaxed">
                  Theme preferences are saved locally and persist across sessions.
                </p>
              </div>
            )}

          </div>
        </div>
      </div>
    </main>
  );
}
