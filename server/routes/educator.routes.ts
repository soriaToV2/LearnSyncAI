/**
 * Educator analytics — the class-level mastery dashboard, read-only.
 *
 * Paper p. 61 gives the educator "a class-level analytics dashboard"; Sprint 3
 * (p. 90) is "aggregate student mastery data at the concept and document level
 * into a real-time grade-level monitoring interface"; p. 98 names "the class-level
 * mastery analytics dashboard" as a black-box test case. This file is that
 * interface, reached through Materials → a material → Class Performance.
 *
 * ⚠️ THIS FILE IS PERMANENTLY READ-ONLY. Mastery has exactly two writers, both in
 * `server/lib/bkt.ts` and both on the student side (paper p. 58). An educator
 * looking at a number must never move it. Nothing here imports `bkt.ts`.
 *
 * ── Why the numbers are computed here and not selected from the view ──────────
 *
 * `v_grade_level_mastery` (schema.sql) was built for exactly this screen and its
 * arithmetic is right. It is still not used, for three reasons:
 *
 *  1. It is `WITH (security_invoker = on)`, and Express talks to Postgres with the
 *     SERVICE ROLE, which bypasses Row-Level Security entirely. Selected from
 *     here it returns every educator's rows for every student, and `auth.uid()`
 *     inside `private.auth_assigned_grades()` is NULL. Its scoping is real only
 *     for a browser holding an anon key.
 *  2. Its `JOIN profiles` has no `p.status = 'active'` filter, so a disabled
 *     account still appears in it. `rosterFor()` fixes that.
 *  3. EQ(4) is required to exist in exactly one place, `documentMastery()`.
 *     Same refusal already recorded on the student mastery route.
 *
 * ── The three means on this screen are NOT the same computation ───────────────
 *
 * Only `students[].m_doc` is EQ(4) — a mean over CONCEPTS for one student, where
 * an unassessed concept correctly enters at P(L₀). That one goes through
 * `documentMastery()`.
 *
 * `class.m_doc` and `concepts[].avg_mastery` are means over STUDENTS, a different
 * axis, and must NOT. Filling an absent student with P(L₀) there would invent a
 * measurement for someone who never opened the lesson, and drag the class average
 * toward the prior in proportion to how many students have not started — which is
 * the one number an educator would most reasonably act on.
 *
 * ── Never print P(L₀) ────────────────────────────────────────────────────────
 *
 * A student with no `bkt_mastery` row is at 0.10 by assumption, not measurement.
 * Every figure below is `number | null`, null meaning "nothing measured", and
 * every count that would let a caller tell the two apart is shipped alongside it.
 * Gate on `assessed_concept_count` / `assessed_students`, never on `m_doc === 0.1`.
 */

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { requireOwnedMaterial, rosterFor, rosterStudent } from '../lib/educatorScope';
import {
  classKey,
  classMasteryRows,
  documentMastery,
  latestUpdate,
  masteryRows,
  masteryTier,
  P_L0,
} from '../lib/testDifficulty';
import type { DifficultyTier } from '../lib/testAllocation';

const router = Router();

router.use(authenticate, requireRole('educator'));

/** Mastery at or above this counts as mastered. `mastery_tier()`'s upper bound. */
const MASTERED = 0.85;
/** Below this a student is struggling with a concept. `mastery_tier()`'s lower bound. */
const STRUGGLING = 0.5;

/**
 * Same 4dp rounding `documentMastery()` applies, for the two means that are over
 * students rather than concepts and so cannot use it. Kept identical on purpose:
 * a class average and a student average rendering at different precisions on one
 * card reads as two metrics.
 */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Mean of values already in hand, or null when there are none to average. */
function meanOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  return round4(values.reduce((sum, v) => sum + v, 0) / values.length);
}

interface ConceptRow {
  id: string;
  term: string;
  source_pages: number[] | null;
}

/** Every concept in a material, in document order — the denominator for EQ(4). */
async function conceptsFor(materialId: string): Promise<ConceptRow[]> {
  const { data } = await supabaseAdmin
    .from('concepts')
    .select('id, term, source_pages')
    .eq('material_id', materialId)
    .order('created_at');

  return (data ?? []).map((row) => ({
    id: row.id as string,
    term: row.term as string,
    source_pages: (row.source_pages as number[] | null) ?? null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/educator/materials/:materialId/performance
// ─────────────────────────────────────────────────────────────────────────────

interface StudentPerformanceDto {
  student_id: string;
  first_name: string;
  last_name: string;
  grade_level: number;
  /** EQ(4) over this material's concepts. **null when nothing is assessed.** */
  m_doc: number | null;
  tier: DifficultyTier;
  assessed_concept_count: number;
  /** Assessed and >= 0.85. */
  mastered_concept_count: number;
  last_updated: string | null;
}

interface ConceptPerformanceDto {
  concept_id: string;
  term: string;
  source_pages: number[] | null;
  assessed_students: number;
  /** Mean over ASSESSED students only. **null when none have been assessed.** */
  avg_mastery: number | null;
  mastered_students: number;
  /** Assessed and < 0.50 — the re-teach signal. */
  struggling_students: number;
}

/**
 * How a material's class is doing, at the document and the concept level.
 *
 * "The class" is every ACTIVE student in a grade this material is published to —
 * the paper's grade-level monitoring interface, and the same population
 * `v_grade_level_mastery` defines. A student who has never opened it is included
 * and reported as not started, because "nineteen of twenty have not touched this"
 * is precisely what an educator needs to see and a filtered list would hide.
 *
 * Four round trips regardless of class or lesson size: material → (concepts ‖
 * roster) → `bkt_mastery`.
 */
router.get(
  '/materials/:materialId/performance',
  async (req: Request, res: Response): Promise<void> => {
    const material = await requireOwnedMaterial(req.params.materialId, req, res);
    if (!material) return;

    const [concepts, roster] = await Promise.all([
      conceptsFor(material.id),
      rosterFor(material),
    ]);

    const conceptIds = concepts.map((c) => c.id);
    const rows = await classMasteryRows(
      roster.map((s) => s.id),
      conceptIds
    );

    // ── Per student: EQ(4) over this material's concepts ──────────────────
    const students: StudentPerformanceDto[] = roster.map((student) => {
      const byConcept = new Map<string, number>();
      let mastered = 0;
      let lastUpdated: string | null = null;

      for (const conceptId of conceptIds) {
        const row = rows.get(classKey(student.id, conceptId));
        if (!row) continue;
        byConcept.set(conceptId, row.mastery);
        if (row.mastery >= MASTERED) mastered += 1;
        if (row.lastUpdated && (lastUpdated === null || row.lastUpdated > lastUpdated)) {
          lastUpdated = row.lastUpdated;
        }
      }

      const mDoc = documentMastery(conceptIds, byConcept);

      return {
        student_id: student.id,
        first_name: student.firstName,
        last_name: student.lastName,
        grade_level: student.gradeLevel,
        // null, not the 0.10 `documentMastery()` returns for an untouched lesson.
        m_doc: byConcept.size === 0 ? null : mDoc,
        tier: masteryTier(mDoc),
        assessed_concept_count: byConcept.size,
        mastered_concept_count: mastered,
        last_updated: lastUpdated,
      };
    });

    /*
     * Weakest-first, which is the whole point of the list — but ONLY among
     * students who have started. Partition before sorting rather than sorting a
     * mixed array: a null `m_doc` in a numeric comparator yields NaN, and a
     * comparator returning NaN silently produces an arbitrary order.
     *
     * Not-started students keep `rosterFor()`'s name order and sit at the bottom.
     * They have no position on a scale nobody has measured them on, and ranking
     * them at 0.10 would put every student who has done nothing ABOVE every
     * student who is measurably struggling — the transition step floors every
     * assessed posterior at P(T) = 0.20.
     */
    const started = students.filter((s) => s.m_doc !== null);
    const notStarted = students.filter((s) => s.m_doc === null);
    started.sort((a, b) => (a.m_doc as number) - (b.m_doc as number));

    // ── Per concept: mean across the students who have been assessed on it ──
    const conceptDtos: ConceptPerformanceDto[] = concepts.map((concept) => {
      const values: number[] = [];
      let mastered = 0;
      let struggling = 0;

      for (const student of roster) {
        const row = rows.get(classKey(student.id, concept.id));
        if (!row) continue;
        values.push(row.mastery);
        if (row.mastery >= MASTERED) mastered += 1;
        else if (row.mastery < STRUGGLING) struggling += 1;
      }

      return {
        concept_id: concept.id,
        term: concept.term,
        source_pages: concept.source_pages,
        assessed_students: values.length,
        avg_mastery: meanOrNull(values),
        mastered_students: mastered,
        struggling_students: struggling,
      };
    });

    // Same partition-then-sort rule, same reason.
    const assessedConcepts = conceptDtos.filter((c) => c.avg_mastery !== null);
    const untouchedConcepts = conceptDtos.filter((c) => c.avg_mastery === null);
    assessedConcepts.sort((a, b) => (a.avg_mastery as number) - (b.avg_mastery as number));
    untouchedConcepts.sort((a, b) => a.term.localeCompare(b.term));

    const classMean = meanOrNull(started.map((s) => s.m_doc as number));

    const byTier: Record<DifficultyTier, number> = {
      foundational: 0,
      intermediate: 0,
      advanced: 0,
    };
    // Started students only — an untouched student is not "foundational", they
    // are unmeasured, and counting them would make the distribution a headcount
    // of who has logged in.
    for (const s of started) byTier[s.tier] += 1;

    res.json({
      data: {
        material: {
          id: material.id,
          title: material.title,
          subject: material.subject,
          grade_levels: material.gradeLevels,
          concept_count: concepts.length,
          is_archived: material.isArchived,
          parsed_status: material.parsedStatus,
        },
        class: {
          size: roster.length,
          started: started.length,
          m_doc: classMean,
          tier: masteryTier(classMean ?? P_L0),
          by_tier: byTier,
        },
        students: [...started, ...notStarted],
        concepts: [...assessedConcepts, ...untouchedConcepts],
      },
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/educator/materials/:materialId/students/:studentId/concepts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One student's concept-by-concept mastery for one material — the drill-down
 * behind an expanded row in Class Performance.
 *
 * A SEPARATE ROUTE rather than fields on the summary above, purely on size: fifty
 * students against a fifty-seven-concept lesson is ~256 KB of concept vectors on
 * every page load, against ~5 KB when the educator actually expands someone. The
 * class dimension is what makes this different from
 * `GET /api/practice/space/:spaceId/mastery/concepts`, which ships everything in
 * one request because there is only ever one student in it.
 *
 * ⚠️ `:studentId` is the only user id an educator can put in a URL anywhere in
 * this application. `rosterStudent()` re-derives role, status AND grade
 * membership rather than trusting any of them — an educator holding an id from a
 * grade they do not publish to, or a disabled account, gets a 404.
 *
 * The concept shape is deliberately identical to the student-side
 * `ConceptMastery` so one concept is described one way on both portals.
 */
router.get(
  '/materials/:materialId/students/:studentId/concepts',
  async (req: Request, res: Response): Promise<void> => {
    const material = await requireOwnedMaterial(req.params.materialId, req, res);
    if (!material) return;

    const student = await rosterStudent(material, req.params.studentId);
    if (!student) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }

    const concepts = await conceptsFor(material.id);
    const conceptIds = concepts.map((c) => c.id);
    const rows = await masteryRows(student.id, conceptIds);

    const byConcept = new Map<string, number>();
    for (const [conceptId, row] of rows) byConcept.set(conceptId, row.mastery);

    const mDoc = documentMastery(conceptIds, byConcept);

    const detail = concepts.map((c) => {
      const row = rows.get(c.id);
      return {
        concept_id: c.id,
        term: c.term,
        // Exactly P(L₀) when `assessed` is false. The client must not display it.
        mastery: row ? row.mastery : P_L0,
        assessed: row !== undefined,
        opportunity_count: row?.opportunityCount ?? 0,
        last_updated: row?.lastUpdated ?? null,
        source_pages: c.source_pages,
      };
    });

    // Weakest assessed first, unassessed last alphabetically — the same ordering
    // the student's own Analytics tab uses, so the two lists read alike.
    detail.sort((a, b) => {
      if (a.assessed !== b.assessed) return a.assessed ? -1 : 1;
      if (a.assessed && a.mastery !== b.mastery) return a.mastery - b.mastery;
      return a.term.localeCompare(b.term);
    });

    res.json({
      data: {
        student: {
          student_id: student.id,
          first_name: student.firstName,
          last_name: student.lastName,
          grade_level: student.gradeLevel,
        },
        m_doc: byConcept.size === 0 ? null : mDoc,
        tier: masteryTier(mDoc),
        concept_count: conceptIds.length,
        assessed_concept_count: byConcept.size,
        mastered_concept_count: [...byConcept.values()].filter((m) => m >= MASTERED).length,
        last_updated: latestUpdate(rows),
        concepts: detail,
      },
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/educator/materials/:materialId/concepts/:conceptId/students
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Who stands where on ONE concept — the drill-down behind an expanded row in the
 * By concept view.
 *
 * This is the TRANSPOSE of the route above, and the pair is the point. The two
 * summaries are the rows and the column totals of one (student × concept)
 * matrix: "By student" expands to a row, "By concept" expands to a column. Before
 * this route the column was the one thing the screen collected the data for and
 * could not show — "3 struggling" with no way to learn which three except
 * expanding every student in turn and reading down.
 *
 * Cheap for the same reason its sibling is: one concept over a class is ~50 rows,
 * against the ~256 KB the full matrix would cost inline at study scale.
 *
 * ⚠️ The concept must belong to THIS material. `requireOwnedMaterial()` only
 * proves the caller owns the material in the path — it says nothing about a
 * concept id pasted in beside it, which could name a row in another educator's
 * lesson. Mismatch is a 404, never a 403.
 *
 * Every student in the class appears, including those never assessed on this
 * concept. "Nobody has been asked about this yet" is a finding about the lesson,
 * and it is invisible if the list only shows students who have data.
 */
router.get(
  '/materials/:materialId/concepts/:conceptId/students',
  async (req: Request, res: Response): Promise<void> => {
    const material = await requireOwnedMaterial(req.params.materialId, req, res);
    if (!material) return;

    const { data: concept } = await supabaseAdmin
      .from('concepts')
      .select('id, term, definition, source_pages, material_id')
      .eq('id', req.params.conceptId)
      .maybeSingle();

    if (!concept || concept.material_id !== material.id) {
      res.status(404).json({ error: 'Concept not found' });
      return;
    }

    const roster = await rosterFor(material);
    const rows = await classMasteryRows(roster.map((s) => s.id), [concept.id as string]);

    const students = roster.map((s) => {
      const row = rows.get(classKey(s.id, concept.id as string));
      return {
        student_id: s.id,
        first_name: s.firstName,
        last_name: s.lastName,
        grade_level: s.gradeLevel,
        // Exactly P(L₀) when `assessed` is false. The client must not display it.
        mastery: row ? row.mastery : P_L0,
        assessed: row !== undefined,
        opportunity_count: row?.opportunityCount ?? 0,
        last_updated: row?.lastUpdated ?? null,
      };
    });

    // Weakest assessed first — the same partition-then-sort rule as everywhere
    // else here, because an unassessed student has no position on this scale.
    const assessed = students.filter((s) => s.assessed);
    const untouched = students.filter((s) => !s.assessed);
    assessed.sort((a, b) => a.mastery - b.mastery);

    const values = assessed.map((s) => s.mastery);

    res.json({
      data: {
        concept: {
          concept_id: concept.id as string,
          term: concept.term as string,
          definition: concept.definition as string,
          source_pages: (concept.source_pages as number[] | null) ?? null,
        },
        class_size: roster.length,
        assessed_students: assessed.length,
        avg_mastery: meanOrNull(values),
        mastered_students: values.filter((m) => m >= MASTERED).length,
        struggling_students: values.filter((m) => m < STRUGGLING).length,
        students: [...assessed, ...untouched],
      },
    });
  }
);

export default router;
