import { subjectName } from '../../data/mockEducator';

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
  const color = SUBJECT_COLOR[code] ?? FALLBACK;

  return (
    <span
      title={subjectName(code)}
      className={`inline-flex items-center px-2 py-0.5 rounded-md border font-sans text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${className}`}
      style={{
        color,
        backgroundColor: `${color}1a`,
        borderColor: `${color}33`,
      }}
    >
      {full ? subjectName(code) : code}
    </span>
  );
}

export { SUBJECT_COLOR };
