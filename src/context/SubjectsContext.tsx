import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

/**
 * The subject catalogue, fetched once per portal mount from public.subjects (never a hardcoded list).
 * Kept separate from AuthContext. Mounted inside RequireRole on the student and educator layouts only.
 */

/** A public.subjects row; mirrors SubjectRow on the server. */
export interface Subject {
  code: string;
  name: string;
  sort_order: number;
}

interface SubjectsValue {
  /** In sort_order; empty while loading or on failure. */
  subjects: Subject[];
  isLoading: boolean;
  /** Set when the catalogue failed to load. Pickers must show it and disable submit; no fallback list. */
  error: string | null;
}

const SubjectsContext = createContext<SubjectsValue>({
  subjects: [],
  isLoading: true,
  error: null,
});

export function SubjectsProvider({ children }: { children: React.ReactNode }) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .get<Subject[]>('/subjects')
      .then((res) => {
        if (!cancelled) setSubjects(res.data ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load the subject list.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({ subjects, isLoading, error }),
    [subjects, isLoading, error]
  );

  return <SubjectsContext.Provider value={value}>{children}</SubjectsContext.Provider>;
}

export function useSubjects(): SubjectsValue {
  return useContext(SubjectsContext);
}

/** code → display name, falling back to the code (before load, or for a code no longer listed). Stable callback. */
export function useSubjectName(): (code: string) => string {
  const { subjects } = useSubjects();

  return useCallback(
    (code: string) => subjects.find((s) => s.code === code)?.name ?? code,
    [subjects]
  );
}
