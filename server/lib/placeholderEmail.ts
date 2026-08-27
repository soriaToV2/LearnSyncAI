/**
 * Placeholder sign-in addresses, and the one rule about them: never show one to
 * anybody.
 *
 * ⚠️ ONLY BULK IMPORT PRODUCES THESE NOW. The single-account form requires a real
 * email, because an administrator entering one account at a time has the address
 * in front of them. A CSV of fifty students may be prepared before anyone has
 * collected fifty addresses, and blocking the import on that would make the
 * feature useless exactly when it is needed.
 *
 * `.invalid` is reserved by RFC 2606 precisely so that it can never resolve. That
 * is what makes it safe where a plausible-looking domain would not be: it cannot
 * be mistaken for deliverable, cannot be accidentally mailed, and cannot collide
 * with a real address the school later starts using.
 *
 * ⚠️ Supabase requires an identity on every account and enforces a UNIQUE index on
 * `auth.users.email` (`users_email_partial_key`). So the field cannot be left
 * empty, and two accounts can never share an address — which is also why real
 * emails cannot be reused between siblings.
 *
 * NOT `email = username`: that is exactly the squatting migration 0021 untangled,
 * where `auth.users.email` held `student`, `educ1` and `admin`.
 */

import { z } from 'zod';

const PLACEHOLDER_EMAIL_DOMAIN = 'pca.invalid';

/** `<username>@pca.invalid`. */
export function placeholderEmailFor(username: string): string {
  return `${username}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

/**
 * True for a generated address that must never be displayed.
 *
 * ⚠️ EVERY SCREEN THAT PRINTS AN EMAIL MUST CHECK THIS. The rule the invented
 * `liza.mendoza@pca.edu.ph` broke was about showing a fabricated address as
 * though it were genuine, and a placeholder printed to a student on their own
 * profile page is the same mistake with better intentions. The admin account page
 * checks it; so does the self-service profile, which missed it at first and
 * showed students `juan.delacruz@pca.invalid` as their contact address.
 */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}

/**
 * Whether mail sent to this address could actually arrive.
 *
 * ⚠️ IT IS DELIBERATELY WIDER THAN `isPlaceholderEmail()`, AND CONFLATING THE
 * TWO WOULD SILENTLY EXCLUDE THE ACCOUNT THAT MOST NEEDS THIS. That function
 * tests one thing: the `@pca.invalid` suffix. But migration 0021 untangled
 * usernames that had been squatting in `auth.users.email`, and it did not rewrite
 * the values already there — so `educ1` and `admin` still hold those literal
 * words today, with no `@` at all. `isPlaceholderEmail('admin')` is `false`,
 * because `admin` is not a placeholder; it is simply not an address.
 *
 * Password recovery keys off THIS predicate, never the placeholder flag. Keying
 * it off the narrower one would leave the administrator — the single account
 * whose lockout has no recovery path above it — unable to receive a reset code
 * and never shown the banner telling them so.
 *
 * Three ways to fail, one answer: NULL (no address), a placeholder (generated,
 * undeliverable by RFC 2606), or anything Zod does not accept as an email shape
 * (the bare words above). Nothing here proves the mailbox EXISTS or belongs to
 * the user — only a delivered code does that, which is what the confirmation
 * step on `POST /auth/change-email` is for.
 */
export function canReceiveMail(email: string | null | undefined): boolean {
  if (!email || isPlaceholderEmail(email)) return false;
  return z.string().email().safeParse(email).success;
}
