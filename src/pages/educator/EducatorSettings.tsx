import { useState } from 'react';
import {
  User, Palette, BookOpen, Check, ShieldCheck, Mail, Sparkles,
} from 'lucide-react';
import { useEducatorTheme, THEMES } from '../../context/ThemeContext';
import { EDUCATOR } from '../../data/mockEducator';

type Tab = 'profile' | 'appearance';

export default function EducatorSettings() {
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const { theme: activeTheme, setTheme } = useEducatorTheme();
  const [toast, setToast] = useState<string | null>(null);

  const TABS: Array<{ id: Tab; label: string; icon: typeof User }> = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'appearance', label: 'Appearance', icon: Palette },
  ];

  return (
    <main className="flex-1 overflow-y-auto bg-background">
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[70] animate-in fade-in slide-in-from-top-3 duration-200">
          <div className="flex items-center gap-3 bg-surface-container-high border border-white/10 px-5 py-3 rounded-2xl shadow-2xl backdrop-blur-md">
            <Sparkles className="w-4 h-4" style={{ color: activeTheme.accent }} />
            <span className="font-sans text-sm text-white font-medium">{toast}</span>
          </div>
        </div>
      )}

      <div className="max-w-[900px] mx-auto px-4 md:px-8 py-8 md:py-12">

        <header className="mb-8">
          <h1 className="font-display text-3xl font-semibold text-on-surface">Settings</h1>
          <p className="font-sans text-sm text-on-surface-variant mt-1.5">
            Your account details and how the portal looks.
          </p>
        </header>

        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-surface-container/40 border border-white/5 w-fit mb-8">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg font-display text-sm font-semibold transition-all ${
                activeTab === id
                  ? 'bg-primary-fixed-dim/15 text-primary-fixed-dim border border-primary-fixed-dim/30'
                  : 'text-slate-400 hover:text-white border border-transparent'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'profile' && (
          <div className="flex flex-col gap-6">

            {/* Identity */}
            <section className="rounded-2xl bg-white/[0.02] border border-white/5 p-6">
              <div className="flex items-center gap-4 mb-6">
                <div
                  className="w-16 h-16 rounded-2xl border flex items-center justify-center shrink-0 font-display text-xl font-bold"
                  style={{
                    backgroundColor: activeTheme.accentSoft,
                    borderColor: `${activeTheme.accent}40`,
                    color: activeTheme.accent,
                  }}
                >
                  {EDUCATOR.first_name[0]}{EDUCATOR.last_name[0]}
                </div>
                <div className="min-w-0">
                  <h2 className="font-display text-xl font-semibold text-white">
                    {EDUCATOR.first_name} {EDUCATOR.last_name}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <span className="px-2 py-0.5 rounded-md bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 text-primary-fixed-dim font-sans text-[10px] font-bold uppercase tracking-wider">
                      Educator
                    </span>
                    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-sans text-[10px] font-bold uppercase tracking-wider">
                      <ShieldCheck className="w-3 h-3" />
                      {EDUCATOR.status}
                    </span>
                  </div>
                </div>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-white/[0.02] border border-white/5">
                  <Mail className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <dt className="font-sans text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
                      Email
                    </dt>
                    <dd className="font-sans text-sm text-slate-200 truncate">{EDUCATOR.email}</dd>
                  </div>
                </div>

                <div className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-white/[0.02] border border-white/5">
                  <User className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <dt className="font-sans text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
                      Role
                    </dt>
                    <dd className="font-sans text-sm text-slate-200">
                      Educator — uploads materials and monitors mastery
                    </dd>
                  </div>
                </div>
              </dl>
            </section>

            {/* How publishing works */}
            <section className="rounded-2xl bg-white/[0.02] border border-white/5 p-6">
              <div className="flex items-center gap-2 mb-5">
                <BookOpen className="w-4 h-4 text-slate-400" />
                <h2 className="font-display text-lg font-bold text-white">How Publishing Works</h2>
              </div>

              <div className="flex flex-col gap-2.5">
                {[
                  'Choose the subject and the grade levels for each material as you upload it. Nothing is assigned to you in advance.',
                  'Students in the grades you selected can pull that material into a study space.',
                  "Open a material and its Class Performance tab shows exactly those grades — publish to Grade 8 and you see Grade 8's students.",
                  'An administrator manages accounts only, and never sees student learning data.',
                ].map((line, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 px-4 py-3.5 rounded-xl bg-white/[0.02] border border-white/5"
                  >
                    <span className="w-5 h-5 rounded-md bg-white/5 border border-white/10 flex items-center justify-center shrink-0 mt-0.5 font-sans text-[10px] font-bold text-slate-400 tabular-nums">
                      {i + 1}
                    </span>
                    <p className="font-sans text-xs text-slate-300 leading-relaxed">{line}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'appearance' && (
          <section className="rounded-2xl bg-white/[0.02] border border-white/5 p-6">
            <h2 className="font-display text-lg font-bold text-white mb-1">Theme</h2>
            <p className="font-sans text-sm text-slate-400 mb-6">
              Applies to the educator portal only. Your students' theme is unaffected.
            </p>

            <div className="flex items-center gap-3 px-5 py-3.5 rounded-xl border border-white/5 bg-white/[0.01] mb-6">
              <div
                className="w-4 h-4 rounded-full ring-2 ring-white/20"
                style={{ backgroundColor: activeTheme.accent }}
              />
              <div>
                <p className="font-display text-sm font-bold text-on-surface">Active Theme</p>
                <p className="font-sans text-[10px] text-slate-400 tracking-widest uppercase">
                  {activeTheme.label}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {THEMES.map((t) => {
                const isActive = t.id === activeTheme.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTheme(t.id);
                      setToast(`Theme switched to ${t.label}`);
                      setTimeout(() => setToast(null), 3000);
                    }}
                    className={`relative group flex flex-col items-start gap-3 p-5 rounded-2xl border transition-all duration-300 active:scale-95 text-left cursor-pointer ${
                      isActive
                        ? 'border-white/30 bg-white/[0.04] shadow-lg'
                        : 'border-white/5 bg-white/[0.01] hover:bg-white/[0.03] hover:border-white/15'
                    }`}
                    style={isActive ? { boxShadow: `0 0 20px ${t.glow}` } : {}}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-8 h-8 rounded-xl border border-white/10 shrink-0"
                        style={{ backgroundColor: t.accent }}
                      />
                      <span
                        className="w-4 h-8 rounded-lg border border-white/10 shrink-0"
                        style={{ backgroundColor: t.pageBg }}
                      />
                    </div>

                    <div className="min-w-0">
                      <p className="font-display text-sm font-bold text-on-surface truncate">
                        {t.label}
                      </p>
                    </div>

                    {isActive && (
                      <span
                        className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: t.accent }}
                      >
                        <Check className="w-3 h-3 text-black" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
