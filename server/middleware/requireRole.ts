import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { UserRole } from '../types/database';

/**
 * Role-based access guard. Must run AFTER `authenticate` (which populates
 * `req.user`).
 *
 * Looks up the caller's profile and enforces three things:
 *   - the account is active (a disabled account is rejected even with a valid JWT);
 *   - the account has replaced the password an administrator set for it;
 *   - the account's role is one of the roles this route allows.
 *
 * This is the enforcement point for the paper's rule that only educators may
 * upload learning resources — students hitting an educator route get a 403.
 *
 * ⚠️ IT IS THE ONLY MIDDLEWARE THAT READS `profiles`, WHICH MAKES IT THE ONLY
 * PLACE THE TWO ACCOUNT GATES CAN LIVE — and therefore a route that mounts
 * `authenticate` without it is ungated. Three such routes were found and given
 * `requireRole('student')` when the activation gate landed: both of
 * `chat.routes.ts`, `GET /api/spaces/:id`, and `POST /api/materials/concepts/batch`.
 * The four authenticated routes in `auth.routes.ts` remain deliberately outside
 * it — see that file, and note that two of them MUST stay open or an
 * un-activated user has no way to activate.
 *
 * Usage:
 *   router.post('/', authenticate, requireRole('educator'), handler);
 *   router.get('/x', authenticate, requireRole('educator', 'admin'), handler);
 */
export function requireRole(...allowed: UserRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
      return;
    }

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('role, status, must_change_password')
      .eq('id', req.user.id)
      .single();

    if (error || !profile) {
      res.status(403).json({ error: 'Forbidden', message: 'No profile found for this account' });
      return;
    }

    if (profile.status !== 'active') {
      res.status(403).json({ error: 'Forbidden', message: 'This account has been disabled' });
      return;
    }

    /*
     * The account still holds a password an administrator chose, so the
     * administrator knows it — and for a bulk import, so does everyone who saw
     * the credentials table. Nothing may be read or written under that password
     * until the holder replaces it.
     *
     * A DISTINCT `error` code, not the disabled message: the two are both 403 and
     * mean completely different things to a client. This one is recoverable by
     * the user themself, in one step, at `/set-password`.
     *
     * The way out deliberately does not pass through here — `GET /api/auth/me`
     * and `POST /api/auth/change-password` mount `authenticate` alone. Gating
     * either would leave the account with no route to activation.
     */
    if (profile.must_change_password) {
      res.status(403).json({
        error: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Set your own password before using the platform',
      });
      return;
    }

    if (!allowed.includes(profile.role as UserRole)) {
      res.status(403).json({
        error: 'Forbidden',
        message: `This action requires the ${allowed.join(' or ')} role`,
      });
      return;
    }

    next();
  };
}
