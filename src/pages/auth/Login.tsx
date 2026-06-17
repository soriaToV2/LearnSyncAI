import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BrainCircuit, Mail, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
import { getAuthTheme, applyThemeToElement } from '../../context/ThemeContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const authTheme = getAuthTheme();
    if (wrapperRef.current) {
      applyThemeToElement(authTheme, wrapperRef.current);
    }
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    setTimeout(() => {
      if (email === 'admin' && password === 'admin@12') {
        navigate('/dashboard');
      } else if (email === 'student' && password === 'student@12') {
        navigate('/student/dashboard');
      } else {
        setError('Invalid credentials. Try: admin OR student (password: admin@12 / student@12)');
        setIsLoading(false);
      }
    }, 800);
  };

  return (
    <div ref={wrapperRef} className="min-h-screen bg-page text-slate-200 flex flex-col relative overflow-hidden font-sans">

      {/* Premium Ambient Background FX */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(218,226,253,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(218,226,253,0.03)_1px,transparent_1px)] bg-[size:4rem_4rem]"></div>
        <div className="absolute top-0 right-0 w-[50vw] h-[50vw] max-w-[800px] max-h-[800px] bg-primary-fixed-dim/20 rounded-full blur-[150px] opacity-50 mix-blend-screen animate-pulse duration-1000"></div>
        <div className="absolute bottom-0 left-0 w-[60vw] h-[60vw] max-w-[900px] max-h-[900px] bg-indigo-500/20 rounded-full blur-[150px] opacity-40 mix-blend-screen"></div>
      </div>

      <main className="flex-grow flex items-center justify-center p-4 w-full max-w-[1000px] mx-auto relative z-10 min-h-screen">

        {/* Glassmorphic Central Card */}
        <div className="w-full bg-surface-container/40 backdrop-blur-2xl rounded-[2rem] border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] relative overflow-hidden flex flex-col lg:flex-row max-h-[90vh]">

          {/* Left Side: Visual / Branding */}
          <div className="w-full lg:w-1/2 relative bg-gradient-to-br from-surface-container-high/80 to-surface-container-lowest/80 p-8 flex-col justify-center border-b lg:border-b-0 lg:border-r border-white/5 overflow-hidden">
            <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop')] bg-cover bg-center opacity-10 mix-blend-luminosity"></div>

            <div className="relative z-10">
              <div className="w-14 h-14 rounded-2xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(0,218,243,0.2)]">
                <BrainCircuit className="w-7 h-7 text-primary-fixed-dim" />
              </div>
              <h1 className="font-display text-4xl font-bold text-white mb-4 leading-tight">Welcome back to <span className="text-primary-fixed-dim">LearnSyncAI</span></h1>
              <p className="font-sans text-slate-400 leading-relaxed">
                Access your personalized learning matrix, track your academic progress, and connect with global educators.
              </p>
            </div>

            <div className="relative z-10 space-y-3 mt-10">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5 backdrop-blur-md">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <div>
                  <p className="font-display font-semibold text-sm text-slate-200">Secure Environment</p>
                  <p className="font-sans text-xs text-slate-400">End-to-end encrypted sessions</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5 backdrop-blur-md">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <div>
                  <p className="font-display font-semibold text-sm text-slate-200">AI-Powered Insights</p>
                  <p className="font-sans text-xs text-slate-400">Smart analytics for your growth</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Side: Form */}
          <div className="w-full lg:w-1/2 p-6 md:p-10 flex flex-col justify-center bg-surface-container-lowest/50 relative overflow-y-auto no-scrollbar">

            <div className="w-full max-w-[320px] mx-auto flex flex-col justify-center">
              {/* Mobile Header (only visible on small screens) */}
              <div className="lg:hidden flex flex-col items-center mb-6 text-center">
                <div className="w-16 h-16 rounded-2xl bg-primary-fixed-dim/10 border border-primary-fixed-dim/20 flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(0,218,243,0.2)]">
                  <BrainCircuit className="w-8 h-8 text-primary-fixed-dim" />
                </div>
                <h1 className="font-display text-3xl font-bold text-white">LearnSyncAI</h1>
                <p className="font-sans text-sm text-slate-400 mt-2">Initialize your session.</p>
              </div>

              <div className="mb-6">
                <h2 className="hidden lg:block font-display text-2xl font-bold text-white mb-1">Sign In</h2>
                <p className="hidden lg:block font-sans text-sm text-slate-400">Enter your credentials to access your account.</p>
              </div>

              <form className="flex flex-col gap-5" onSubmit={handleLogin}>

                {error && (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-4 rounded-xl text-sm flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                    <div className="shrink-0 w-5 h-5 rounded-full bg-rose-500/20 flex items-center justify-center mt-0.5">!</div>
                    <p>{error}</p>
                  </div>
                )}

                {/* Advanced Input for Email */}
                <div className="relative group">
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-primary-fixed-dim via-indigo-500 to-emerald-400 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition duration-700"></div>
                  <div className="relative flex items-stretch bg-page-60 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden group-focus-within:border-white/20 transition-all duration-300 shadow-[inset_0_2px_15px_rgba(0,0,0,0.4)]">
                    <div className="pl-4 pr-3 py-3 flex items-center justify-center text-slate-500 group-focus-within:text-primary-fixed-dim transition-colors">
                      <Mail className="w-5 h-5 group-focus-within:scale-110 group-focus-within:-rotate-3 transition-transform duration-300" />
                    </div>
                    <div className="relative flex-1 flex flex-col justify-center">
                      <input
                        type="text"
                        id="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
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
                        Email or Username
                      </label>
                      <div className="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-primary-fixed-dim via-indigo-400 to-emerald-400 w-0 peer-focus:w-full transition-all duration-500 ease-out"></div>
                    </div>
                  </div>
                </div>

                {/* Advanced Input for Password */}
                <div className="relative group">
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-primary-fixed-dim via-indigo-500 to-emerald-400 rounded-2xl blur opacity-0 group-focus-within:opacity-20 transition duration-700"></div>
                  <div className="relative flex items-stretch bg-page-60 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden group-focus-within:border-white/20 transition-all duration-300 shadow-[inset_0_2px_15px_rgba(0,0,0,0.4)]">
                    <div className="pl-4 pr-3 py-3 flex items-center justify-center text-slate-500 group-focus-within:text-primary-fixed-dim transition-colors">
                      <Lock className="w-5 h-5 group-focus-within:scale-110 group-focus-within:-rotate-3 transition-transform duration-300" />
                    </div>
                    <div className="relative flex-1 flex flex-col justify-center">
                      <input
                        type={showPassword ? "text" : "password"}
                        id="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        placeholder=" "
                        autoComplete="new-password"
                        className="peer w-full bg-transparent text-white font-sans text-sm pt-4 pb-1 pr-12 focus:outline-none transition-all placeholder-transparent z-10"
                      />
                      <label
                        htmlFor="password"
                        className="absolute left-0 top-1/2 -translate-y-1/2 text-slate-400 text-sm transition-all duration-300 
                        peer-focus:text-[9px] peer-focus:top-2.5 peer-focus:text-primary-fixed-dim peer-focus:font-bold peer-focus:tracking-widest peer-focus:uppercase
                        peer-[:not(:placeholder-shown)]:text-[9px] peer-[:not(:placeholder-shown)]:top-2.5 peer-[:not(:placeholder-shown)]:font-bold peer-[:not(:placeholder-shown)]:tracking-widest peer-[:not(:placeholder-shown)]:uppercase pointer-events-none"
                      >
                        Password
                      </label>
                      <div className="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-primary-fixed-dim via-indigo-400 to-emerald-400 w-0 peer-focus:w-full transition-all duration-500 ease-out"></div>

                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-500 hover:text-white transition-colors focus:outline-none z-20"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-0">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <div className="relative flex items-center justify-center w-4 h-4 rounded border border-white/20 bg-surface-container group-hover:border-primary-fixed-dim/50 transition-colors">
                      <input type="checkbox" className="peer sr-only" />
                      <div className="absolute inset-0 bg-primary-fixed-dim scale-0 peer-checked:scale-100 rounded transition-transform"></div>
                      <ShieldCheck className="w-3 h-3 text-black absolute opacity-0 peer-checked:opacity-100 transition-opacity z-10" />
                    </div>
                    <span className="font-sans text-xs text-slate-400 group-hover:text-slate-200 transition-colors">Remember me</span>
                  </label>
                  <a href="#" className="font-sans text-xs text-primary-fixed-dim hover:text-primary-container transition-colors">Forgot password?</a>
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
                      <span>Login</span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-6 pt-6 border-t border-white/5 text-center">
                <span className="font-sans text-slate-400">Don't have an account? </span>
                <Link to="/register" className="font-sans font-semibold text-primary-fixed-dim hover:text-white transition-colors ml-1">
                  Create one now
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
