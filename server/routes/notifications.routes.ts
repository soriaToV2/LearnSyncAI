import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';

const router = Router();
router.use(authenticate, requireRole('student'));

/**
 * GET /api/notifications
 * Returns all notifications for the authenticated student.
 * Ordered by newest first, with unread notifications at the top.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select('*')
    .eq('student_id', req.user!.id)
    .order('is_read', { ascending: true })   // unread first
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: 'Failed to fetch notifications', message: error.message });
    return;
  }

  const unreadCount = (data ?? []).filter((n) => !n.is_read).length;

  res.json({ data, unread_count: unreadCount });
});

/**
 * PUT /api/notifications/:id/read
 * Marks a single notification as read.
 */
router.put('/:id/read', async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .update({ is_read: true })
    .eq('id', req.params.id)
    .eq('student_id', req.user!.id)
    .select()
    .single();

  if (error || !data) {
    res.status(404).json({ error: 'Notification not found or unauthorized', message: error?.message });
    return;
  }

  res.json({ data, message: 'Notification marked as read' });
});

/**
 * PUT /api/notifications/read-all
 * Marks ALL notifications for the student as read.
 */
router.put('/read-all', async (req: Request, res: Response): Promise<void> => {
  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ is_read: true })
    .eq('student_id', req.user!.id)
    .eq('is_read', false);

  if (error) {
    res.status(500).json({ error: 'Failed to mark notifications as read', message: error.message });
    return;
  }

  res.json({ message: 'All notifications marked as read' });
});

export default router;
