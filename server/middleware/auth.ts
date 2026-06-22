import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { User } from '@supabase/supabase-js';

// Extend Express's Request type to include the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/**
 * Authentication middleware.
 *
 * Reads the `Authorization: Bearer <token>` header, verifies the JWT
 * with Supabase, and attaches the user object to `req.user`.
 *
 * Must be placed before any route handler that requires authentication.
 *
 * Usage:
 *   router.get('/protected', authenticate, (req, res) => { ... });
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized', message: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.split(' ')[1];

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' });
    return;
  }

  req.user = data.user;
  next();
}
