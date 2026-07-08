import { Request, Response, NextFunction } from 'express';

/**
 * Authentication guard: ensures the request comes from an authenticated student.
 *
 * Must be used AFTER the `authenticate` middleware (which populates `req.user`).
 * Since the application is now student-only, this middleware simply confirms
 * the user is logged in. Returns 401 if not authenticated.
 *
 * Usage:
 *   router.post('/spaces', authenticate, requireStudent, handler);
 */
export function requireRole(_role: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized', message: 'Not authenticated' });
      return;
    }
    // All authenticated users are students — no role check needed
    next();
  };
}
