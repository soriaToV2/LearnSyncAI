/**
 * BKT mastery on the client — types, tier presentation, and the two read calls.
 *
 * Its own module rather than part of `testMode.ts` because mastery is fed by
 * Adaptive Flashcards AND Adaptive Test Mode (paper p. 58 permits exactly those
 * two writers), and read by Test Mode, the Analytics tab and eventually the
 * dashboard. Filing it under one of its two writers would have been arbitrary.
 *
 * THE ONE RULE EVERYTHING HERE EXISTS TO SUPPORT: a concept with no `bkt_mastery`
 * row sits at P(L₀) = 0.10, and that is an ASSUMPTION, not a measurement.
 * Rendering it as "10%" tells a student they know a tenth of something nobody has
 * asked them about. Every type below carries the flag or count that lets a caller
 * tell the two apart — `assessed` per concept, `assessed_concept_count` per
 * material, `concepts_assessed` per space. If you find yourself printing a
 * percentage without checking one of them, stop.
 */

import { api } from './api';
import type { Tone } from '../components/ui/surfaces';
import type { DifficultyTier } from './testMode';

/**
 * Re-exported rather than moved. It is `practice_tests.difficulty_tier`'s CHECK
 * as much as it is a mastery threshold, so it stays where Test Mode declares it —
 * but new code should import it from here, alongside everything else about
 * mastery.
 */
export type { DifficultyTier };

/**
 * P(L₀). Mirrors `bkt_parameters.p_l0`, `server/lib/testDifficulty.ts`, the
 * `bkt_mastery.latent_mastery` column default and `document_mastery()` in
 * schema.sql — all five must agree.
 */
export const P_L0 = 0.1;

/**
 * Client mirror of `masteryTier()` in `server/lib/testDifficulty.ts`, itself
 * identical to `mastery_tier()` in schema.sql. Thresholds are paper p. 81 / p. 98.
 * Change one, change all three.
 *
 * Takes 0–1, not 0–100.
 *
 * ⚠️ Feed this the value you are about to DISPLAY, not the raw one. A concept at
 * 0.849 renders as "85%" but tiers as `intermediate`, so the number and its
 * colour would contradict each other on screen. `masteryPercent(m) / 100` is the
 * argument you want. A material's tier comes from the server, computed on the
 * unrounded `m_doc`, so the two can only differ inside a razor-thin band between
 * a concept row and its parent lesson.
 */
export function masteryTier(mastery: number): DifficultyTier {
  if (!Number.isFinite(mastery)) return 'foundational';
  if (mastery >= 0.85) return 'advanced';
  if (mastery >= 0.5) return 'intermediate';
  return 'foundational';
}

/** 0–1 → a whole percentage. The only rounding the UI should do. */
export function masteryPercent(mastery: number): number {
  return Math.round(mastery * 100);
}

/**
 * Tier colours. `foundational` is NEUTRAL, never `poor`.
 *
 * The three tiers are where a student currently is, not how well they did.
 * Everyone starts foundational — it is the P(L₀) cold start, and by far the most
 * common state during a study — so painting it red would mark every new student
 * as failing at something they have not attempted. `scoreTone()` is deliberately
 * not reused: its 80/60 cut-offs describe a test score, and the thresholds that
 * mean anything for mastery are 0.50 and 0.85.
 */
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

/**
 * EQ(4) document mastery for one study space.
 *
 * `overall` is null when NOTHING has been assessed. Every unassessed concept
 * counts as the prior inside the mean, so a student who has done nothing still
 * averages 0.10 — the null is what stops that being printed as a score.
 */
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

/** One concept's mastery. `mastery` is meaningless unless `assessed` is true. */
export interface ConceptMastery {
  concept_id: string;
  term: string;
  /** Exactly P(L₀) when `assessed` is false. Do not display it in that case. */
  mastery: number;
  assessed: boolean;
  /** Flashcard ratings + test items combined. Call these "attempts", not "questions". */
  opportunity_count: number;
  last_updated: string | null;
  source_pages: number[] | null;
}

export interface MaterialMasteryDetail {
  material_id: string;
  /** Server-supplied — do not join against the materials list, which filters differently. */
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

/**
 * The one sentence printed under a mastery figure.
 *
 * Shared by Test Mode and Analytics so the same number cannot acquire two
 * phrasings and read as two different metrics.
 */
export function masteryCaption(m: Pick<SpaceMastery, 'concepts_assessed' | 'concepts_total'>): string {
  return m.concepts_assessed === 0
    ? 'No concepts assessed yet — take a test or study a deck and mastery starts tracking.'
    : `Estimated from ${m.concepts_assessed} of ${m.concepts_total} concepts answered so far.`;
}

/** "2 days ago" / "just now". Coarse on purpose — mastery moves in sessions, not seconds. */
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
  /** Summary only. Test Mode's hot path — deliberately carries no concepts. */
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
