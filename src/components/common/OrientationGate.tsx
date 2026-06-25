import React, { useState, useEffect } from 'react';
import { Smartphone } from 'lucide-react';

export default function OrientationGate() {
  const [warningType, setWarningType] = useState<'portrait_required' | 'landscape_required' | null>(null);

  useEffect(() => {
    const checkOrientation = () => {
      const isLandscape = window.innerWidth > window.innerHeight;
      
      // We block if it's a mobile/tablet screen dimension (width <= 1024px)
      // or if it's touch device and width <= 1366px (like iPad Pro)
      const isMobileTablet = window.innerWidth <= 1024 || (window.matchMedia('(pointer: coarse)').matches && window.innerWidth <= 1366);
      
      // Check if SeatingGridModal is active in the DOM (marked by our custom data attribute)
      const isSeatingGridOpen = !!document.querySelector('[data-seating-modal="true"]');
      
      if (isMobileTablet) {
        if (isSeatingGridOpen) {
          // Inside Seating Grid layout, we REQUIRE landscape orientation.
          if (!isLandscape) {
            setWarningType('landscape_required');
          } else {
            setWarningType(null);
          }
        } else {
          // General application layout requires portrait orientation.
          if (isLandscape) {
            setWarningType('portrait_required');
          } else {
            setWarningType(null);
          }
        }
      } else {
        setWarningType(null);
      }
    };

    // Initial check
    checkOrientation();

    // Listeners
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);

    // MutationObserver to react to DOM tree changes (opening/closing SeatingGridModal)
    const observer = new MutationObserver(checkOrientation);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
      observer.disconnect();
    };
  }, []);

  const handleCloseSeatingGrid = () => {
    // Close the SeatingGridModal by simulating Escape press
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  };

  if (!warningType) return null;

  return (
    <div className="fixed inset-0 z-[99999] bg-[#0b1326]/95 backdrop-blur-md flex flex-col items-center justify-center text-center p-6 text-white animate-in fade-in duration-200">
      <div className="max-w-md space-y-6 flex flex-col items-center">
        {/* Animated Phone Icon */}
        <div className="w-20 h-20 flex items-center justify-center bg-white/5 rounded-full border border-white/10 shadow-inner">
          <Smartphone className="w-10 h-10 text-primary-fixed-dim animate-phone-rotate" />
        </div>
        
        <div className="space-y-2">
          <h2 className="font-display text-xl font-bold text-white tracking-tight">
            {warningType === 'landscape_required' ? 'Landscape Mode Required' : 'Portrait Mode Required'}
          </h2>
          <p className="font-sans text-xs text-slate-400 leading-relaxed max-w-[280px] mx-auto">
            {warningType === 'landscape_required' 
              ? 'The Seating Grid layout is optimized for landscape. Please rotate your device to landscape orientation.'
              : 'LearnSyncAI is optimized for portrait mode. Please rotate your device to vertical orientation.'}
          </p>
        </div>

        {warningType === 'landscape_required' && (
          <button
            onClick={handleCloseSeatingGrid}
            className="mt-4 px-6 py-2.5 bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 hover:text-white font-sans text-xs font-bold uppercase rounded-xl transition-all active:scale-[0.98] tracking-wider"
          >
            Close Seating Grid
          </button>
        )}
      </div>
    </div>
  );
}
