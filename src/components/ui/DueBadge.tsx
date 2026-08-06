/**
 * The count of cards waiting for review, as a small superscript badge.
 *
 * One component for all three call sites — the Flashcards tab on desktop, the
 * same row in the mobile tab menu, and each deck tile — so they cannot drift
 * apart in colour, size or rounding.
 *
 * Cyan rather than a red alert colour: a due card is an invitation to study,
 * not an error the student has to clear. Red would make an ordinary Tuesday
 * look like something has gone wrong.
 */
export default function DueBadge({
  count,
  className = '',
}: {
  count: number;
  className?: string;
}) {
  // Every caller can pass a raw count and let this decide — no `count > 0 &&`
  // guards scattered across three files, each able to forget.
  if (count <= 0) return null;

  // A freshly generated deck is entirely due (next_review_at defaults to now()),
  // so this can legitimately be 200. Cap the label, keep the real number in the
  // accessible name.
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
