import { useState, useEffect } from 'react';
import { AlertTriangle, Clock, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';


export default function LockdownExam() {
  const [timeLeft, setTimeLeft] = useState(5400); // 90 mins in seconds
  const [tabSwitchDetected, setTabSwitchDetected] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setTabSwitchDetected(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    const timer = setInterval(() => {
      setTimeLeft(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(timer);
    };
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (submitted) {
    return (
      <div className="fixed inset-0 bg-background flex flex-col items-center justify-center p-6 text-center z-50">
        <div className="w-24 h-24 rounded-full bg-emerald-500/20 flex items-center justify-center mb-6">
          <CheckCircle2 className="w-12 h-12 text-emerald-400" />
        </div>
        <h2 className="font-display text-3xl font-semibold text-on-surface mb-2">Exam Submitted Successfully</h2>
        <p className="font-sans text-on-surface-variant mb-8 max-w-md text-sm">
          Your responses have been securely recorded. You may now return to your dashboard.
        </p>
        <button 
          onClick={() => navigate('/student/dashboard')}
          className="px-8 py-3 bg-surface-container border border-white/10 hover:bg-surface-container-high rounded-lg text-on-surface font-sans font-semibold text-sm uppercase tracking-wider transition-colors"
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-background flex flex-col z-50 overflow-y-auto">
      {/* Warning Banner */}
      {tabSwitchDetected && (
        <div className="bg-error font-sans text-on-error font-semibold text-sm py-3 px-6 flex items-center justify-center gap-3 sticky top-0 z-50 shadow-lg">
          <ShieldAlert className="w-5 h-5 flex-shrink-0" />
          Attention: Tab Switching Detected. Incident Logged.
        </div>
      )}

      {/* Header */}
      <header className="py-4 px-6 md:px-12 flex justify-between items-center border-b border-white/5 sticky top-0 bg-background/90 backdrop-blur-sm z-40">
        <div>
          <h1 className="font-display text-xl font-bold text-on-surface">Midterm: Neural Firing</h1>
          <p className="font-sans text-xs text-on-surface-variant uppercase tracking-widest mt-1">Biology 301</p>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-primary-fixed-dim font-display text-xl font-medium tracking-widest bg-primary-fixed-dim/10 px-4 py-2 rounded-lg border border-primary-fixed-dim/20">
            <Clock className="w-5 h-5" />
            {formatTime(timeLeft)}
          </div>
          
          <button 
            onClick={() => setSubmitted(true)}
            className="px-6 py-2.5 bg-primary-fixed-dim text-on-primary-fixed rounded-lg font-sans font-bold text-xs uppercase tracking-widest hover:bg-primary-container transition-colors shadow-lg"
          >
            Submit Exam
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 w-full max-w-4xl mx-auto p-6 md:p-12 mb-20">
        
        {/* Question 1 */}
        <div className="mb-10 block">
          <div className="flex items-start gap-4 mb-6">
            <span className="w-8 h-8 flex-shrink-0 rounded-full bg-surface-container border border-white/10 flex items-center justify-center font-display text-sm font-semibold text-on-surface">1</span>
            <h2 className="font-sans text-lg text-on-surface leading-relaxed pt-1">
              Which of the following ions is primarily responsible for the depolarization phase of an action potential?
            </h2>
          </div>
          
          <div className="pl-12 flex flex-col gap-3">
            <label className="flex items-center p-4 rounded-xl border border-white/10 bg-surface-container-lowest hover:bg-surface-container hover:border-white/20 transition-all cursor-pointer group">
              <input type="radio" name="q1" className="w-4 h-4 text-primary-fixed-dim border-white/20 bg-transparent focus:ring-primary-fixed-dim/50 focus:ring-offset-background" />
              <span className="ml-4 font-sans text-base text-on-surface-variant group-hover:text-on-surface transition-colors">Potassium (K+)</span>
            </label>
            <label className="flex items-center p-4 rounded-xl border border-primary-fixed-dim/50 bg-primary-fixed-dim/10 transition-all cursor-pointer group">
              <input type="radio" name="q1" defaultChecked className="w-4 h-4 text-primary-fixed-dim border-white/20 bg-transparent focus:ring-primary-fixed-dim/50 focus:ring-offset-background" />
              <span className="ml-4 font-sans text-base text-on-surface transition-colors">Sodium (Na+)</span>
            </label>
            <label className="flex items-center p-4 rounded-xl border border-white/10 bg-surface-container-lowest hover:bg-surface-container hover:border-white/20 transition-all cursor-pointer group">
              <input type="radio" name="q1" className="w-4 h-4 text-primary-fixed-dim border-white/20 bg-transparent focus:ring-primary-fixed-dim/50 focus:ring-offset-background" />
              <span className="ml-4 font-sans text-base text-on-surface-variant group-hover:text-on-surface transition-colors">Calcium (Ca2+)</span>
            </label>
            <label className="flex items-center p-4 rounded-xl border border-white/10 bg-surface-container-lowest hover:bg-surface-container hover:border-white/20 transition-all cursor-pointer group">
              <input type="radio" name="q1" className="w-4 h-4 text-primary-fixed-dim border-white/20 bg-transparent focus:ring-primary-fixed-dim/50 focus:ring-offset-background" />
              <span className="ml-4 font-sans text-base text-on-surface-variant group-hover:text-on-surface transition-colors">Chloride (Cl-)</span>
            </label>
          </div>
        </div>

        {/* Question 2 */}
        <div className="mb-10 block">
          <div className="flex items-start gap-4 mb-6">
            <span className="w-8 h-8 flex-shrink-0 rounded-full bg-surface-container border border-white/10 flex items-center justify-center font-display text-sm font-semibold text-on-surface">2</span>
            <div className="pt-1">
              <h2 className="font-sans text-lg text-on-surface leading-relaxed mb-4">
                Describe the role of myelin sheaths in neuronal conduction. What consequences arise when myelin is degraded, as seen in Multiple Sclerosis?
              </h2>
            </div>
          </div>
          
          <div className="pl-12">
            <textarea 
              rows={6}
              className="w-full bg-surface-container-lowest border border-white/10 focus:border-primary-fixed-dim/50 rounded-xl p-4 text-on-surface font-sans text-base resize-y outline-none transition-colors"
              placeholder="Enter your essay response..."
            ></textarea>
          </div>
        </div>
      </main>
    </div>
  );
}
