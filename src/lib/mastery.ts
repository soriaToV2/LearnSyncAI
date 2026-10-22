/**
 * BKT mastery on the client: types, tier presentation and the read calls.
 * An unassessed concept sits at P(L₀) = 0.10, an assumption, so never print it: check `assessed`,
 * `assessed_concept_count` or `concepts_assessed` before showing a percentage.
 */

import { api } from './api';
import type { Tone } from '../components/ui/surfaces';
import type { DifficultyTier } from './testMode';

/** Re-exported from testMode.ts; import it from here in new code. */
export type { DifficultyTier };

/** P(L₀). Must match bkt_parameters.p_l0, the server constant, the column default and document_mastery(). */
export const P_L0 = 0.1;

/**
 * Client mirror of masteryTier() (paper pp. 81/98); change all copies together. Takes 0–1.
 * Pass the displayed value (masteryPercent(m) / 100) so the colour matches the number shown.
 */
export function masteryTier(mastery: number): DifficultyTier {
  if (!Number.isFinite(mastery)) return 'foundational';
  if (mastery >= 0.85) return 'advanced';
  if (mastery >= 0.5) return 'intermediate';
  return 'foundational';
}

/** 0–1 → whole percentage; the only rounding the UI should do. */
export function masteryPercent(mastery: number): number {
  return Math.round(mastery * 100);
}

/** Tier colours. `foundational` is neutral, never `poor`: everyone starts there. */
export const TIER_TONE: Record<DifficultyTier, Tone> = {
  advanced: 'good',
  intermediate: 'mid',
  foundational: 'neutral',
};

export const TIER_LABEL: Record<DifficultyTier, string> = {
  advanced: 'Advanced',
  intermediate: 'Intermediate',
  foundational: 'Foundational',
};

/** EQ(4) for one study space. `overall` is null when nothing is assessed. */
export interface SpaceMastery {
  overall: number | null;
  tier: DifficultyTier;
  concepts_total: number;
  concepts_assessed: number;
  last_updated: string | null;
  by_material: {
    material_id: string;
    m_doc: number;
    tier: DifficultyTier;
    concept_count: number;
    assessed_concept_count: number;
  }[];
}

/** One concept's mastery; meaningless unless `assessed`. */
export interface ConceptMastery {
  concept_id: string;
  term: string;
  /** Exactly P(L₀) when `assessed` is false; don't display it then. */
  mastery: number;
  assessed: boolean;
  /** Flashcard ratings + test items; call these "attempts". */
  opportunity_count: number;
  last_updated: string | null;
  source_pages: number[] | null;
}

export interface MaterialMasteryDetail {
  material_id: string;
  /** Server-supplied; don't join against the materials list, which filters differently. */
  title: string;
  m_doc: number;
  tier: DifficultyTier;
  concept_count: number;
  assessed_concept_count: number;
  last_updated: string | null;
  /** Assessed first, weakest ascending; unassessed after, alphabetically. Server-sorted. */
  concepts: ConceptMastery[];
}

export interface SpaceMasteryDetail extends Omit<SpaceMastery, 'by_material'> {
  by_material: MaterialMasteryDetail[];
}

/** The caption under a mastery figure, shared by Test Mode and Analytics. */
export function masteryCaption(m: Pick<SpaceMastery, 'concepts_assessed' | 'concepts_total'>): string {
  return m.concepts_assessed === 0
    ? 'No concepts assessed yet — take a test or study a deck and mastery starts tracking.'
    : `Estimated from ${m.concepts_assessed} of ${m.concepts_total} concepts answered so far.`;
}

/** "2 days ago" / "just now"; coarse on purpose. */
export function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`;
  return `${Math.floor(days / 30)} month${days < 60 ? '' : 's'} ago`;
}

export interface MasteryApi {
  /** Summary only (Test Mode's hot path). */
  space(spaceId: string): Promise<SpaceMastery>;
  /** Summary plus every concept in the space, in one request. */
  detail(spaceId: string): Promise<SpaceMasteryDetail>;
}

export const masteryApi: MasteryApi = {
  async space(spaceId) {
    const res = await api.get<SpaceMastery>(`/practice/space/${spaceId}/mastery`);
    return res.data;
  },

  async detail(spaceId) {
    const res = await api.get<SpaceMasteryDetail>(`/practice/space/${spaceId}/mastery/concepts`);
    return res.data;
  },
};
