import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  CreateCourseSchema,
  UpdateCourseSchema,
  JoinCourseSchema,
  CreateAnnouncementSchema,
} from '../types/api';
import { randomBytes } from 'crypto';

const router = Router();

// All course routes require authentication
router.use(authenticate);

// ── Helper ────────────────────────────────────────────────

/** Generates a short unique join code, e.g. "AB12CD" */
function generateJoinCode(): string {
  return randomBytes(3).toString('hex').toUpperCase();
}

// ── Course CRUD ───────────────────────────────────────────

/**
 * GET /api/courses
 * Returns courses associated with the authenticated user.
 * Instructors see their own courses; students see their enrolled courses.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  let query;
  if (profile?.role === 'instructor') {
    query = supabaseAdmin
      .from('courses')
      .select('*, profiles!instructor_id(first_name, last_name)')
      .eq('instructor_id', userId)
      .order('created_at', { ascending: false });
  } else {
    query = supabaseAdmin
      .from('enrollments')
      .select('courses(*, profiles!instructor_id(first_name, last_name))')
      .eq('student_id', userId);
  }

  const { data, error } = await query;
  if (error) {
    res.status(500).json({ error: 'Failed to fetch courses', message: error.message });
    return;
  }

  // Flatten enrolled courses for student
  const courses = profile?.role === 'student'
    ? (data as Array<{ courses: unknown }>).map((e) => e.courses)
    : data;

  res.json({ data: courses });
});

/**
 * POST /api/courses
 * Creates a new course. Instructors only.
 */
router.post('/', requireRole('instructor'), async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateCourseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const joinCode = generateJoinCode();

  const { data, error } = await supabaseAdmin
    .from('courses')
    .insert({ ...parsed.data, instructor_id: req.user!.id, join_code: joinCode })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: 'Failed to create course', message: error.message });
    return;
  }

  res.status(201).json({ data, message: 'Course created successfully' });
});

/**
 * GET /api/courses/:id
 * Returns a single course by ID.
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('courses')
    .select('*, profiles!instructor_id(first_name, last_name, role)')
    .eq('id', req.params.id)
    .single();

  if (error || !data) {
    res.status(404).json({ error: 'Course not found', message: error?.message });
    return;
  }

  res.json({ data });
});

/**
 * PUT /api/courses/:id
 * Updates a course. Instructors only (must own the course).
 */
router.put('/:id', requireRole('instructor'), async (req: Request, res: Response): Promise<void> => {
  const parsed = UpdateCourseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('courses')
    .update(parsed.data)
    .eq('id', req.params.id)
    .eq('instructor_id', req.user!.id)
    .select()
    .single();

  if (error || !data) {
    res.status(404).json({ error: 'Course not found or unauthorized', message: error?.message });
    return;
  }

  res.json({ data, message: 'Course updated' });
});

/**
 * DELETE /api/courses/:id
 * Deletes a course. Instructors only (must own the course).
 */
router.delete('/:id', requireRole('instructor'), async (req: Request, res: Response): Promise<void> => {
  const { error } = await supabaseAdmin
    .from('courses')
    .delete()
    .eq('id', req.params.id)
    .eq('instructor_id', req.user!.id);

  if (error) {
    res.status(500).json({ error: 'Failed to delete course', message: error.message });
    return;
  }

  res.json({ message: 'Course deleted' });
});

// ── Enrollment ────────────────────────────────────────────

/**
 * POST /api/courses/:id/join
 * Student joins a course using a join_code. Students only.
 */
router.post('/:id/join', requireRole('student'), async (req: Request, res: Response): Promise<void> => {
  const parsed = JoinCourseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { data: course, error: courseError } = await supabaseAdmin
    .from('courses')
    .select('id')
    .eq('id', req.params.id)
    .eq('join_code', parsed.data.join_code)
    .single();

  if (courseError || !course) {
    res.status(404).json({ error: 'Invalid join code or course not found' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('enrollments')
    .insert({ course_id: course.id, student_id: req.user!.id })
    .select()
    .single();

  if (error) {
    // Unique constraint violation = already enrolled
    if (error.code === '23505') {
      res.status(409).json({ error: 'Already enrolled in this course' });
    } else {
      res.status(500).json({ error: 'Enrollment failed', message: error.message });
    }
    return;
  }

  res.status(201).json({ data, message: 'Enrolled successfully' });
});

/**
 * GET /api/courses/:id/students
 * Lists all enrolled students in a course. Instructors only.
 */
router.get('/:id/students', requireRole('instructor'), async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('enrollments')
    .select('enrolled_at, profiles!student_id(id, first_name, last_name, role)')
    .eq('course_id', req.params.id);

  if (error) {
    res.status(500).json({ error: 'Failed to fetch students', message: error.message });
    return;
  }

  res.json({ data });
});

// ── Announcements ─────────────────────────────────────────

/**
 * GET /api/courses/:id/announcements
 * Lists all announcements for a course.
 */
router.get('/:id/announcements', async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabaseAdmin
    .from('course_announcements')
    .select('*')
    .eq('course_id', req.params.id)
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).json({ error: 'Failed to fetch announcements', message: error.message });
    return;
  }

  res.json({ data });
});

/**
 * POST /api/courses/:id/announcements
 * Creates an announcement for a course. Instructors only.
 */
router.post(
  '/:id/announcements',
  requireRole('instructor'),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateAnnouncementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('course_announcements')
      .insert({
        ...parsed.data,
        course_id: req.params.id,
        instructor_id: req.user!.id,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: 'Failed to create announcement', message: error.message });
      return;
    }

    // Note: The DB trigger `trigger_new_announcement` automatically creates
    // notifications for all enrolled students — no additional code needed here.

    res.status(201).json({ data, message: 'Announcement posted' });
  }
);

export default router;
