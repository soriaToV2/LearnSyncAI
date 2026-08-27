import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MailWarning, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

/**
 * "Add an email address so you can reset your own password."
 *
 * ⚠️ THIS IS THE ONLY THING THAT MOVES AN ACCOUNT FROM TIER 2 TO TIER 1. Password
 * recovery has two lanes: a student with a deliverable address resets themselves
 * with a mailed code, and everyone else asks an administrator
 * (`POST /api/admin/accounts/:userId/password`). The second lane is the guaranteed
 * floor and is never removed — but an account only reaches the first lane by
 * volunteering an address, and nothing else in the product ever asks for one.
 *
 * ⚠️ GATED ON `email_can_receive`, NEVER `email_is_placeholder`. The placeholder
 * flag tests only the `@pca.invalid` suffix, so it is FALSE for `admin` and
 * `educ1` — the bare words migration 0021 left in `auth.users.email`. Keying the
 * banner off it would hide this from the administrator, whose lockout is the one
 * with no recovery path above it. See `canReceiveMail()`.
 *
 * SHOWN TO ALL THREE ROLES for that reason. It is not a student-only nag.
 *
 * DISMISSIBLE, AND ONLY FOR THE SESSION. A student who genuinely has no address —
 * which is an ordinary situation here, since CSV import leaves the column
 * optional — must not be nagged on every page load forever. Returning at the next
 * sign-in is enough pressure. `sessionStorage` rather than `localStorage` is what
 * makes "the session" mean the session; a permanent dismissal would silently
 * strand the account in Tier 2 with no reminder it had ever been offered a way
 * out.
 */

const DISMISS_KEY = 'lsai.emailBanner.dismissed';

/**
 * ⚠️ WRAPPED, BECAUSE THE ACCESSOR ITSELF THROWS. A private window or a browser
 * set to block site data raises on `sessionStorage` rather than returning null,
 * so an unguarded read takes the whole portal shell down with it. Failing to
 * "not dismissed" is the right default — the banner reappearing is harmless.
 */
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

  /*
   * `user` is null while `AuthProvider` is still fetching. Rendering nothing is
   * correct: a banner that flashes in and out on every cold load reads as a
   * glitch, and the answer arrives within one request anyway.
   */
  if (!user || user.email_can_receive || dismissed) return null;

  /*
   * Each portal owns its own Profile route, and the three forms behind them are
   * the same `AccountForms` component — so the link lands on a working email
   * field whichever role is signed in.
   */
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

  /*
   * ⚠️ IT CARRIES ITS OWN PADDING AND MAX-WIDTH, and that is not decoration. It
   * renders ABOVE each page's `<main>`, which is where the app's padded container
   * normally lives — so without this it would sit flush against the viewport edge
   * and align with nothing. Matching the page container's own
   * `max-w-[1200px] / px-4 sm:px-6 md:px-8` is what lines it up with the heading
   * underneath.
   *
   * The wrapper is INSIDE the early return above, never outside it: a wrapper that
   * always rendered would leave a band of dead padding on every page for the
   * majority of accounts, which already have a usable address.
   */
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
            {/*
              It states the consequence rather than warning vaguely, because the
              consequence is the entire argument for doing it — and it must not
              overpromise: without an address the administrator route still works, so
              nobody is being told they will be locked out.
            */}
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
