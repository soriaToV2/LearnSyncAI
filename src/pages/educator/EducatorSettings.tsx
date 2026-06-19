import React, { useState } from 'react';
import {
  User, Palette, Building, BrainCircuit, GraduationCap, Check, CheckCircle, Edit
} from 'lucide-react';
import { EDUCATOR_PROFILE } from '../../data/mockEducatorData';
import { useEducatorTheme, THEMES } from '../../context/ThemeContext';

export default function EducatorSettings() {
  const [activeTab, setActiveTab] = useState<'profile' | 'preferences'>('profile');

  // Editable profile state (local copy — in a real app this would persist to backend)
  const [profileData, setProfileData] = useState({
    name: EDUCATOR_PROFILE.name,
    university: EDUCATOR_PROFILE.university,
    department: EDUCATOR_PROFILE.department,
    semester: EDUCATOR_PROFILE.semester,
    avatar: EDUCATOR_PROFILE.avatar,
  });
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(profileData.name);
  const [editUniversity, setEditUniversity] = useState(profileData.university);
  const [editDepartment, setEditDepartment] = useState(profileData.department);
  const [editSemester, setEditSemester] = useState(profileData.semester);
  const [editAvatar, setEditAvatar] = useState(profileData.avatar);

  const { theme: activeTheme, setTheme } = useEducatorTheme();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleProfileSave = (e: React.FormEvent) => {
    e.preventDefault();
    setProfileData({
      name: editName,
      university: editUniversity,
      department: editDepartment,
      semester: editSemester,
      avatar: editAvatar,
    });
    setIsEditing(false);
    setToastMessage('Profile updated successfully.');
    setTimeout(() => setToastMessage(null), 3000);
  };

  const startEditing = () => {
    setEditName(profileData.name);
    setEditUniversity(profileData.university);
    setEditDepartment(profileData.department);
    setEditSemester(profileData.semester);
    setEditAvatar(profileData.avatar);
    setIsEditing(true);
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

      {/* Ambient Aura */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full blur-[130px] animate-pulse" style={{ animationDuration: '8s', backgroundColor: activeTheme.accentSoft.replace('0.1', '0.12') }} />
        <div className="absolute bottom-[20%] left-[-10%] w-[500px] h-[500px] rounded-full blur-[100px] animate-pulse" style={{ animationDuration: '12s', backgroundColor: activeTheme.accentSoft.replace('0.1', '0.06') }} />
        <div className="absolute inset-0 opacity-[0.015]"
          style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '45px 45px' }} />
      </div>

      <div className="relative z-10 max-w-[1400px] mx-auto px-4 md:px-8 pt-12 pb-16 w-full">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2.5 h-2.5 rounded-full animate-ping shrink-0" style={{ backgroundColor: activeTheme.accent }}></span>
            <p className="font-mono text-xs text-slate-400 tracking-widest uppercase">
              educator.settings · system.online
            </p>
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-extrabold text-on-surface tracking-tight">
            Settings{' '}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: `linear-gradient(to right, ${activeTheme.accent}, ${activeTheme.accentDim})` }}
            >
              Overview
            </span>
          </h1>
          <p className="font-sans text-base text-slate-400 font-medium mt-2 max-w-xl">
            Manage your professor profile and customize your LearnSyncAI visual experience.
          </p>
        </div>

        {/* Settings Columns */}
        <div className="grid grid-cols-12 gap-8 items-start">

          {/* Sidebar Tabs */}
          <div className="col-span-12 lg:col-span-3 flex flex-col gap-2 bg-white/[0.01] border border-white/5 p-4 rounded-2xl backdrop-blur-md shadow-xl">
            {[
              { id: 'profile', label: 'My Educator Profile', icon: User },
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
                      ? 'border-l-4 shadow-md'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border-l-4 border-transparent'
                  }`}
                  style={activeTab === t.id ? {
                    color: activeTheme.accent,
                    backgroundColor: activeTheme.accentSoft,
                    borderLeftColor: activeTheme.accent,
                  } : {}}
                >
                  <Icon className="w-5 h-5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Content Area */}
          <div className="col-span-12 lg:col-span-9 bg-white/[0.02] border border-white/5 rounded-2xl backdrop-blur-md shadow-xl p-8 min-h-[500px]">

            {/* ── PROFILE TAB ── */}
            {activeTab === 'profile' && (
              <div className="animate-fade-in">
                {/* Profile Header */}
                <div className="mb-10 flex flex-col md:flex-row items-center md:items-start gap-8 border-b border-white/5 pb-8">
                  <div
                    className="w-32 h-32 md:w-36 md:h-36 rounded-full overflow-hidden border-4 border-surface-deep ring-2 shrink-0"
                    style={{ boxShadow: `0 0 30px ${activeTheme.accentSoft}`, ringColor: `${activeTheme.accent}50` }}
                  >
                    <img
                      src={profileData.avatar}
                      alt={profileData.name}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  <div className="flex-1 text-center md:text-left flex flex-col items-center md:items-start w-full">
                    {!isEditing ? (
                      <div className="w-full">
                        <div className="flex flex-col md:flex-row md:items-center gap-3 mb-2">
                          <h2 className="font-display text-3xl font-black text-on-surface">{profileData.name}</h2>
                          <span
                            className="font-mono text-[9px] px-2.5 py-0.5 rounded-md border font-bold uppercase tracking-wider self-center"
                            style={{ borderColor: `${activeTheme.accent}30`, backgroundColor: `${activeTheme.accent}08`, color: activeTheme.accent }}
                          >
                            Educator Account
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 mb-6 text-slate-400 font-sans text-sm font-medium">
                          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container border border-white/10 text-on-surface font-semibold uppercase tracking-wider text-[11px]">
                            <Building className="w-3.5 h-3.5" style={{ color: activeTheme.accent }} />
                            {profileData.university}
                          </span>
                          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container border border-white/10 text-on-surface font-semibold uppercase tracking-wider text-[11px]">
                            <BrainCircuit className="w-3.5 h-3.5" style={{ color: activeTheme.accent }} />
                            {profileData.department}
                          </span>
                          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container border border-white/10 text-on-surface font-semibold uppercase tracking-wider text-[11px]">
                            <GraduationCap className="w-3.5 h-3.5" style={{ color: activeTheme.accent }} />
                            {profileData.semester}
                          </span>
                        </div>

                        <button
                          onClick={startEditing}
                          className="px-6 py-2 rounded-full font-display text-xs font-bold bg-surface-container border border-white/10 text-on-surface hover:bg-white/5 transition-all active:scale-95 flex items-center gap-1.5 justify-center cursor-pointer shadow-md"
                          style={{ '--tw-border-opacity': 1 } as any}
                          onMouseEnter={e => {
                            (e.currentTarget as HTMLButtonElement).style.color = activeTheme.accent;
                            (e.currentTarget as HTMLButtonElement).style.borderColor = `${activeTheme.accent}40`;
                          }}
                          onMouseLeave={e => {
                            (e.currentTarget as HTMLButtonElement).style.color = '';
                            (e.currentTarget as HTMLButtonElement).style.borderColor = '';
                          }}
                        >
                          <Edit className="w-3.5 h-3.5" /> Edit Profile
                        </button>
                      </div>
                    ) : (
                      <form onSubmit={handleProfileSave} className="w-full flex flex-col gap-4 animate-fade-in">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                          {[
                            { label: 'Full Name', value: editName, onChange: setEditName },
                            { label: 'University', value: editUniversity, onChange: setEditUniversity },
                            { label: 'Department', value: editDepartment, onChange: setEditDepartment },
                            { label: 'Semester', value: editSemester, onChange: setEditSemester },
                          ].map(field => (
                            <div key={field.label} className="flex flex-col gap-1.5">
                              <label className="font-sans text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">{field.label}</label>
                              <input
                                type="text"
                                value={field.value}
                                onChange={e => field.onChange(e.target.value)}
                                className="bg-surface-container border border-white/10 rounded-xl px-4 py-2.5 text-on-surface font-sans text-sm outline-none transition-colors"
                                style={{ '--tw-ring-color': activeTheme.accent } as any}
                                onFocus={e => (e.currentTarget.style.borderColor = `${activeTheme.accent}60`)}
                                onBlur={e => (e.currentTarget.style.borderColor = '')}
                                required
                              />
                            </div>
                          ))}
                          <div className="flex flex-col gap-1.5 sm:col-span-2">
                            <label className="font-sans text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">Avatar URL</label>
                            <input
                              type="text"
                              value={editAvatar}
                              onChange={e => setEditAvatar(e.target.value)}
                              className="bg-surface-container border border-white/10 rounded-xl px-4 py-2.5 text-on-surface font-sans text-sm outline-none transition-colors"
                              onFocus={e => (e.currentTarget.style.borderColor = `${activeTheme.accent}60`)}
                              onBlur={e => (e.currentTarget.style.borderColor = '')}
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
                            className="px-5 py-2 rounded-xl font-display text-xs font-bold text-white transition-all active:scale-95 shadow-md flex items-center gap-1 cursor-pointer"
                            style={{ backgroundColor: activeTheme.accent, boxShadow: `0 4px 14px ${activeTheme.accentSoft}` }}
                          >
                            <Check className="w-3.5 h-3.5" /> Save Changes
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {[
                    { label: 'Active Courses', value: '3', icon: GraduationCap },
                    { label: 'Total Students', value: '134', icon: User },
                    { label: 'Assessments', value: '12', icon: BrainCircuit },
                  ].map(stat => {
                    const Icon = stat.icon;
                    return (
                      <div
                        key={stat.label}
                        className="flex flex-col items-center justify-center p-6 rounded-2xl border border-white/5 bg-white/[0.01] hover:bg-white/[0.02] hover:border-white/10 transition-all duration-300 text-center"
                      >
                        <div className="w-10 h-10 rounded-full flex items-center justify-center mb-3 border" style={{ backgroundColor: `${activeTheme.accent}15`, borderColor: `${activeTheme.accent}30` }}>
                          <Icon className="w-5 h-5" style={{ color: activeTheme.accent }} />
                        </div>
                        <p className="font-display text-2xl font-bold text-on-surface">{stat.value}</p>
                        <p className="font-sans text-[10px] text-slate-500 uppercase tracking-widest font-bold mt-1">{stat.label}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── VISUAL PREFERENCES TAB ── */}
            {activeTab === 'preferences' && (
              <div className="flex flex-col gap-8 animate-fade-in">
                <div>
                  <h3 className="font-display text-lg font-bold text-on-surface mb-1">Visual Preferences</h3>
                  <p className="font-sans text-xs text-slate-400">
                    Pick a color theme for your educator dashboard. This won't affect the student-side experience.
                  </p>
                </div>

                {/* Active theme badge */}
                <div className="flex items-center gap-3 px-5 py-3.5 rounded-xl border border-white/5 bg-white/[0.01]">
                  <div className="w-4 h-4 rounded-full ring-2 ring-white/20" style={{ backgroundColor: activeTheme.accent }} />
                  <div>
                    <p className="font-display text-sm font-bold text-on-surface">Active Educator Theme</p>
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
                          setToastMessage(`Educator theme switched to ${t.label}`);
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

                <p className="font-sans text-[11px] text-slate-500 leading-relaxed">
                  Theme preferences are saved separately for student and educator dashboards. Changes here only affect the educator experience.
                </p>
              </div>
            )}

          </div>
        </div>
      </div>
    </main>
  );
}
