import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { User } from '@supabase/supabase-js';

// Extend Express's Request with the authenticated user.
declare global {
  namespace Express {
    interface Request {
      user?: User;
      /** Raw bearer token; admin.signOut() needs the JWT, not the user id. */
      accessToken?: string;
    }
  }
}

/**
 * Verifies the bearer token with the Supabase auth server and sets `req.user`. The server round trip
 * is what makes revoked sessions fail; don't replace it with local JWT verification.
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
  req.accessToken = token;
  next();
}
