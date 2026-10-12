/**
 * The study space's tab vocabulary, and the "open this tab on this thing" intent
 * that a recommendation travels as.
 *
 * ⚠️ ITS OWN MODULE RATHER THAN AN EXPORT FROM `StudySpace.tsx`. Both
 * `ResourcesTab` and `recommend.ts` need `StudyTab`, and a child importing a type
 * from the parent that renders it is backwards — the same shape `reviewSchedule.ts`
 * and `surfaces.ts` were lifted out to end. It would also drag the whole page's
 * import graph into every consumer.
 *
 * ⚠️ A `StudyIntent` IS CONSUMED ONCE, NEVER HELD. `StudySpace` renders
 * `<main key={activeTab}>`, so every tab remounts on entry; a preselection kept
 * as ordinary state would be re-applied every time the student came back to the
 * tab, silently replacing a lesson or concept they had picked by hand. The owner
 * clears it as soon as a tab reports it applied.
 */

/**
 * The six tabs of a study space.
 *
 * The string is the identity: it keys `TAB_INTRO` in `StudySpace.tsx` (and so the
 * walkthrough that runs on entry) and appears in `?tab=` on a shared link.
 */
export type StudyTab =
  | 'resources'
  | 'flashcards'
  | 'free-recall'
  | 'feynman'
  | 'adaptive-test'
  | 'analytics';

/**
 * ⚠️ THE ONE LIST. `StudySpace.tsx` renders six hand-written desktop buttons for
 * layout reasons and a mapped mobile menu; both must agree with this, and
 * `isStudyTab()` below is what stops a URL inventing a seventh.
 */
export const STUDY_TABS: readonly StudyTab[] = [
  'resources',
  'flashcards',
  'free-recall',
  'feynman',
  'adaptive-test',
  'analytics',
];

/** The tab a space opens on when nothing says otherwise. Matches `StudySpace.tsx`. */
export const DEFAULT_STUDY_TAB: StudyTab = 'resources';

export function isStudyTab(value: string | null | undefined): value is StudyTab {
  return value !== null && value !== undefined && (STUDY_TABS as readonly string[]).includes(value);
}

/**
 * Where a recommendation points.
 *
 * `materialId` and `conceptIds` are HINTS, never guarantees. The receiving tab
 * validates each one against the list it has already fetched and silently drops
 * anything it cannot resolve — an educator can archive a material or re-upload
 * one (which cascade-deletes its concepts) between the link being made and
 * followed.
 */
export interface StudyIntent {
  tab: StudyTab;
  /** A material in this space, or null. */
  materialId: string | null;
  /**
   * Concepts in that material. Empty when the intent is lesson-wide.
   *
   * ⚠️ A LIST BECAUSE THE TEST RESULTS SCREEN HANDS OVER EVERY CONCEPT THE
   * STUDENT MISSED — up to the whole lesson. Feynman is the only tool that can
   * use them (`explanations[].concept_id`); everything else opens on the lesson
   * and ignores them.
   */
  conceptIds: string[];
}

/**
 * Read `?tab=&material=&concept=` off a URL.
 *
 * `tab` is required and must be one of the six — a bookmark naming a tab that no
 * longer exists returns null and the space opens normally. The other two are
 * modifiers and mean nothing on their own, which is why they are not read
 * without it.
 */
export function readStudyIntent(params: URLSearchParams): StudyIntent | null {
  const tab = params.get('tab');
  if (!isStudyTab(tab)) return null;
  return {
    tab,
    materialId: params.get('material') || null,
    // ⚠️ `getAll`, paired with the `append` in `studySpaceLink()` below.
    // `params.get()` returns only the FIRST value, so mismatching the two
    // silently drops every concept but one.
    conceptIds: params.getAll('concept').filter(Boolean),
  };
}

/**
 * A link to another route's study space.
 *
 * ⚠️ CROSS-ROUTE ONLY — the dashboard, or anywhere outside the space. From
 * INSIDE the space (an Analytics row, a test results card) a `<Link>` carrying
 * these params is a same-route navigation: `location.search` changes,
 * `StudySpace` never unmounts, and its tab was seeded once at mount, so the URL
 * changes and NOTHING HAPPENS. Use the `onNavigate` callback there instead. That
 * failure reviews as correct and is dead at runtime, which is why it is written
 * on both ends.
 */
export function studySpaceLink(
  spaceId: string,
  intent: Partial<StudyIntent> & { tab: StudyTab }
): string {
  const params = new URLSearchParams({ tab: intent.tab });
  if (intent.materialId) params.set('material', intent.materialId);
  // ⚠️ TEST THE LENGTH, NOT THE ARRAY — `[]` is truthy, so a truthiness check
  // would append a bare `?concept=` to every link ever built here.
  for (const id of intent.conceptIds ?? []) params.append('concept', id);
  return `/student/space/${spaceId}?${params.toString()}`;
}
