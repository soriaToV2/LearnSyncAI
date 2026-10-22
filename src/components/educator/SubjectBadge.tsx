import type { CSSProperties } from 'react';
import { useSubjectName } from '../../context/SubjectsContext';

/** A stable colour per subject code. */
const SUBJECT_COLOR: Record<string, string> = {
  FIL: '#f472b6',
  ENG: '#60a5fa',
  MATH: '#a78bfa',
  SCI: '#34d399',
  AP: '#fbbf24',
  ESP: '#22d3ee',
  TLE: '#fb923c',
  MAPEH: '#f87171',
  CL: '#818cf8',
};

const FALLBACK = '#94a3b8';

interface SubjectBadgeProps {
  code: string;
  /** Show the full subject name instead of the short code. */
  full?: boolean;
  className?: string;
}

export default function SubjectBadge({ code, full = false, className = '' }: SubjectBadgeProps) {
  const subjectNameOf = useSubjectName();
  const color = SUBJECT_COLOR[code] ?? FALLBACK;

  // .tone-chip + --tone, not inline colours, so the light theme can fix contrast. See index.css TINTED CHIPS.
  return (
    <span
      title={subjectNameOf(code)}
      className={`tone-chip inline-flex items-center px-2 py-0.5 rounded-md border font-sans text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${className}`}
      style={{ '--tone': color } as CSSProperties}
    >
      {full ? subjectNameOf(code) : code}
    </span>
  );
}

export { SUBJECT_COLOR };
