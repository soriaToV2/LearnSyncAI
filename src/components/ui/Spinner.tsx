import { Loader2 } from 'lucide-react';

/**
 * The one loading spinner (a ring). Don't add another design; RefreshCw is only for refresh/retry
 * buttons, not loading. Size and colour via className; rotation is built in.
 */
export default function Spinner({
  className = 'w-4 h-4',
  label = 'Loading',
}: {
  /** Size and colour utilities. Rotation is added automatically. */
  className?: string;
  /** Screen-reader label, default "Loading" (sent via a visually hidden span; the icon is aria-hidden). */
  label?: string;
}) {
  return (
    <span role="status" className="inline-flex shrink-0">
      <Loader2 className={`animate-spin ${className}`} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
