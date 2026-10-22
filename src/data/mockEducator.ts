/*
 * Reference data and formatters shared by both portals. Despite the name, nothing here is mock data:
 * ALL_GRADE_LEVELS is the range materials_grade_levels_valid allows, and the rest are formatters.
 * Subjects come from SubjectsContext (GET /api/subjects); don't copy database rows into this file.
 */

/** Mirrors the `parsed_status` enum in schema.sql, and `ParsedStatus` in server/types/database.ts. */
export type ParsedStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** Every JHS grade level. A material is published to exactly ONE of them. */
export const ALL_GRADE_LEVELS = [7, 8, 9, 10];

/** A public.materials row as the educator API returns it. Must agree with server/types/database.ts. */
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

// Formatting helpers

export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * "3d ago" for a real timestamp, measured against Date.now(). Minute-level, unlike relativeTime() in
 * src/lib/mastery.ts, so a recent upload reads "2m ago" rather than "today".
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
