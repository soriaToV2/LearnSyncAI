import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type { DropdownOption } from './MultiSelectDropdown';

interface SingleSelectDropdownProps {
  /** Selected option `value`, or null. */
  selectedValue: string | null;
  onChange: (value: string | null) => void;
  options: DropdownOption[];
  placeholder?: string;
  className?: string;
  itemNoun?: string;
}

/**
 * Single-choice picker (radio semantics), used for the material in Free Recall and Feynman (the
 * server also caps it at one). Selection is by value, so same-titled materials stay distinct.
 */
export default function SingleSelectDropdown({
  selectedValue,
  onChange,
  options,
  placeholder = 'Select a material...',
  className = '',
  itemNoun = 'material',
}: SingleSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selected = options.find((o) => o.value === selectedValue) ?? null;

  const handleSelect = (value: string) => {
    // Re-picking the current option clears it.
    onChange(value === selectedValue ? null : value);
    setIsOpen(false);
  };

  // w-fit stops a flex/grid parent from stretching the root the panel is positioned against.
  return (
    <div className={`relative inline-block w-fit text-left font-sans ${className}`} ref={containerRef}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="inline-flex w-56 items-center justify-between gap-x-2 rounded-xl bg-surface-container-high border border-white/10 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-surface-container-highest focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/40 transition-all active:scale-98"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
        >
          <span className="truncate flex-1 text-left">{selected ? selected.label : placeholder}</span>
          <ChevronDown
            className={`h-4 w-4 text-slate-400 transition-transform duration-300 shrink-0 ${isOpen ? 'rotate-180 text-white' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {isOpen && (
        // `left-0 w-full` pins the panel under its trigger; a wider right-anchored panel clipped label starts.
        <div className="absolute left-0 mt-2 w-full origin-top-left rounded-xl border border-white/10 dropdown-panel shadow-2xl focus:outline-none overflow-hidden fade-in z-[100]">
          {/* No dead scrollbar-none class: the scrollbar is the cue that more options exist. */}
          <div className="py-1 max-h-68 overflow-y-auto" role="listbox">
            {options.map((option) => {
              const isSelected = option.value === selectedValue;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(option.value)}
                  // Titles truncate; keep the full one on hover.
                  title={option.label}
                  className={`flex w-full items-center px-4 py-2.5 text-xs text-left transition-colors ${
                    isSelected
                      ? 'bg-primary-fixed-dim/10 text-primary-fixed-dim font-semibold'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className="truncate flex-1">{option.label}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 ml-2 shrink-0 text-primary-fixed-dim" />}
                </button>
              );
            })}

            {options.length === 0 && (
              <div className="px-4 py-3 text-xs text-slate-500 italic text-center">
                No {itemNoun}s available
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
