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
    /* ⚠️ `bg-surface`, NOT `bg-[#0b1326]`. #0b1326 IS `--color-surface`'s dark
       value, written out as a literal — so this overlay was the one surface in
       the app that no theme could reach, and it stayed near-black over a light
       page. The token is the same colour on every dark theme and follows the
       light one. Reported from the running app.

       This is also the second thing the `documentElement` fix bought: the gate
       mounts at the App root, OUTSIDE all three themed layout wrappers, so
       while `data-theme` lived only on those wrappers no `[data-theme="white"]`
       rule could have corrected it even if the colour had been a class. */
    <div className="fixed inset-0 z-[99999] bg-surface/95 backdrop-blur-md flex flex-col items-center justify-center text-center p-6 text-white fade-in duration-200">
      <div className="max-w-md space-y-6 flex flex-col items-center animate-orientation-panel">
        {/* The phone turns TOWARDS the orientation being asked for and rests
            there — see `phoneToPortrait` / `phoneToLandscape` in `index.css`
            for why the direction is the whole point. The ring behind it
            expands on the same 3s cycle. */}
        <div className="relative w-20 h-20 flex items-center justify-center bg-white/5 rounded-full border border-white/10 shadow-inner">
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full border border-primary-fixed-dim/40 animate-orientation-pulse"
          />
          <Smartphone
            className={`w-10 h-10 text-primary-fixed-dim ${
              warningType === 'landscape_required'
                ? 'animate-phone-to-landscape'
                : 'animate-phone-to-portrait'
            }`}
          />
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
