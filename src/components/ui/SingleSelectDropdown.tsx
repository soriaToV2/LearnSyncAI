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

  // w-fit stops a flex/grid parent from stretching the root, which would drag the
  // panel with it — the panel is sized and positioned against this element.
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
        // `left-0 w-full` pins the panel exactly under its trigger.
        //
        // It was `right-0 w-64` against a `w-56` button — 32px wider than the
        // trigger and anchored to the trigger's RIGHT edge, so the panel hung
        // 32px past its left. Wherever the control sits flush against a
        // container edge (Free Recall's composer aligns it left), that overhang
        // was clipped and took the start of every label with it: "6. Information
        // Security" rendered as "Information Security".
        //
        // w-full rather than a repeated w-56 so the panel tracks the button if
        // its width is ever changed.
        <div className="absolute left-0 mt-2 w-full origin-top-left rounded-xl border border-white/10 bg-surface-container-high shadow-2xl ring-1 ring-black ring-opacity-5 focus:outline-none overflow-hidden fade-in duration-150 backdrop-blur-md z-[100]">
          {/* `scrollbar-none` removed, NOT swapped for `no-scrollbar`. Verified
              against the built CSS: it generated zero rules, so the panel has
              always shown its scrollbar — and for a scrolling option list that
              scrollbar is the only cue that more options exist below. Activating
              the author's original intent would delete a useful affordance, so
              this drops the dead class and leaves behaviour exactly as it is. */}
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
                  // Material titles truncate in a panel this wide; keep the full
                  // one reachable on hover.
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
