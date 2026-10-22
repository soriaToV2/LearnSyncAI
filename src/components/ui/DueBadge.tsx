/** Due-card count badge, shared by all three call sites. Cyan, not red: due cards are an invitation, not an error. */
export default function DueBadge({
  count,
  className = '',
}: {
  count: number;
  className?: string;
}) {
  // Callers pass a raw count; zero renders nothing.
  if (count <= 0) return null;

  // New decks are entirely due, so cap the label but keep the real number in the accessible name.
  const label = count > 99 ? '99+' : String(count);

  return (
    <span
      // A bare numeral reads as nothing useful to a screen reader.
      aria-label={`${count} card${count === 1 ? '' : 's'} due for review`}
      className={`inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] px-1
        rounded-full bg-primary-fixed-dim text-on-primary-fixed
        font-sans text-[10px] font-bold leading-none tabular-nums ${className}`}
    >
      {label}
    </span>
  );
}
