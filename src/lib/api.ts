import { supabase } from './supabase';

// Types

export interface ApiResponse<T = unknown> {
  data: T;
  message?: string;
  unread_count?: number;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
  /** Optional machine-readable reason for routes with several meaningful failures. */
  code?: string;
}

/** The thrown Error, with status and `code`. Branch on `code`, never on the message text. */
export interface ApiRequestError extends Error {
  status: number;
  code?: string;
}

// Core fetch wrapper

/**
 * Typed fetch for the Express API: prefixes /api, attaches the Supabase JWT, sets JSON content type
 * for non-FormData bodies, and throws ApiError on non-2xx.
 */
export async function apiFetch<T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  // Current session JWT
  const { data: { session } } = await supabase.auth.getSession();

  const headers: HeadersInit = {
    ...(options.headers ?? {}),
  };

  // JSON content type for non-FormData bodies
  if (!(options.body instanceof FormData)) {
    (headers as Record<string, string>)['Content-Type'] = 'application/json';
  }

  // Bearer token when signed in
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

// Convenience methods

export const api = {
  get: <T>(endpoint: string) =>
    apiFetch<T>(endpoint, { method: 'GET' }),

  post: <T>(endpoint: string, body: unknown) =>
    apiFetch<T>(endpoint, { method: 'POST', body: JSON.stringify(body) }),

  put: <T>(endpoint: string, body: unknown) =>
    apiFetch<T>(endpoint, { method: 'PUT', body: JSON.stringify(body) }),

  /** Partial update. */
  patch: <T>(endpoint: string, body: unknown) =>
    apiFetch<T>(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),

  delete: <T>(endpoint: string) =>
    apiFetch<T>(endpoint, { method: 'DELETE' }),

  /** File uploads: FormData without a Content-Type override. */
  upload: <T>(endpoint: string, formData: FormData) =>
    apiFetch<T>(endpoint, { method: 'POST', body: formData }),
};
