import { Link } from 'react-router-dom';
import { BrainCircuit } from 'lucide-react';

export default function CreateAccount() {
  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Ambient Background / Neural Motif */}
      <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:48px_48px]"></div>
        <div className="absolute top-[-25%] right-[-10%] w-[800px] h-[800px] bg-primary/10 rounded-full blur-[120px] mix-blend-screen scale-x-150"></div>
        <div className="absolute bottom-[-25%] left-[-10%] w-[600px] h-[600px] bg-secondary-container/15 rounded-full blur-[100px] mix-blend-screen scale-x-150"></div>
      </div>

      <main className="flex-grow flex items-center justify-center p-6 sm:p-10 w-full max-w-7xl mx-auto relative z-10">
        {/* Glassmorphic Central Card */}
        <div className="w-full max-w-[1020px] bg-surface-container-high/60 backdrop-blur-xl rounded-[1rem] border border-white/10 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.5)] relative overflow-hidden flex flex-col md:flex-row">
          
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-primary/50 to-transparent"></div>

          {/* Left Half: Brand & Social */}
          <div className="w-full md:w-1/2 p-8 sm:p-12 flex flex-col justify-center border-b md:border-b-0 md:border-r border-white/10 bg-surface-container-highest/30">
            <div className="flex flex-col items-center mb-10 text-center">
              <div className="w-16 h-16 rounded-xl bg-surface-container-highest/80 border border-white/10 flex items-center justify-center mb-6 shadow-inner">
                <BrainCircuit className="text-primary w-8 h-8" />
              </div>
              <h1 className="font-display text-3xl font-semibold text-primary mb-2">EduSpace</h1>
              <p className="font-sans text-sm text-on-surface-variant">Initialize your cognitive research environment.</p>
            </div>

            <div className="flex items-center gap-4 my-6 w-full max-w-[320px] mx-auto">
              <div className="h-[1px] flex-1 bg-outline-variant/30"></div>
              <span className="font-sans font-semibold text-[10px] text-on-surface-variant uppercase tracking-[0.1em]">or</span>
              <div className="h-[1px] flex-1 bg-outline-variant/30"></div>
            </div>

            <div className="flex flex-col gap-3 w-full max-w-[320px] mx-auto">
              <button 
                type="button"
                className="w-full flex items-center justify-center gap-3 bg-surface-container-low/40 border border-outline-variant/50 hover:bg-surface-container-high/80 text-on-surface font-sans font-semibold text-[12px] tracking-[0.1em] uppercase py-4 px-6 rounded-md transition-all duration-300 active:scale-[0.98] group"
              >
                <svg className="w-5 h-5 opacity-70 group-hover:opacity-100 transition-opacity" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"></path>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"></path>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"></path>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"></path>
                </svg>
                Continue with Google
              </button>
              
              <button 
                type="button"
                className="w-full flex items-center justify-center gap-3 bg-surface-container-low/40 border border-outline-variant/50 hover:bg-surface-container-high/80 text-on-surface font-sans font-semibold text-[12px] tracking-[0.1em] uppercase py-4 px-6 rounded-md transition-all duration-300 active:scale-[0.98] group"
              >
                <svg className="w-5 h-5 fill-[#1877F2] opacity-70 group-hover:opacity-100 transition-opacity" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"></path>
                </svg>
                Continue with Facebook
              </button>
            </div>
          </div>

          {/* Right Half: Form */}
          <div className="w-full md:w-1/2 p-8 sm:p-12 flex flex-col justify-center">
            <div className="bg-surface-container-highest/20 backdrop-blur-md rounded-2xl border border-white/5 p-6 sm:p-8 shadow-inner">
              <form className="flex flex-col gap-6">
                
                {/* Role Selection */}
                <div className="flex flex-col gap-2 mb-2">
                  <span className="font-sans font-semibold text-[12px] tracking-[0.1em] text-on-surface-variant uppercase">Select Designation</span>
                  <div className="flex gap-3 w-full">
                    <label className="flex-1 cursor-pointer group">
                      <input type="radio" name="role" value="student" className="peer sr-only" defaultChecked />
                      <div className="h-full rounded-xl border border-outline-variant py-3 px-4 flex flex-col items-center gap-2 font-sans font-semibold text-[12px] tracking-[0.1em] text-on-surface-variant peer-checked:bg-primary-container/10 peer-checked:border-primary peer-checked:text-primary transition-all duration-200 hover:border-primary/50">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3L1 9l4 2.18v6L12 21l7-3.82v-6l2.12-1.15V17h2V8.45L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z"/></svg>
                        Student
                      </div>
                    </label>
                    <label className="flex-1 cursor-pointer group">
                      <input type="radio" name="role" value="educator" className="peer sr-only" />
                      <div className="h-full rounded-xl border border-outline-variant py-3 px-4 flex flex-col items-center gap-2 font-sans font-semibold text-[12px] tracking-[0.1em] text-on-surface-variant peer-checked:bg-primary-container/10 peer-checked:border-primary peer-checked:text-primary transition-all duration-200 hover:border-primary/50">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M21 3H3v18h18V3zm-2 16H5V5h14v14zm-4-6h-4v4h-2v-4H5v-2h4V7h2v4h4v2z"/></svg>
                        Educator
                      </div>
                    </label>
                  </div>
                </div>

                {/* Fields */}
                <div className="flex flex-col gap-6 mt-2">
                  <div className="flex flex-col relative group">
                    <input type="text" id="fullname" required placeholder=" " 
                      className="peer w-full bg-surface-container-lowest/40 border-0 border-b-2 border-outline-variant focus:border-primary text-on-surface text-base pt-5 pb-2 px-0 focus:ring-0 transition-colors" />
                    <label htmlFor="fullname" 
                      className="absolute left-0 top-3 text-sm text-on-surface-variant transition-all duration-200 peer-focus:-top-2 peer-focus:text-xs peer-focus:text-primary peer-focus:font-semibold peer-focus:tracking-[0.1em] peer-[:not(:placeholder-shown)]:-top-2 peer-[:not(:placeholder-shown)]:text-xs peer-[:not(:placeholder-shown)]:font-semibold peer-[:not(:placeholder-shown)]:tracking-[0.1em] pointer-events-none uppercase">
                      Full Name
                    </label>
                  </div>

                  <div className="flex flex-col relative group">
                    <input type="email" id="email" required placeholder=" " 
                      className="peer w-full bg-surface-container-lowest/40 border-0 border-b-2 border-outline-variant focus:border-primary text-on-surface text-base pt-5 pb-2 px-0 focus:ring-0 transition-colors" />
                    <label htmlFor="email" 
                      className="absolute left-0 top-3 text-sm text-on-surface-variant transition-all duration-200 peer-focus:-top-2 peer-focus:text-xs peer-focus:text-primary peer-focus:font-semibold peer-focus:tracking-[0.1em] peer-[:not(:placeholder-shown)]:-top-2 peer-[:not(:placeholder-shown)]:text-xs peer-[:not(:placeholder-shown)]:font-semibold peer-[:not(:placeholder-shown)]:tracking-[0.1em] pointer-events-none uppercase">
                      Email Address
                    </label>
                  </div>

                  <div className="flex flex-col relative group">
                    <input type="password" id="password" required placeholder=" " 
                      className="peer w-full bg-surface-container-lowest/40 border-0 border-b-2 border-outline-variant focus:border-primary text-on-surface text-base pt-5 pb-2 px-0 focus:ring-0 transition-colors" />
                    <label htmlFor="password" 
                      className="absolute left-0 top-3 text-sm text-on-surface-variant transition-all duration-200 peer-focus:-top-2 peer-focus:text-xs peer-focus:text-primary peer-focus:font-semibold peer-focus:tracking-[0.1em] peer-[:not(:placeholder-shown)]:-top-2 peer-[:not(:placeholder-shown)]:text-xs peer-[:not(:placeholder-shown)]:font-semibold peer-[:not(:placeholder-shown)]:tracking-[0.1em] pointer-events-none uppercase">
                      Secure Password
                    </label>
                  </div>
                </div>

                <Link to="/login" className="mt-4 w-full text-center bg-primary text-on-primary font-sans font-semibold text-[12px] tracking-[0.1em] uppercase py-4 px-6 rounded-md shadow-[0_0_15px_rgba(0,229,255,0.3)] hover:shadow-[0_0_25px_rgba(0,229,255,0.5)] hover:bg-primary-container transition-all duration-300 active:scale-[0.98]">
                  Create Account
                </Link>
              </form>
            </div>

            <div className="mt-8 text-center">
              <p className="font-sans text-sm text-on-surface-variant">
                Already an affiliate? 
                <Link to="/login" className="text-primary hover:text-primary-fixed transition-colors underline underline-offset-4 decoration-primary/30 hover:decoration-primary font-medium ml-1">Login</Link>
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="w-full mt-auto relative z-10 bg-[#020617]/80 backdrop-blur-md font-display text-sm tracking-wide border-t border-white/10 p-6 sm:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center w-full">
          <div className="text-primary-fixed-dim font-bold mb-4 md:mb-0">
            © 2024 EduSpace Research. All rights reserved.
          </div>
          <div className="flex gap-6">
            <a href="#" className="text-slate-500 hover:text-primary-fixed-dim transition-colors">Privacy Policy</a>
            <a href="#" className="text-slate-500 hover:text-primary-fixed-dim transition-colors">Terms of Service</a>
            <a href="#" className="text-slate-500 hover:text-primary-fixed-dim transition-colors">System Status</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
