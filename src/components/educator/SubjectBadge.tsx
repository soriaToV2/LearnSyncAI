import type { CSSProperties } from 'react';
import { useSubjectName } from '../../context/SubjectsContext';

/**
 * A stable colour per subject code, so the same subject always reads the same
 * across the dashboard, library, and roster. Codes match public.subjects.
 */
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

  /*
   * ⚠️ `.tone-chip` + `--tone`, NOT three inline colours. The inline version
   * could not be themed at all — an inline style beats every stylesheet rule,
   * so the light theme's overrides could not reach it and these badges rendered
   * at ~2:1 contrast on white. See the TINTED CHIPS block in `index.css` for the
   * measurements and for how the light value is derived. Dark mode is
   * unchanged: 10% and 20% are exactly what the `1a`/`33` suffixes meant.
   */
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
