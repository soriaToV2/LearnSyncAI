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
  /**
   * A stable machine-readable reason, set by the few routes that have more than
   * one meaningful failure. Optional by design: `message` remains the thing
   * every caller renders, and no caller is required to know a code exists.
   */
  code?: string;
}

/**
 * The `Error` this module throws, with the response's status and `code` attached.
 *
 * ⚠️ THIS EXISTS SO CALLERS BRANCH ON A CODE INSTEAD OF MATCHING THE MESSAGE
 * STRING. `POST /auth/login` is the first route with two distinct failures worth
 * telling apart — a wrong password and a deactivated account — and the message
 * for each is user-facing copy that will be reworded. Anything keyed to that
 * wording breaks silently the first time someone improves a sentence.
 *
 * Purely additive: it is still an `Error`, `message` is unchanged, and every
 * existing call site that reads `err.message` keeps working untouched.
 */
export interface ApiRequestError extends Error {
  status: number;
  code?: string;
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
    const err = new Error(
      apiError.message ?? apiError.error ?? 'An unknown API error occurred'
    ) as ApiRequestError;
    err.status = response.status;
    err.code = apiError.code;
    throw err;
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

  /** Partial update — send only the fields being changed. */
  patch: <T>(endpoint: string, body: unknown) =>
    apiFetch<T>(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),

  delete: <T>(endpoint: string) =>
    apiFetch<T>(endpoint, { method: 'DELETE' }),

  /** For file uploads — sends FormData without Content-Type override */
  upload: <T>(endpoint: string, formData: FormData) =>
    apiFetch<T>(endpoint, { method: 'POST', body: formData }),
};
