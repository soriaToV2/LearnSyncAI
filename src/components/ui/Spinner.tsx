import { Loader2 } from 'lucide-react';

/**
 * The ONE loading spinner. Every "we are waiting" indicator in the app renders
 * this — there is no second design and there must not be one.
 *
 * ⚠️ THIS EXISTS BECAUSE THE APP SHIPPED TWO SPINNERS THAT MEANT THE SAME THING.
 * Fifty-odd places drew lucide's `Loader2` — a plain broken ring — while ten
 * drew `RefreshCw`, which is a circle made of two ARROWS. Spinning an arrow is a
 * different statement: an arrowhead points somewhere, so `RefreshCw` reads as
 * "reloading / syncing / try again" rather than "working". They sat side by side
 * on the same screens (the student dashboard spun arrows; the educator dashboard
 * spun a ring, for the identical operation), and one of them was a CSS
 * `border-t` circle in `FlashcardStudyView` that matched neither.
 *
 * The ring wins because it says the least. A spinner's whole job is "not
 * finished yet"; anything more specific is a claim the caller has not made.
 *
 * ⚠️ `RefreshCw` IS STILL CORRECT WHEN IT IS NOT SPINNING. Five call sites use
 * it as the icon ON a refresh/retry button, where the arrows are the meaning
 * rather than decoration. Those were deliberately left alone — the rule is "one
 * spinner", not "no arrows anywhere".
 *
 * ── USAGE ──
 * `className` carries size and colour exactly as it did on the raw icon, so
 * migrating a call site was renaming the tag and deleting `animate-spin`:
 *
 *   <Loader2 className="w-4 h-4 animate-spin" />   →   <Spinner className="w-4 h-4" />
 *
 * The rotation is applied here and is not overridable, which is the point — a
 * call site cannot opt into a different one.
 *
 * Sizes in use run w-3 to w-8. There is deliberately no `size` prop enumerating
 * them: a Tailwind class is already the project's vocabulary for size, and a
 * second one would just have to be kept in sync with it.
 */
export default function Spinner({
  className = 'w-4 h-4',
  label = 'Loading',
}: {
  /** Size and colour utilities. Rotation is added automatically. */
  className?: string;
  /**
   * What a screen reader announces. Defaults to "Loading".
   *
   * The icon is `aria-hidden` and the name is carried by a visually hidden
   * `<span>` on the wrapper, because an SVG's `<title>` is announced
   * inconsistently and lucide does not emit one at all — so every spinner in the
   * app was previously silent to assistive tech.
   */
  label?: string;
}) {
  return (
    <span role="status" className="inline-flex shrink-0">
      <Loader2 className={`animate-spin ${className}`} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
