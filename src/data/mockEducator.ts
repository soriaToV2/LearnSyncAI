/* ------------------------------------------------------------------
   Reference data and formatters shared by both portals.

   ⚠️ THE NAME IS NOW WRONG AND THE INVENTED DATA IS GONE. This file used
   to hold placeholder rows for the Educator Portal — one educator,
   eighteen students, eight materials, and a `CONCEPT_MASTERY` table
   generated from an FNV-1a hash of the student id. Every one of those
   arrays has been deleted, because every screen that read them now reads
   the database:

     EducatorDashboard.tsx  -> GET /api/educator/overview
     ClassPerformance.tsx   -> GET /api/educator/materials/:id/performance
     MaterialsLibrary.tsx   -> GET /api/materials
     MaterialDetail.tsx     -> GET /api/materials/:id
     EducatorLayout.tsx     -> GET /api/auth/me (via AuthContext)
     EducatorSettings.tsx   -> GET /api/auth/me (via AuthContext)

   Leaving invented students in the tree after that is exactly the hazard
   that produced the deleted roster pages and a Class Performance tab
   whose lookup silently never matched: mock rows keyed on `'mat-sci-1'`
   read against real UUIDs, so only the empty state ever rendered.

   WHAT REMAINS IS REAL. `SUBJECTS` mirrors the nine rows seeded into
   public.subjects (the server re-validates the code on upload, so drift
   is a readable 400 rather than a crash), `ALL_GRADE_LEVELS` is the JHS
   range the `materials_grade_levels_valid` CHECK allows, and the rest are
   display formatters. Nothing here is a stand-in for data.

   The file is due a rename to something like `src/data/reference.ts`;
   that is nine mechanical import edits and deliberately not bundled with
   this change.
------------------------------------------------------------------- */

/** Mirrors the `parsed_status` enum in schema.sql, and `ParsedStatus` in server/types/database.ts. */
export type ParsedStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Subject {
  code: string;
  name: string;
  sort_order: number;
}

/** Every JHS grade level. A material is published to exactly ONE of them. */
export const ALL_GRADE_LEVELS = [7, 8, 9, 10];

/**
 * A row of public.materials as the educator API returns it.
 *
 * Named for the portal that consumes it. `server/types/database.ts` holds the
 * server-side mirror; the two must agree.
 */
export interface EducatorMaterial {
  id: string;
  educator_id: string;
  title: string;
  description: string | null;
  subject: string;
  /** SMALLINT[] holding exactly one grade — see the CHECK in schema.sql. */
  grade_levels: number[];
  storage_path: string;
  file_size_bytes: number | null;
  page_count: number | null;
  is_scanned: boolean;
  parsed_status: ParsedStatus;
  parse_error: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────
// Reference data
// ─────────────────────────────────────────────────────────────

/** The nine rows seeded into public.subjects. */
export const SUBJECTS: Subject[] = [
  { code: 'FIL', name: 'Filipino', sort_order: 1 },
  { code: 'ENG', name: 'English', sort_order: 2 },
  { code: 'MATH', name: 'Mathematics', sort_order: 3 },
  { code: 'SCI', name: 'Science', sort_order: 4 },
  { code: 'AP', name: 'Araling Panlipunan', sort_order: 5 },
  { code: 'ESP', name: 'Edukasyon sa Pagpapakatao', sort_order: 6 },
  { code: 'TLE', name: 'Technology and Livelihood Education', sort_order: 7 },
  { code: 'MAPEH', name: 'Music, Arts, Physical Education and Health', sort_order: 8 },
  { code: 'CL', name: 'Christian Living', sort_order: 9 },
];

export function subjectName(code: string): string {
  return SUBJECTS.find((s) => s.code === code)?.name ?? code;
}

// ─────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────

export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * "3d ago" for a real timestamp.
 *
 * 🐛 This measured against a FROZEN `NOW` of 2026-07-23, which was correct while
 * every caller passed a mock `created_at` and wrong the moment `MaterialsLibrary`
 * started passing real ones. A material uploaded after that date produced a
 * negative difference, fell through the `mins < 1` branch, and printed **"Just
 * now" forever regardless of age** — for every material in the library.
 *
 * `relativeTime()` in `src/lib/mastery.ts` is the coarser sibling (today /
 * yesterday / N days ago, returning null for a null input); this one keeps
 * minute-level resolution because an upload that finished parsing two minutes ago
 * is worth distinguishing from one that finished two hours ago.
 */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
