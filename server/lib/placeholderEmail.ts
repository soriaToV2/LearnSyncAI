/**
 * Placeholder addresses (`<username>@pca.invalid`, RFC 2606) for accounts created without an email.
 * Supabase needs a unique identity per account. Never display one. Such accounts sign in normally
 * but can only have their password reset by an admin.
 */

import { z } from 'zod';

const PLACEHOLDER_EMAIL_DOMAIN = 'pca.invalid';

export function placeholderEmailFor(username: string): string {
  return `${username}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

/** True for a generated address. Every screen that prints an email must check this. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}

/**
 * Whether mail to this address could arrive. Wider than isPlaceholderEmail(): some legacy
 * accounts hold bare words like `admin`. Password recovery must key off this predicate.
 */
export function canReceiveMail(email: string | null | undefined): boolean {
  if (!email || isPlaceholderEmail(email)) return false;
  return z.string().email().safeParse(email).success;
}
