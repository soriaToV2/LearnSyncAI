import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BrainCircuit, Mail, Lock, User, Sparkles, Building, ArrowRight, Github } from 'lucide-react';
import { getAuthTheme, applyThemeToElement } from '../../context/ThemeContext';

export default function CreateAccount() {
  const [isLoading, setIsLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const authTheme = getAuthTheme();
    if (wrapperRef.current) {
      applyThemeToElement(authTheme, wrapperRef.current);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 800);
  };

  return (
    <div ref={wrapperRef} className="min-h-screen bg-page text-slate-200 flex flex-col relative overflow-hidden font-sans animate-page-fade">

      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(218,226,253,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(218,226,253,0.03)_1px,transparent_1px)] bg-[size:4rem_4rem]"></div>
        <div className="absolute top-[-10%] right-[-10%] w-[60vw] h-[60vw] max-w-[800px] max-h-[800px] bg-primary-fixed-dim/15 rounded-full blur-[120px] mix-blend-screen animate-pulse duration-1000"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[50vw] h-[50vw] max-w-[700px] max-h-[700px] bg-emerald-500/10 rounded-full blur-[150px] mix-blend-screen"></div>
      </div>

      <main className="flex-grow flex items-center justify-center p-4 w-full max-w-[1000px] mx-auto relative z-10 min-h-screen">

        <div className="w-full bg-surface-container/40 backdrop-blur-2xl rounded-[2rem] border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] relative overflow-hidden flex flex-col lg:flex-row max-h-none lg:max-h-[90vh]">

          <div className="hidden lg:flex w-full lg:w-1/2 relative bg-gradient-to-br from-surface-container-high/80 to-surface-container-lowest/80 p-8 lg:p-10 flex flex-col justify-center border-b lg:border-b-0 lg:border-r border-white/5 overflow-hidden">
            <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2564&auto=format&fit=crop')] bg-cover bg-center opacity-10 mix-blend-luminosity"></div>

            <div className="relative z-10 flex flex-col items-center lg:items-start text-center lg:text-left">
              <div className="w-16 h-16 rounded-2xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(0,218,243,0.2)]">
                <BrainCircuit className="w-8 h-8 text-primary-fixed-dim" />
              </div>
              <h1 className="font-display text-4xl lg:text-5xl font-bold text-white mb-4 leading-tight">Join <span className="text-primary-fixed-dim">LearnSync AI</span></h1>
              <p className="font-sans text-slate-400 leading-relaxed max-w-md">
                Bridge the gap between standardized assessment and personalized study. Access BKT-driven adaptive pathways, procedural gamification, and secure peer collaboration.
              </p>
            </div>

            <div className="relative z-10 hidden lg:block space-y-4 mt-10">
              <div className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/5 backdrop-blur-md">
                <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                  <Sparkles className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <p className="font-display font-semibold text-slate-200 text-sm">CollabShare Workspace</p>
                  <p className="font-sans text-xs text-slate-400">Secure, read-only peer synchronization</p>
                </div>
              </div>
              <div className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/5 backdrop-blur-md">
                <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0">
                  <Building className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <p className="font-display font-semibold text-slate-200 text-sm">Adaptive AI Engine</p>
                  <p className="font-sans text-xs text-slate-400">Personalized BKT routing & isomorphic exams</p>
                </div>
              </div>
            </div>
          </div>

          <div className="w-full lg:w-1/2 p-6 lg:p-10 flex flex-col justify-center bg-surface-container-lowest/50 relative overflow-y-auto no-scrollbar">

            <div className="w-full max-w-[340px] mx-auto flex flex-col justify-center">
              <div className="lg:hidden flex flex-col items-center mb-6 text-center">
                <div className="w-16 h-16 rounded-2xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(0,218,243,0.2)]">
                  <BrainCircuit className="w-8 h-8 text-primary-fixed-dim" />
                </div>
                <h1 className="font-display text-3xl font-bold text-white">LearnSync AI</h1>
                <p className="font-sans text-sm text-slate-400 mt-2">Personalized adaptive learning platform.</p>
              </div>

              <div className="mb-6 text-center lg:text-left">
                <h2 className="font-display text-2xl font-bold text-white mb-1">Create Account</h2>
                <p className="font-sans text-sm text-slate-400">Create your student account to access your study space.</p>
              </div>

              <form className="flex flex-col gap-4" onSubmit={handleSubmit}>

                {/* Role selection removed - all users are students now */}

                <div className="space-y-4">
                  <div className="flex gap-3">
                    <div className="relative group flex-1">
                      <div className="absolute -inset-0.5 bg-gradient-to-r from-primary-fixed-dim via-indigo-500 to-emerald-400 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition duration-700"></div>
                      <div className="relative flex items-stretch bg-page-60 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden group-focus-within:border-white/20 transition-all duration-300 shadow-[inset_0_2px_15px_rgba(0,0,0,0.4)]">
                        <div className="pl-4 pr-2 py-3 flex items-center justify-center text-slate-500 group-focus-within:text-primary-fixed-dim transition-colors">
                          <User className="w-5 h-5 group-focus-within:scale-110 group-focus-within:-rotate-3 transition-transform duration-300" />
                        </div>
                        <div className="relative flex-1 flex flex-col justify-center">
                          <input
                            type="text"
                            id="firstname"
                            required
                            placeholder=" "
                            autoComplete="given-name"
                            className="peer w-full bg-transparent text-white font-sans text-sm pt-4 pb-1 pr-3 focus:outline-none transition-all placeholder-transparent z-10"
                          />
                          <label
                            htmlFor="firstname"
                            className="absolute left-0 top-1/2 -translate-y-1/2 text-slate-400 text-sm transition-all duration-300 
                            peer-focus:text-[9px] peer-focus:top-2.5 peer-focus:text-primary-fixed-dim peer-focus:font-bold peer-focus:tracking-widest peer-focus:uppercase
                            peer-[:not(:placeholder-shown)]:text-[9px] peer-[:not(:placeholder-shown)]:top-2.5 peer-[:not(:placeholder-shown)]:font-bold peer-[:not(:placeholder-shown)]:tracking-widest peer-[:not(:placeholder-shown)]:uppercase pointer-events-none"
                          >
                            First Name
                          </label>
                          <div className="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-primary-fixed-dim via-indigo-400 to-emerald-400 w-0 peer-focus:w-full transition-all duration-500 ease-out"></div>
                        </div>
                      </div>
                    </div>
                    <div className="relative group flex-1">
                      <div className="absolute -inset-0.5 bg-gradient-to-r from-primary-fixed-dim via-indigo-500 to-emerald-400 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition duration-700"></div>
                      <div className="relative flex items-stretch bg-page-60 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden group-focus-within:border-white/20 transition-all duration-300 shadow-[inset_0_2px_15px_rgba(0,0,0,0.4)]">
                        <div className="relative flex-1 flex flex-col justify-center">
                          <input
                            type="text"
                            id="lastname"
                            required
                            placeholder=" "
                            autoComplete="family-name"
                            className="peer w-full bg-transparent text-white font-sans text-sm pt-4 pb-1 pl-4 pr-3 focus:outline-none transition-all placeholder-transparent z-10"
                          />
                          <label
                            htmlFor="lastname"
                            className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm transition-all duration-300 
                            peer-focus:text-[9px] peer-focus:top-2.5 peer-focus:text-primary-fixed-dim peer-focus:font-bold peer-focus:tracking-widest peer-focus:uppercase
                            peer-[:not(:placeholder-shown)]:text-[9px] peer-[:not(:placeholder-shown)]:top-2.5 peer-[:not(:placeholder-shown)]:font-bold peer-[:not(:placeholder-shown)]:tracking-widest peer-[:not(:placeholder-shown)]:uppercase pointer-events-none"
                          >
                            Last Name
                          </label>
                          <div className="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-primary-fixed-dim via-indigo-400 to-emerald-400 w-0 peer-focus:w-full transition-all duration-500 ease-out"></div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="relative group">
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-primary-fixed-dim via-indigo-500 to-emerald-400 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition duration-700"></div>
                    <div className="relative flex items-stretch bg-page-60 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden group-focus-within:border-white/20 transition-all duration-300 shadow-[inset_0_2px_15px_rgba(0,0,0,0.4)]">
                      <div className="pl-4 pr-3 py-3 flex items-center justify-center text-slate-500 group-focus-within:text-primary-fixed-dim transition-colors">
                        <Mail className="w-5 h-5 group-focus-within:scale-110 group-focus-within:-rotate-3 transition-transform duration-300" />
                      </div>
                      <div className="relative flex-1 flex flex-col justify-center">
                        <input
                          type="email"
                          id="email"
                          required
                          placeholder=" "
                          autoComplete="off"
                          className="peer w-full bg-transparent text-white font-sans text-sm pt-4 pb-1 pr-4 focus:outline-none transition-all placeholder-transparent z-10"
                        />
                        <label
                          htmlFor="email"
                          className="absolute left-0 top-1/2 -translate-y-1/2 text-slate-400 text-sm transition-all duration-300 
                          peer-focus:text-[9px] peer-focus:top-2.5 peer-focus:text-primary-fixed-dim peer-focus:font-bold peer-focus:tracking-widest peer-focus:uppercase
                          peer-[:not(:placeholder-shown)]:text-[9px] peer-[:not(:placeholder-shown)]:top-2.5 peer-[:not(:placeholder-shown)]:font-bold peer-[:not(:placeholder-shown)]:tracking-widest peer-[:not(:placeholder-shown)]:uppercase pointer-events-none"
                        >
                          Email Address
                        </label>
                        <div className="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-primary-fixed-dim via-indigo-400 to-emerald-400 w-0 peer-focus:w-full transition-all duration-500 ease-out"></div>
                      </div>
                    </div>
                  </div>

                  <div className="relative group">
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-primary-fixed-dim via-indigo-500 to-emerald-400 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition duration-700"></div>
                    <div className="relative flex items-stretch bg-page-60 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden group-focus-within:border-white/20 transition-all duration-300 shadow-[inset_0_2px_15px_rgba(0,0,0,0.4)]">
                      <div className="pl-4 pr-3 py-3 flex items-center justify-center text-slate-500 group-focus-within:text-primary-fixed-dim transition-colors">
                        <Lock className="w-5 h-5 group-focus-within:scale-110 group-focus-within:-rotate-3 transition-transform duration-300" />
                      </div>
                      <div className="relative flex-1 flex flex-col justify-center">
                        <input
                          type="password"
                          id="password"
                          required
                          placeholder=" "
                          autoComplete="new-password"
                          className="peer w-full bg-transparent text-white font-sans text-sm pt-4 pb-1 pr-4 focus:outline-none transition-all placeholder-transparent z-10"
                        />
                        <label
                          htmlFor="password"
                          className="absolute left-0 top-1/2 -translate-y-1/2 text-slate-400 text-sm transition-all duration-300 
                          peer-focus:text-[9px] peer-focus:top-2.5 peer-focus:text-primary-fixed-dim peer-focus:font-bold peer-focus:tracking-widest peer-focus:uppercase
                          peer-[:not(:placeholder-shown)]:text-[9px] peer-[:not(:placeholder-shown)]:top-2.5 peer-[:not(:placeholder-shown)]:font-bold peer-[:not(:placeholder-shown)]:tracking-widest peer-[:not(:placeholder-shown)]:uppercase pointer-events-none"
                        >
                          Secure Password
                        </label>
                        <div className="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-primary-fixed-dim via-indigo-400 to-emerald-400 w-0 peer-focus:w-full transition-all duration-500 ease-out"></div>
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="mt-2 w-full bg-gradient-to-r from-primary-fixed-dim to-primary-fixed text-on-primary-fixed font-display text-base font-bold py-3 px-6 rounded-xl hover:shadow-[0_0_30px_rgba(0,218,243,0.3)] transition-all duration-300 active:scale-[0.98] flex justify-center items-center gap-2 group disabled:opacity-70 disabled:pointer-events-none"
                >
                  {isLoading ? (
                    <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>
                  ) : (
                    <>
                      <span>Signup</span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>

                <div className="relative flex items-center">
                  <div className="flex-grow border-t border-white/10"></div>
                  <span className="flex-shrink-0 mx-4 text-slate-500 font-sans text-xs uppercase tracking-widest">Or continue with</span>
                  <div className="flex-grow border-t border-white/10"></div>
                </div>

                <div className="flex gap-3">
                  <button type="button" className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white font-sans text-xs transition-colors active:scale-95">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"></path>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"></path>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"></path>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"></path>
                    </svg>
                    Google
                  </button>
                </div>

              </form>

              <div className="mt-6 text-center">
                <p className="font-sans text-sm text-slate-400">
                  Already have an account?
                  <Link to="/login" className="text-primary-fixed-dim hover:text-white transition-colors font-semibold ml-1">Login</Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}