import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { BktRecalculateSchema } from '../types/api';
import axios from 'axios';

const router = Router();
router.use(authenticate, requireRole('student'));

/**
 * GET /api/bkt/mastery
 * Returns the authenticated student's BKT mastery scores for all concepts.
 * Optionally filtered by material_id query param.
 */
router.get('/mastery', async (req: Request, res: Response): Promise<void> => {
  const studentId = req.user!.id;
  const { material_id } = req.query;

  let query = supabaseAdmin
    .from('bkt_mastery')
    .select('*, concepts(term, definition, material_id)')
    .eq('student_id', studentId)
    .order('latent_mastery', { ascending: false });

  // Optionally filter by material
  if (material_id && typeof material_id === 'string') {
    query = supabaseAdmin
      .from('bkt_mastery')
      .select('*, concepts!inner(term, definition, material_id)')
      .eq('student_id', studentId)
      .eq('concepts.material_id', material_id)
      .order('latent_mastery', { ascending: false });
  }

  const { data, error } = await query;

  if (error) {
    res.status(500).json({ error: 'Failed to fetch mastery scores', message: error.message });
    return;
  }

  res.json({ data });
});

/**
 * POST /api/bkt/recalculate
 * Manually triggers BKT mastery recalculation for specific concepts
 * by proxying to the Python BKT microservice.
 *
 * This is called automatically by practice.routes.ts after a test completes,
 * but can also be called manually for development/testing.
 *
 * Body: { concept_ids?: string[] }  (omit to recalculate all concepts)
 */
router.post('/recalculate', async (req: Request, res: Response): Promise<void> => {
  const parsed = BktRecalculateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const bktServiceUrl = process.env.BKT_SERVICE_URL ?? 'http://localhost:8000';

  try {
    const response = await axios.post(`${bktServiceUrl}/recalculate`, {
      student_id: req.user!.id,
      concept_ids: parsed.data.concept_ids,
    });

    res.json({
      data: response.data,
      message: 'BKT mastery recalculation completed',
    });
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? 503;
      res.status(status).json({
        error: 'BKT service error',
        message: err.response?.data?.detail ?? 'Python BKT microservice unavailable',
      });
    } else {
      res.status(500).json({ error: 'Internal error', message: String(err) });
    }
  }
});

export default router;
