import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { UserRole } from '../types/database';

/**
 * Role guard; runs after `authenticate`. Rejects disabled accounts, accounts still holding an
 * admin-set password, and wrong roles. The only middleware that reads `profiles`, so a route with
 * `authenticate` alone skips both account gates.
 * Usage: router.post('/', authenticate, requireRole('educator'), handler);
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

    // Still on an admin-set password: refuse with a distinct code (recoverable at /set-password).
    // GET /auth/me and POST /auth/change-password bypass this so activation remains possible.
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
