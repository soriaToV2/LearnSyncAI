import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

/**
 * The subject catalogue, fetched once per portal mount.
 *
 * ══ WHY IT IS A FETCH AND NOT A CONSTANT ══
 * Until this existed, every subject dropdown mapped over `SUBJECTS` in
 * `src/data/mockEducator.ts` — a hand-kept copy of the rows `schema.sql` seeds.
 * Deleting Christian Living from `public.subjects` therefore changed nothing on
 * screen, and both portals went on offering a subject the server would refuse.
 * The table is the source of truth now: edit it in Supabase and the pickers
 * follow on the next page load, with no code change and no redeploy.
 *
 * ══ DELIBERATELY THIN, LIKE `AuthContext` ══
 * One small request on mount. No cache, no background revalidation, no
 * `localStorage`. `api.ts` re-reads the Supabase session for the JWT on every
 * call, so there is nothing to keep in sync here either.
 *
 * ⚠️ NOT FOLDED INTO `AuthContext`. That file states the rule it would break: a
 * context that accumulates "things several screens happen to need" becomes a
 * second, invisible data layer with its own staleness rules. Identity and
 * reference data have different lifetimes and different failure meanings — a
 * failed profile fetch means "who are you?", a failed catalogue fetch means "you
 * cannot file this yet".
 *
 * ⚠️ MOUNTED ON `StudentLayout` AND `EducatorLayout` ONLY, INSIDE `RequireRole`.
 * Not `AdminLayout` — the admin portal renders no subject anywhere, and the
 * admin role is not in the route's `requireRole` list. Inside `RequireRole` for
 * the same reason `BadgeProvider` is: the request must never fire for a
 * signed-out, un-activated or wrong-role visitor, who would collect a 401/403
 * for nothing.
 */

/** A row of `public.subjects`. Mirrors `SubjectRow` in `server/routes/subjects.routes.ts`. */
export interface Subject {
  code: string;
  name: string;
  sort_order: number;
}

interface SubjectsValue {
  /** In `sort_order`, as the server returns them. Empty while loading or on failure. */
  subjects: Subject[];
  isLoading: boolean;
  /**
   * Non-null when the catalogue could not be read.
   *
   * ⚠️ A PICKER MUST SURFACE THIS AND DISABLE SUBMIT rather than rendering an
   * empty dropdown. An empty picker looks like a form the user is failing to
   * fill in; the truth is that the app could not load its options. There is
   * deliberately no fallback to a hardcoded list — that is precisely the drift
   * this context removes, and the server 400s an unknown code regardless.
   */
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

/**
 * `code` → the subject's display name, falling back to the code itself.
 *
 * ⚠️ THE FALLBACK IS LOAD-BEARING and is inherited from the `subjectName()` this
 * replaced. It covers two real cases: the window before the fetch resolves, and
 * a code the catalogue no longer contains. The second cannot happen through
 * ordinary use — both `materials.subject` and `study_spaces.subject` are
 * `ON DELETE RESTRICT`, so Postgres refuses to delete a subject anything still
 * references — but a label that degrades to `CL` is readable, where a blank
 * looks like missing data and a throw takes the page down.
 *
 * Returned as a stable callback so consumers can list it in a dependency array.
 */
export function useSubjectName(): (code: string) => string {
  const { subjects } = useSubjects();

  return useCallback(
    (code: string) => subjects.find((s) => s.code === code)?.name ?? code,
    [subjects]
  );
}
