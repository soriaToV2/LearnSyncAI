import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { UserRole } from '../types/database';

/**
 * Role-based access control middleware factory.
 *
 * Must be used AFTER the `authenticate` middleware (which populates `req.user`).
 * Queries the `profiles` table to check the user's role and rejects with 403
 * if it doesn't match the required role.
 *
 * Usage:
 *   router.post('/courses', authenticate, requireRole('instructor'), handler);
 *   router.post('/submit', authenticate, requireRole('student'), handler);
 *
 * @param role - The required role: 'instructor' or 'student'
 */
export function requireRole(role: UserRole) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
      return;
    }

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (error || !profile) {
      res.status(403).json({ error: 'Forbidden', message: 'Profile not found' });
      return;
    }

    if (profile.role !== role) {
      res.status(403).json({
        error: 'Forbidden',
        message: `This action requires the '${role}' role. Your role is '${profile.role}'.`,
      });
      return;
    }

    next();
  };
}
