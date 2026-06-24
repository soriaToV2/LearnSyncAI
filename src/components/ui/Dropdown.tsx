import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

interface DropdownOption {
  label: string;
  value: string;
}

interface DropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[] | string[];
  className?: string;
  icon?: React.ReactNode;
}

export default function Dropdown({ value, onChange, options, className = '', icon }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const normalizedOptions: DropdownOption[] = options.map((opt) => {
    if (typeof opt === 'string') {
      return { label: opt, value: opt };
    }
    return opt;
  });

  const selectedOption = normalizedOptions.find((opt) => opt.value === value) || normalizedOptions[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div className={`relative inline-block text-left font-sans ${className}`} ref={containerRef}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`inline-flex w-full items-center justify-between gap-x-2 rounded-xl bg-surface-container/60 border border-white/10 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-surface-container/85 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/40 transition-all active:scale-98 ${icon ? 'pl-9' : ''}`}
          aria-expanded="true"
          aria-haspopup="true"
        >
          {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 flex items-center justify-center pointer-events-none">{icon}</span>}
          <span className="truncate">{selectedOption?.label}</span>
          <ChevronDown
            className={`h-4 w-4 text-slate-400 transition-transform duration-300 shrink-0 ${isOpen ? 'rotate-180 text-white' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {isOpen && (
        <div className="absolute left-0 mt-2 w-full origin-top-left rounded-xl border border-white/10 bg-surface-container-high shadow-2xl ring-1 ring-black ring-opacity-5 focus:outline-none overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 backdrop-blur-md z-[100]">
          <div className="py-1 max-h-60 overflow-y-auto scrollbar-none" role="none">
            {normalizedOptions.map((option, idx) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={idx}
                  onClick={() => handleSelect(option.value)}
                  className={`flex w-full items-center px-4 py-2.5 text-xs text-left transition-colors ${isSelected
                      ? 'bg-primary-fixed-dim/10 text-primary-fixed-dim font-bold'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    }`}
                  role="menuitem"
                >
                  <span className="truncate flex-1">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
