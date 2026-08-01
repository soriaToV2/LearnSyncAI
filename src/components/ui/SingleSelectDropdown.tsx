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
 * Picks exactly one option. Radio semantics: choosing replaces the previous choice
 * and closes the menu — there is no "Select All" and no way to end up with two.
 *
 * Used for the Material choice in Free Recall and Feynman. Those evaluate a
 * submission against one lesson, and the constraint is enforced server-side too
 * (`material_ids` is capped at 1 in both Zod schemas) — this control makes the rule
 * visible rather than being the thing that enforces it.
 *
 * Selection is by `value` (a material id), never by label, so two materials sharing
 * a title stay distinguishable.
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
    // Re-picking the current one clears it, so a choice is not a trap.
    onChange(value === selectedValue ? null : value);
    setIsOpen(false);
  };

  // w-fit stops a flex/grid parent from stretching the root. The panel below is
  // anchored with `right-0`, so a stretched root would fling it to the far edge.
  return (
    <div className={`relative inline-block w-fit text-left font-sans ${className}`} ref={containerRef}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="inline-flex w-56 items-center justify-between gap-x-2 rounded-xl bg-surface-container/60 border border-white/10 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-surface-container/85 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/40 transition-all active:scale-98"
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
        <div className="absolute right-0 mt-2 w-64 origin-top-right rounded-xl border border-white/10 bg-surface-container-high shadow-2xl ring-1 ring-black ring-opacity-5 focus:outline-none overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 backdrop-blur-md z-[100]">
          <div className="py-1 max-h-68 overflow-y-auto scrollbar-none" role="listbox">
            {options.map((option) => {
              const isSelected = option.value === selectedValue;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(option.value)}
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
