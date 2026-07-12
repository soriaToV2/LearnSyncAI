import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

interface MultiSelectDropdownProps {
  selectedValues: string[];
  onChange: (values: string[]) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}

export default function MultiSelectDropdown({
  selectedValues,
  onChange,
  options,
  placeholder = 'Select resources...',
  className = ''
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
      onChange([...options]);
    }
  };

  const buttonText =
    selectedValues.length === 0
      ? placeholder
      : selectedValues.length === options.length
      ? 'All resources'
      : `${selectedValues.length} resource${selectedValues.length > 1 ? 's' : ''} selected`;

  // w-fit stops a flex/grid parent from stretching the root. The panel below is anchored
  // with `right-0`, so a stretched root would fling it out to the container's right edge.
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
        <div className="absolute right-0 mt-2 w-64 origin-top-right rounded-xl border border-white/10 bg-surface-container-high shadow-2xl ring-1 ring-black ring-opacity-5 focus:outline-none overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 backdrop-blur-md z-[100]">
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
              const isSelected = selectedValues.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleToggleOption(option)}
                  className={`flex w-full items-center px-4 py-2.5 text-xs text-left transition-colors ${
                    isSelected
                      ? 'bg-primary-fixed-dim/10 text-primary-fixed-dim font-semibold'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`}
                  role="menuitem"
                >
                  <div className="w-4 h-4 rounded border border-white/20 flex items-center justify-center mr-2.5 shrink-0 bg-white/5">
                    {isSelected && <Check className="w-3 h-3 text-primary-fixed-dim" />}
                  </div>
                  <span className="truncate flex-1">{option}</span>
                </button>
              );
            })}

            {options.length === 0 && (
              <div className="px-4 py-3 text-xs text-slate-500 italic text-center">
                No resources available
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
