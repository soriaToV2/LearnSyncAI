interface GradeChipsProps {
  /** materials.grade_levels — the JHS grades this material is published to. */
  grades: number[];
  className?: string;
}

/** Renders smallint[] grade levels as compact G7/G8 pills. */
export default function GradeChips({ grades, className = '' }: GradeChipsProps) {
  if (grades.length === 0) {
    return (
      <span className={`font-sans text-[10px] text-slate-500 italic ${className}`}>
        No grades assigned
      </span>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {[...grades].sort((a, b) => a - b).map((g) => (
        <span
          key={g}
          title={`Grade ${g}`}
          className="px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-300 font-sans text-[10px] font-bold tracking-wide"
        >
          G{g}
        </span>
      ))}
    </div>
  );
}
