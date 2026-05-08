import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BrainCircuit, Mail, Lock, Eye, EyeOff, LogIn } from 'lucide-react';


export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Hardcoded accounts for testing
    if (email === 'admin' && password === 'admin') {
      navigate('/dashboard');
    } else if (email === 'student' && password === 'student') {
      navigate('/student/dashboard');
    } else {
      setError('Invalid credentials. Try: admin@eduspace.edu OR student@eduspace.edu (password: password)');
    }
  };

  return (
    <div className="bg-background text-on-background min-h-screen flex items-center justify-center p-4 md:p-8 relative overflow-hidden font-sans">
      
      {/* Ambient Background FX */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(218,226,253,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(218,226,253,0.03)_1px,transparent_1px)] bg-[size:3rem_3rem]"></div>
        <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] max-w-[600px] max-h-[600px] bg-primary-fixed-dim/10 rounded-full blur-[100px]"></div>
        <div className="absolute bottom-[-20%] right-[-10%] w-[60vw] h-[60vw] max-w-[800px] max-h-[800px] bg-secondary-container/10 rounded-full blur-[120px]"></div>
      </div>

      {/* Glassmorphic Login Container */}
      <main className="relative z-10 w-full max-w-md bg-surface-container/70 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-8 md:p-10 flex flex-col gap-8">
        
        {/* Brand / Header */}
        <header className="flex flex-col items-center gap-2 text-center">
          <div className="w-16 h-16 rounded-xl bg-surface-container-high border border-white/10 flex items-center justify-center mb-2 shadow-[0_4px_20px_rgba(0,218,243,0.1)]">
            <BrainCircuit className="w-8 h-8 text-primary-fixed-dim" />
          </div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-on-background">EduSpace</h1>
          <p className="font-sans text-base text-on-surface-variant mt-1">Authenticate to access the research matrix.</p>
        </header>

        {/* Form Elements */}
        <form className="flex flex-col gap-6" onSubmit={handleLogin}>
          
          {error && (
            <div className="bg-error/10 border border-error/20 text-error p-3 rounded-lg text-sm text-center">
              {error}
            </div>
          )}
          
          {/* Email Identity Field */}
          <div className="flex flex-col gap-2">
            <label htmlFor="email" className="font-sans font-semibold text-[12px] text-on-surface-variant uppercase tracking-[0.1em] pl-1">
              Email Identity
            </label>
            <div className="relative flex items-center">
              <Mail className="absolute left-0 text-on-surface-variant w-5 h-5 pb-1" />
              <input 
                type="text" 
                id="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required 
                placeholder="admin@eduspace.edu"
                className="academic-input pb-2 pt-1" 
              />
            </div>
          </div>

          {/* Access Node (Password) Field */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-end pl-1">
              <label htmlFor="password" className="font-sans font-semibold text-[12px] text-on-surface-variant uppercase tracking-[0.1em]">
                Access Node
              </label>
            </div>
            <div className="relative flex items-center">
              <Lock className="absolute left-0 text-on-surface-variant w-5 h-5 pb-1" />
              <input 
                type={showPassword ? "text" : "password"} 
                id="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required 
                placeholder="••••••••••••"
                className="academic-input pb-2 pt-1" 
              />
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-0 text-on-surface-variant hover:text-on-surface transition-colors pb-1 flex items-center justify-center"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Primary Action */}
          <button 
            type="submit"
            className="mt-4 w-full bg-primary-fixed-dim text-on-primary-fixed font-display text-xl font-medium py-4 px-6 rounded-xl hover:bg-primary-container transition-all duration-200 active:scale-[0.98] shadow-[0_4px_20px_rgba(0,218,243,0.25)] hover:shadow-[0_4px_30px_rgba(0,218,243,0.4)] flex justify-center items-center gap-2"
          >
            <span>Initialize Session</span>
            <LogIn className="w-5 h-5" />
          </button>
        </form>

        {/* Secondary Action / Sign Up */}
        <footer className="text-center pt-4 border-t border-white/5">
          <span className="font-sans text-base text-on-surface-variant">No credentials configured?</span>
          <Link to="/register" className="font-sans text-base text-primary hover:text-primary-container ml-1 hover:underline underline-offset-4 transition-all">
            Request Access
          </Link>
        </footer>

      </main>
    </div>
  );
}
