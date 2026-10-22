import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Trash2, X } from 'lucide-react';
import type { PhotoPage } from './PhotoPageGrid';

interface PhotoPageViewerProps {
  pages: PhotoPage[];
  index: number;
  disabled: boolean;
  onIndexChange: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  onClose: () => void;
}

/**
 * Full-size view of one page over the upload window. It shows the prepared JPEG, the upright and
 * downscaled file that is actually uploaded, so what the educator checks is what OCR will read.
 *
 * NOT a nested Modal: two portals both binding Esc and both writing body.style.overflow fight over
 * the teardown. This one never touches overflow (the upload Modal already locks it), and it takes
 * its keys on window in the CAPTURE phase so Esc and the arrows never reach Modal's document listener,
 * which would close the whole upload window.
 */
export default function PhotoPageViewer({
  pages,
  index,
  disabled,
  onIndexChange,
  onMove,
  onRemove,
  onClose,
}: PhotoPageViewerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const page = pages[index];
  const isFirst = index === 0;
  const isLast = index === pages.length - 1;

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && !isFirst) onIndexChange(index - 1);
      else if (e.key === 'ArrowRight' && !isLast) onIndexChange(index + 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [index, isFirst, isLast, onClose, onIndexChange]);

  if (!page) return null;

  const navButton =
    'absolute top-1/2 -translate-y-1/2 p-2 sm:p-3 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors disabled:opacity-0 disabled:pointer-events-none';
  const actionButton =
    'flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/15 bg-white/5 text-white font-sans text-xs font-semibold hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/95 animate-backdrop-in"
      role="dialog"
      aria-modal="true"
      aria-label={`Page ${index + 1} of ${pages.length}`}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 shrink-0">
        <div className="min-w-0">
          <p className="font-sans text-sm font-semibold text-white">
            Page {index + 1} of {pages.length}
          </p>
          <p className="font-sans text-xs text-slate-400 truncate">{page.file.name}</p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors shrink-0"
          aria-label="Close page view"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Clicking around the photo closes the view; clicking the photo itself does not. */}
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-2 sm:px-16" onClick={onClose}>
        <img
          src={page.url}
          alt={`Page ${index + 1}`}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full object-contain rounded-md shadow-2xl select-none"
          draggable={false}
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onIndexChange(index - 1);
          }}
          disabled={isFirst}
          className={`${navButton} left-2 sm:left-4`}
          aria-label="Previous page"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onIndexChange(index + 1);
          }}
          disabled={isLast}
          className={`${navButton} right-2 sm:right-4`}
          aria-label="Next page"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 px-4 py-3 shrink-0">
        <button
          type="button"
          onClick={() => onMove(index, index - 1)}
          disabled={disabled || isFirst}
          className={actionButton}
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Move earlier
        </button>
        <button
          type="button"
          onClick={() => onMove(index, index + 1)}
          disabled={disabled || isLast}
          className={actionButton}
        >
          Move later <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onRemove(index)}
          disabled={disabled}
          className={`${actionButton} text-rose-300 border-rose-400/30 hover:bg-rose-500/10`}
        >
          <Trash2 className="w-3.5 h-3.5" /> Remove
        </button>
      </div>
    </div>,
    document.body,
  );
}
