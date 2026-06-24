import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string | React.ReactNode;
  children: React.ReactNode;
  maxWidth?: string;
  noPadding?: boolean;
  headerActions?: React.ReactNode;
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'max-w-md',
  noPadding = false,
  headerActions
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-md animate-backdrop-in">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={modalRef}
        className={`relative w-full ${maxWidth} bg-surface-container-lowest border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-modal-in`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="flex items-start justify-between p-4 sm:p-6 border-b border-white/5 gap-4">
          {typeof title === 'string' ? (
            <h2 id="modal-title" className="font-display text-lg sm:text-xl font-semibold text-white leading-tight">
              {title}
            </h2>
          ) : (
            <div id="modal-title" className="flex-1 min-w-0">
              {title}
            </div>
          )}
          <div className="flex items-center gap-2 shrink-0 mt-0.5 sm:mt-1">
            {headerActions}
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-colors p-1 hover:bg-white/5 rounded-lg"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className={noPadding ? '' : 'p-4 sm:p-6'}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
