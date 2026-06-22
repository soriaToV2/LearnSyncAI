import { supabase } from './supabase';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  data: T;
  message?: string;
  unread_count?: number;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

// ─────────────────────────────────────────────
// Core Fetch Wrapper
// ─────────────────────────────────────────────

/**
 * Typed fetch wrapper for the LearnSyncAI Express API.
 *
 * Automatically:
 *  - Prepends the base path (all routes are under /api)
 *  - Attaches the current Supabase JWT as Authorization: Bearer <token>
 *  - Sets Content-Type: application/json for non-FormData requests
 *  - Throws a typed ApiError on non-2xx responses
 *
 * Usage:
 *   const { data } = await apiFetch<Course[]>('/courses');
 *   const { data } = await apiFetch<Course>('/courses', { method: 'POST', body: JSON.stringify(payload) });
 */
export async function apiFetch<T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  // Get the current session JWT from Supabase
  const { data: { session } } = await supabase.auth.getSession();

  const headers: HeadersInit = {
    ...(options.headers ?? {}),
  };

  // Add JSON content type for non-FormData bodies
  if (!(options.body instanceof FormData)) {
    (headers as Record<string, string>)['Content-Type'] = 'application/json';
  }

  // Attach Bearer token if user is logged in
  if (session?.access_token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${session.access_token}`;
  }

  const response = await fetch(`/api${endpoint}`, { ...options, headers });

  const json = await response.json();

  if (!response.ok) {
    const apiError = json as ApiError;
    throw new Error(apiError.message ?? apiError.error ?? 'An unknown API error occurred');
  }

  return json as ApiResponse<T>;
}

// ─────────────────────────────────────────────
// Convenience Methods
// ─────────────────────────────────────────────

export const api = {
  get: <T>(endpoint: string) =>
    apiFetch<T>(endpoint, { method: 'GET' }),

  post: <T>(endpoint: string, body: unknown) =>
    apiFetch<T>(endpoint, { method: 'POST', body: JSON.stringify(body) }),

  put: <T>(endpoint: string, body: unknown) =>
    apiFetch<T>(endpoint, { method: 'PUT', body: JSON.stringify(body) }),

  delete: <T>(endpoint: string) =>
    apiFetch<T>(endpoint, { method: 'DELETE' }),

  /** For file uploads — sends FormData without Content-Type override */
  upload: <T>(endpoint: string, formData: FormData) =>
    apiFetch<T>(endpoint, { method: 'POST', body: formData }),
};
