import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { UserRole } from '../types/database';

/**
 * Role-based access guard. Must run AFTER `authenticate` (which populates
 * `req.user`).
 *
 * Looks up the caller's profile and enforces two things:
 *   - the account is active (a disabled account is rejected even with a valid JWT);
 *   - the account's role is one of the roles this route allows.
 *
 * This is the enforcement point for the paper's rule that only educators may
 * upload learning resources — students hitting an educator route get a 403.
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
      .select('role, status')
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
