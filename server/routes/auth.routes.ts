import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { RegisterSchema } from '../types/api';

const router = Router();

/**
 * POST /api/auth/register
 *
 * Called immediately after Supabase Auth signup on the frontend.
 * Creates the corresponding row in the `profiles` table.
 *
 * Body: { email, password, first_name, last_name, role, institution_id? }
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { email, password, first_name, last_name, role, institution_id } = parsed.data;

  // 1. Create the user in Supabase Auth
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // Auto-confirm for now; enable email verification in production
  });

  if (authError || !authData.user) {
    res.status(400).json({ error: 'Registration failed', message: authError?.message });
    return;
  }

  // 2. Create the profile row linked to the auth user
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .insert({
      id: authData.user.id,
      first_name,
      last_name,
      role,
      institution_id: institution_id ?? null,
    })
    .select()
    .single();

  if (profileError) {
    // Rollback: delete the auth user if profile creation fails
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    res.status(500).json({ error: 'Profile creation failed', message: profileError.message });
    return;
  }

  res.status(201).json({ data: profile, message: 'Account created successfully' });
});

/**
 * GET /api/auth/me
 *
 * Returns the authenticated user's profile.
 */
router.get('/me', authenticate, async (req: Request, res: Response): Promise<void> => {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('*, institutions(name)')
    .eq('id', req.user!.id)
    .single();

  if (error || !profile) {
    res.status(404).json({ error: 'Profile not found', message: error?.message });
    return;
  }

  res.json({ data: profile });
});

export default router;
