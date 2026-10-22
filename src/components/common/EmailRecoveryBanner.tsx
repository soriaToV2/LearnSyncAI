import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MailWarning, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

/**
 * "Add an email address so you can reset your own password." The only prompt that moves an account
 * from admin-only resets to self-service recovery.
 * Gated on email_can_receive (not the placeholder flag), shown to all roles, and dismissible for the
 * session only (sessionStorage), so it returns at the next sign-in.
 */

const DISMISS_KEY = 'lsai.emailBanner.dismissed';

/** Wrapped: sessionStorage throws in private windows. Defaults to not dismissed. */
function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberDismissed(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* Nothing to do — the banner simply returns on the next page load. */
  }
}

export default function EmailRecoveryBanner({ accent }: { accent: string }) {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(readDismissed);

  // Render nothing while the profile loads.
  if (!user || user.email_can_receive || dismissed) return null;

  // Each portal's Profile route renders the same AccountForms.
  const profilePath =
    user.role === 'admin'
      ? '/admin/profile'
      : user.role === 'educator'
        ? '/educator/profile'
        : '/student/profile';

  const dismiss = () => {
    rememberDismissed();
    setDismissed(true);
  };

  // Own padding and max-width to align with the page container (it renders above <main>). Inside the
  // early return, so most pages get no extra band.
  return (
    <div className="px-4 pt-4 sm:px-6 sm:pt-6 md:px-8">
      <div className="mx-auto max-w-[1200px]">
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border px-4 py-3 fade-in"
          style={{ backgroundColor: `${accent}14`, borderColor: `${accent}33` }}
        >
          <MailWarning className="mt-0.5 h-4 w-4 shrink-0" style={{ color: accent }} aria-hidden="true" />

          <div className="min-w-0 flex-1">
            <p className="font-sans text-sm font-semibold text-white">
              Add an email address so you can reset your own password.
            </p>
            {/* States the consequence without overpromising: admin resets still work without an address. */}
            <p className="mt-0.5 font-sans text-xs leading-relaxed text-slate-400">
              Without one, only a school administrator can get you back into your account.{' '}
              <Link
                to={profilePath}
                className="font-semibold underline underline-offset-2 transition-colors hover:text-white"
                style={{ color: accent }}
              >
                Add it now
              </Link>
            </p>
          </div>

          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss for now"
            className="shrink-0 rounded-lg p-1 text-slate-500 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
