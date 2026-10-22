/**
 * Study space tab vocabulary and the "open this tab on this thing" intent. A separate module so tabs
 * don't import from their parent. A StudyIntent is consumed once, never held: tabs remount on entry.
 */

/** The six tabs. The string is the identity (TAB_INTRO key and `?tab=` value). */
export type StudyTab =
  | 'resources'
  | 'flashcards'
  | 'free-recall'
  | 'feynman'
  | 'adaptive-test'
  | 'analytics';

/** The one tab list; StudySpace.tsx's buttons must agree with it, and isStudyTab() validates URLs. */
export const STUDY_TABS: readonly StudyTab[] = [
  'resources',
  'flashcards',
  'free-recall',
  'feynman',
  'adaptive-test',
  'analytics',
];

/** Default tab (matches StudySpace.tsx). */
export const DEFAULT_STUDY_TAB: StudyTab = 'resources';

export function isStudyTab(value: string | null | undefined): value is StudyTab {
  return value !== null && value !== undefined && (STUDY_TABS as readonly string[]).includes(value);
}

/** Where a recommendation points. Ids are hints: the tab validates them and drops what it can't resolve. */
export interface StudyIntent {
  tab: StudyTab;
  /** A material in this space, or null. */
  materialId: string | null;
  /** Concepts in that material; empty when lesson-wide. Only Feynman uses them. */
  conceptIds: string[];
}

/** Reads `?tab=&material=&concept=`. `tab` is required; an unknown tab returns null. */
export function readStudyIntent(params: URLSearchParams): StudyIntent | null {
  const tab = params.get('tab');
  if (!isStudyTab(tab)) return null;
  return {
    tab,
    materialId: params.get('material') || null,
    // getAll, matching append in studySpaceLink(); get() would drop all but the first.
    conceptIds: params.getAll('concept').filter(Boolean),
  };
}

/**
 * A link into a study space, for use from other routes only. Inside the space use the onNavigate
 * callback: a same-route <Link> changes the URL but StudySpace doesn't react.
 */
export function studySpaceLink(
  spaceId: string,
  intent: Partial<StudyIntent> & { tab: StudyTab }
): string {
  const params = new URLSearchParams({ tab: intent.tab });
  if (intent.materialId) params.set('material', intent.materialId);
  // Test the length: `[]` is truthy.
  for (const id of intent.conceptIds ?? []) params.append('concept', id);
  return `/student/space/${spaceId}?${params.toString()}`;
}
