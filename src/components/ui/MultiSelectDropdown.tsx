import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

/**
 * One selectable row. `value` must be UNIQUE and stable — it is the React key, the
 * membership test and what `onChange` reports.
 *
 * It used to be a bare `string[]` of labels, which meant two options sharing a
 * label were indistinguishable: they collided as React keys, ticked together, and
 * only the first could ever be resolved back to a record. A material with three
 * concepts named "SECURE SOFTWARE DEVELOPMENT" made all three of those visible at
 * once. Pass an id as `value` and a label as `label`.
 */
export interface DropdownOption {
  value: string;
  label: string;
  /** Optional muted suffix, e.g. a count or a page number. */
  hint?: string;
}

interface MultiSelectDropdownProps {
  selectedValues: string[];
  onChange: (values: string[]) => void;
  options: DropdownOption[];
  placeholder?: string;
  className?: string;
  /** Noun used in the button text, e.g. "resource" or "concept". */
  itemNoun?: string;
}

export default function MultiSelectDropdown({
  selectedValues,
  onChange,
  options,
  placeholder = 'Select resources...',
  className = '',
  itemNoun = 'resource',
}: MultiSelectDropdownProps) {
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

  const handleToggleOption = (val: string) => {
    if (selectedValues.includes(val)) {
      onChange(selectedValues.filter((v) => v !== val));
    } else {
      onChange([...selectedValues, val]);
    }
  };

  const handleSelectAll = () => {
    if (selectedValues.length === options.length) {
      onChange([]);
    } else {
      onChange(options.map((o) => o.value));
    }
  };

  const buttonText =
    selectedValues.length === 0
      ? placeholder
      : selectedValues.length === options.length
      ? `All ${itemNoun}s`
      : `${selectedValues.length} ${itemNoun}${selectedValues.length > 1 ? 's' : ''} selected`;

  // w-fit stops a flex/grid parent from stretching the root, which would drag the
  // panel with it — the panel is sized and positioned against this element.
  return (
    <div className={`relative inline-block w-fit text-left font-sans ${className}`} ref={containerRef}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="inline-flex w-56 items-center justify-between gap-x-2 rounded-xl bg-surface-container/60 border border-white/10 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-surface-container/85 focus:outline-none focus:ring-2 focus:ring-primary-fixed-dim/40 transition-all active:scale-98"
          aria-expanded="true"
          aria-haspopup="true"
        >
          <span className="truncate flex-1 text-left">{buttonText}</span>
          <ChevronDown
            className={`h-4 w-4 text-slate-400 transition-transform duration-300 shrink-0 ${isOpen ? 'rotate-180 text-white' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {isOpen && (
        // `left-0 w-full` pins the panel exactly under its trigger. See the same
        // fix in SingleSelectDropdown: `right-0 w-64` against a `w-56` button
        // made the panel overhang its own left edge by 32px, and wherever the
        // control sat flush against a container edge that overhang was clipped,
        // cutting the first characters off every option label.
        <div className="absolute left-0 mt-2 w-full origin-top-left rounded-xl border border-white/10 bg-surface-container-high shadow-2xl ring-1 ring-black ring-opacity-5 focus:outline-none overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 backdrop-blur-md z-[100]">
          <div className="py-1 max-h-68 overflow-y-auto scrollbar-none" role="none">
            {/* Select All toggle */}
            {options.length > 0 && (
              <button
                type="button"
                onClick={handleSelectAll}
                className="flex w-full items-center px-4 py-2.5 text-xs text-left border-b border-white/5 text-primary-fixed-dim hover:bg-white/5 font-bold transition-colors"
              >
                <div className="w-4 h-4 rounded border border-white/20 flex items-center justify-center mr-2.5 shrink-0 bg-white/5">
                  {selectedValues.length === options.length && (
                    <Check className="w-3 h-3 text-primary-fixed-dim" />
                  )}
                </div>
                <span>{selectedValues.length === options.length ? 'Deselect All' : 'Select All'}</span>
              </button>
            )}

            {options.map((option) => {
              const isSelected = selectedValues.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleToggleOption(option.value)}
                  className={`flex w-full items-center px-4 py-2.5 text-xs text-left transition-colors ${
                    isSelected
                      ? 'bg-primary-fixed-dim/10 text-primary-fixed-dim font-semibold'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`}
                  role="menuitem"
                  // Concept terms run long — "SECURE SOFTWARE DEVELOPMENT LIFE
                  // CYCLE (SSDLC)" truncates in a panel this wide, so the full
                  // text stays reachable on hover.
                  title={option.label}
                >
                  <div className="w-4 h-4 rounded border border-white/20 flex items-center justify-center mr-2.5 shrink-0 bg-white/5">
                    {isSelected && <Check className="w-3 h-3 text-primary-fixed-dim" />}
                  </div>
                  <span className="truncate flex-1">{option.label}</span>
                  {option.hint && (
                    <span className="ml-2 shrink-0 text-[10px] font-medium text-slate-500">
                      {option.hint}
                    </span>
                  )}
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
