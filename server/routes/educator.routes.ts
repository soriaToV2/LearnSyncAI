/**
 * Educator analytics — the class-level mastery dashboard, read-only.
 *
 * Paper p. 61 gives the educator "a class-level analytics dashboard"; Sprint 3
 * (p. 90) is "aggregate student mastery data at the concept and document level
 * into a real-time grade-level monitoring interface"; p. 98 names "the class-level
 * mastery analytics dashboard" as a black-box test case. This file is that
 * interface, in two shapes: `GET /overview` is the portal's landing page, across
 * every material the educator has published, and the `/materials/:materialId/*`
 * routes are the per-material drill-down reached through Materials → a material →
 * Class Performance.
 *
 * The two are the same arithmetic at different scopes and MUST agree — see the
 * consistency invariant on `GET /overview`.
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
import {
  requireOwnedMaterial,
  rosterFor,
  rosterForGrades,
  rosterStudent,
  type RosterStudent,
} from '../lib/educatorScope';
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

/** Supabase serialises `.in()` into the query string; same bound as testDifficulty.ts. */
const IN_CHUNK = 200;

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

/**
 * The same, across MANY materials, carrying `material_id` so the caller can group.
 *
 * Chunked because `.in()` goes into the query string — see `IN_CHUNK`. An educator
 * with a large library is one list of material ids, not one query per material.
 */
async function conceptsForMaterials(
  materialIds: string[]
): Promise<(ConceptRow & { material_id: string })[]> {
  const out: (ConceptRow & { material_id: string })[] = [];
  if (materialIds.length === 0) return out;

  for (let i = 0; i < materialIds.length; i += IN_CHUNK) {
    const { data } = await supabaseAdmin
      .from('concepts')
      .select('id, term, source_pages, material_id')
      .in('material_id', materialIds.slice(i, i + IN_CHUNK))
      .order('created_at');

    for (const row of data ?? []) {
      out.push({
        id: row.id as string,
        term: row.term as string,
        source_pages: (row.source_pages as number[] | null) ?? null,
        material_id: row.material_id as string,
      });
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/educator/overview — the educator dashboard
// ─────────────────────────────────────────────────────────────────────────────

/** Newest uploads on the dashboard's side column. */
const RECENT_UPLOADS = 5;

/** Weakest concepts shipped across the whole library. See `overview.concepts`. */
const WEAKEST_CONCEPTS = 20;

/**
 * Why a material is on the "needs a look" strip. One reason per material, in the
 * priority below — a failed parse also has no concepts, and reporting both would
 * describe one problem twice.
 */
type AttentionReason =
  | 'parse_failed'
  | 'parse_pending'
  | 'no_concepts'
  | 'no_students'
  | 'nobody_started';

interface AttentionDto {
  material_id: string;
  title: string;
  reason: AttentionReason;
  grade_levels: number[];
  /** Only ever set on `parse_failed`. */
  parse_error: string | null;
  /** Only meaningful on `nobody_started`. */
  class_size: number;
}

interface MaterialOverviewDto {
  material_id: string;
  title: string;
  subject: string;
  grade_levels: number[];
  parsed_status: string;
  concept_count: number;
  /** Active students in this material's grades. */
  class_size: number;
  /** Of those, how many have at least one assessed concept in it. */
  started: number;
  /** Mean over STARTED students. **null when none have started.** */
  m_doc: number | null;
  tier: DifficultyTier;
  /** Assessed concepts whose class average is below 0.50 — the re-teach count. */
  struggling_concepts: number;
  last_updated: string | null;
  created_at: string;
}

interface StudentMaterialSliceDto {
  material_id: string;
  /** EQ(4) over this material's concepts, for this student. */
  m_doc: number;
  assessed_concept_count: number;
  concept_count: number;
}

interface StudentOverviewDto {
  student_id: string;
  first_name: string;
  last_name: string;
  grade_level: number;
  /** EQ(4) over every concept of YOUR materials visible to them. **null = not started.** */
  m_doc: number | null;
  tier: DifficultyTier;
  concept_count: number;
  assessed_concept_count: number;
  mastered_concept_count: number;
  last_updated: string | null;
  /** Only materials this student has started. Empty for a student who has not. */
  by_material: StudentMaterialSliceDto[];
}

interface ConceptOverviewDto {
  concept_id: string;
  term: string;
  material_id: string;
  material_title: string;
  source_pages: number[] | null;
  assessed_students: number;
  /** Mean over ASSESSED students only — never EQ(4). */
  avg_mastery: number;
  mastered_students: number;
  struggling_students: number;
}

interface GradeOverviewDto {
  grade_level: number;
  material_count: number;
  size: number;
  started: number;
  m_doc: number | null;
  tier: DifficultyTier;
}

/** The zero-shaped payload, so the client renders empty states rather than branching on null. */
function emptyOverview(
  educator: { first_name: string; last_name: string },
  archived: number
) {
  return {
    educator,
    counts: {
      materials_live: 0,
      materials_archived: archived,
      materials_unready: 0,
      concepts_total: 0,
      concepts_assessed: 0,
      grades: [] as number[],
    },
    class: {
      size: 0,
      started: 0,
      m_doc: null as number | null,
      tier: 'foundational' as DifficultyTier,
      by_tier: { foundational: 0, intermediate: 0, advanced: 0 } as Record<DifficultyTier, number>,
    },
    attention: [] as AttentionDto[],
    materials: [] as MaterialOverviewDto[],
    students: [] as StudentOverviewDto[],
    concepts: [] as ConceptOverviewDto[],
    grades: [] as GradeOverviewDto[],
    recent_uploads: [] as unknown[],
  };
}

/**
 * Everything the educator dashboard renders, in one request.
 *
 * ══ IT ACCEPTS NOTHING ══
 * No body, no query string, no path parameter. Every set below is derived from
 * `req.user!.id`, so the route has NO IDOR SURFACE AT ALL — it cannot be pointed at
 * another educator's material, another grade's roster or another student's mastery,
 * because there is nothing to point with. That is the same guarantee
 * `GET /api/dashboard` gives on the student side and the same reason there is no Zod
 * schema here: there is no input to validate. If a parameter is ever added,
 * `safeParse(req.query)` it.
 *
 * ══ READ-ONLY, PERMANENTLY ══
 * Educators read mastery and never write it (paper p. 58). Nothing in this file
 * imports `server/lib/bkt.ts`; `bkt_source` stays a two-value enum.
 *
 * ══ FOUR ROUND TRIPS, WHATEVER THE LIBRARY SIZE ══
 * materials → concepts (chunked) ‖ roster (ONE query over the union of grades) →
 * `classMasteryRows()` (chunks both id lists). `rosterFor()` is deliberately NOT
 * called per material — that is one query each for a result the union already
 * contains, so the per-material class is partitioned in memory instead.
 *
 * ══ LIVE MATERIALS ONLY ══
 * Archived materials are excluded from every figure and surface only as a count.
 * An archived lesson is deliberately out of students' hands, so averaging it into
 * "how are my classes doing" would be wrong — and their concepts must be excluded
 * from the mastery intersection too, because `bkt_mastery` rows SURVIVE archiving
 * and counting them would quietly inflate every denominator here. Class Performance
 * stays archive-blind, which is not a contradiction: an archived material simply is
 * not on this page.
 *
 * ══ ⚠️ FIVE FIGURES, TWO COMPUTATIONS — ONLY ONE IS EQ(4) ══
 * Over CONCEPTS, via `documentMastery()`, where an unassessed concept correctly
 * enters at P(L₀):
 *   • `students[].m_doc`               — one student, the union of concepts they can see
 *   • `students[].by_material[].m_doc` — one student, one material
 * Over STUDENTS, via `meanOrNull()`, where an absent student must NOT be filled with
 * the prior — that would invent a measurement for someone who never opened the lesson:
 *   • `materials[].m_doc`  • `concepts[].avg_mastery`  • `class.m_doc`  • `grades[].m_doc`
 *
 * ══ THE CONSISTENCY INVARIANT ══
 * `materials[].m_doc` here is the SAME EXPRESSION over the SAME POPULATION as
 * `class.m_doc` on that material's Class Performance tab — mean over started students
 * of their EQ(4) for it. The two screens therefore show ONE NUMBER, not two
 * computations that happen to agree. If they ever differ, the roster or the
 * started-filter has drifted.
 */
router.get('/overview', async (req: Request, res: Response): Promise<void> => {
  const educatorId = req.user!.id;

  try {
    // ── 1. Identity + materials ─────────────────────────────────────────────
    const [{ data: profile }, { data: materialRows }] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', educatorId)
        .maybeSingle(),
      supabaseAdmin
        .from('materials')
        .select('id, title, subject, grade_levels, parsed_status, parse_error, is_archived, created_at')
        .eq('educator_id', educatorId)
        .order('created_at', { ascending: false }),
    ]);

    const educator = {
      first_name: (profile?.first_name as string) ?? '',
      last_name: (profile?.last_name as string) ?? '',
    };

    const all = materialRows ?? [];
    const live = all
      .filter((m) => !m.is_archived)
      .map((m) => ({
        id: m.id as string,
        title: m.title as string,
        subject: m.subject as string,
        gradeLevels: (m.grade_levels as number[]) ?? [],
        parsedStatus: (m.parsed_status as string) ?? 'pending',
        parseError: (m.parse_error as string) ?? null,
        createdAt: m.created_at as string,
      }));

    const archived = all.length - live.length;

    if (live.length === 0) {
      res.json({ data: emptyOverview(educator, archived) });
      return;
    }

    // ── 2. Concepts ‖ roster ────────────────────────────────────────────────
    const grades = [...new Set(live.flatMap((m) => m.gradeLevels))].sort((a, b) => a - b);

    const [conceptRows, roster] = await Promise.all([
      conceptsForMaterials(live.map((m) => m.id)),
      rosterForGrades(grades),
    ]);

    const conceptsByMaterial = new Map<string, ConceptRow[]>();
    for (const m of live) conceptsByMaterial.set(m.id, []);
    for (const c of conceptRows) {
      conceptsByMaterial.get(c.material_id)?.push({
        id: c.id,
        term: c.term,
        source_pages: c.source_pages,
      });
    }

    const conceptIds = conceptRows.map((c) => c.id);

    // ── 3. Mastery ──────────────────────────────────────────────────────────
    const rows = await classMasteryRows(roster.map((s) => s.id), conceptIds);

    // Which students form the class for each material. The union roster
    // partitioned in memory — identical to N calls to `rosterFor()`, one query.
    const rosterByMaterial = new Map<string, RosterStudent[]>();
    for (const m of live) {
      rosterByMaterial.set(
        m.id,
        roster.filter((s) => m.gradeLevels.includes(s.gradeLevel))
      );
    }

    // ── 4. Per concept: mean across the students assessed on it ─────────────
    const titleOf = new Map(live.map((m) => [m.id, m.title]));
    const assessedConceptIds = new Set<string>();
    const conceptDtos: ConceptOverviewDto[] = [];
    /** Assessed concepts below 0.50, per material — the material row's re-teach count. */
    const strugglingByMaterial = new Map<string, number>();

    for (const c of conceptRows) {
      const values: number[] = [];
      let mastered = 0;
      let struggling = 0;

      for (const student of rosterByMaterial.get(c.material_id) ?? []) {
        const row = rows.get(classKey(student.id, c.id));
        if (!row) continue; // the load-bearing `assessed` gate
        values.push(row.mastery);
        if (row.mastery >= MASTERED) mastered += 1;
        else if (row.mastery < STRUGGLING) struggling += 1;
      }

      if (values.length === 0) continue; // never ship a concept nobody has been asked about

      assessedConceptIds.add(c.id);
      const avg = meanOrNull(values) as number;
      if (avg < STRUGGLING) {
        strugglingByMaterial.set(
          c.material_id,
          (strugglingByMaterial.get(c.material_id) ?? 0) + 1
        );
      }

      conceptDtos.push({
        concept_id: c.id,
        term: c.term,
        material_id: c.material_id,
        material_title: titleOf.get(c.material_id) ?? '',
        source_pages: c.source_pages,
        assessed_students: values.length,
        avg_mastery: avg,
        mastered_students: mastered,
        struggling_students: struggling,
      });
    }

    conceptDtos.sort((a, b) => a.avg_mastery - b.avg_mastery || a.term.localeCompare(b.term));

    // ── 5. Per material: mean across the students who have started it ───────
    const materials: MaterialOverviewDto[] = live.map((m) => {
      const concepts = conceptsByMaterial.get(m.id) ?? [];
      const ids = concepts.map((c) => c.id);
      const cls = rosterByMaterial.get(m.id) ?? [];

      const values: number[] = [];
      let lastUpdated: string | null = null;

      for (const student of cls) {
        const byConcept = new Map<string, number>();
        for (const id of ids) {
          const row = rows.get(classKey(student.id, id));
          if (!row) continue;
          byConcept.set(id, row.mastery);
          if (row.lastUpdated && (lastUpdated === null || row.lastUpdated > lastUpdated)) {
            lastUpdated = row.lastUpdated;
          }
        }
        if (byConcept.size > 0) values.push(documentMastery(ids, byConcept));
      }

      const mDoc = meanOrNull(values);

      return {
        material_id: m.id,
        title: m.title,
        subject: m.subject,
        grade_levels: m.gradeLevels,
        parsed_status: m.parsedStatus,
        concept_count: concepts.length,
        class_size: cls.length,
        started: values.length,
        m_doc: mDoc,
        tier: masteryTier(mDoc ?? P_L0),
        struggling_concepts: strugglingByMaterial.get(m.id) ?? 0,
        last_updated: lastUpdated,
        created_at: m.createdAt,
      };
    });

    // ── 6. Per student: EQ(4) across every material they can see ────────────
    const students: StudentOverviewDto[] = roster.map((student) => {
      // A concept belongs to exactly one material, so concatenating the materials
      // visible to this student cannot produce a duplicate concept id.
      const visible = live.filter((m) => m.gradeLevels.includes(student.gradeLevel));
      const ids = visible.flatMap((m) => (conceptsByMaterial.get(m.id) ?? []).map((c) => c.id));

      const byConcept = new Map<string, number>();
      let mastered = 0;
      let lastUpdated: string | null = null;

      for (const id of ids) {
        const row = rows.get(classKey(student.id, id));
        if (!row) continue;
        byConcept.set(id, row.mastery);
        if (row.mastery >= MASTERED) mastered += 1;
        if (row.lastUpdated && (lastUpdated === null || row.lastUpdated > lastUpdated)) {
          lastUpdated = row.lastUpdated;
        }
      }

      const mDoc = documentMastery(ids, byConcept);

      // Only materials they have actually started. A not-started student gets an
      // empty array rather than a row per material reporting the prior.
      const byMaterial: StudentMaterialSliceDto[] = [];
      if (byConcept.size > 0) {
        for (const m of visible) {
          const materialIds = (conceptsByMaterial.get(m.id) ?? []).map((c) => c.id);
          const assessed = materialIds.filter((id) => byConcept.has(id)).length;
          if (assessed === 0) continue;
          byMaterial.push({
            material_id: m.id,
            m_doc: documentMastery(materialIds, byConcept),
            assessed_concept_count: assessed,
            concept_count: materialIds.length,
          });
        }
        byMaterial.sort((a, b) => a.m_doc - b.m_doc);
      }

      return {
        student_id: student.id,
        first_name: student.firstName,
        last_name: student.lastName,
        grade_level: student.gradeLevel,
        // null, not the 0.10 `documentMastery()` returns for an untouched library.
        m_doc: byConcept.size === 0 ? null : mDoc,
        tier: masteryTier(mDoc),
        concept_count: ids.length,
        assessed_concept_count: byConcept.size,
        mastered_concept_count: mastered,
        last_updated: lastUpdated,
        by_material: byMaterial,
      };
    });

    /*
     * Partition before sorting, everywhere. A null `m_doc` in a numeric comparator
     * yields NaN, and a comparator returning NaN produces an arbitrary order. It
     * also matters semantically: the transition step floors every assessed posterior
     * at P(T) = 0.20, so ranking a not-started student at 0.10 would put everyone who
     * has done nothing ABOVE everyone measurably struggling.
     */
    const started = students.filter((s) => s.m_doc !== null);
    const notStarted = students.filter((s) => s.m_doc === null);
    started.sort((a, b) => (a.m_doc as number) - (b.m_doc as number));

    const startedMaterials = materials.filter((m) => m.m_doc !== null);
    const quietMaterials = materials.filter((m) => m.m_doc === null);
    startedMaterials.sort((a, b) => (a.m_doc as number) - (b.m_doc as number));
    quietMaterials.sort((a, b) => b.created_at.localeCompare(a.created_at));

    // ── 7. Class, grades, attention ─────────────────────────────────────────
    const byTier: Record<DifficultyTier, number> = {
      foundational: 0,
      intermediate: 0,
      advanced: 0,
    };
    for (const s of started) byTier[s.tier] += 1;

    const gradeDtos: GradeOverviewDto[] = grades.map((grade) => {
      const inGrade = students.filter((s) => s.grade_level === grade);
      const values = inGrade.filter((s) => s.m_doc !== null).map((s) => s.m_doc as number);
      const mDoc = meanOrNull(values);
      return {
        grade_level: grade,
        material_count: live.filter((m) => m.gradeLevels.includes(grade)).length,
        size: inGrade.length,
        started: values.length,
        m_doc: mDoc,
        tier: masteryTier(mDoc ?? P_L0),
      };
    });

    const attention: AttentionDto[] = [];
    for (const m of materials) {
      const source = live.find((l) => l.id === m.material_id)!;
      let reason: AttentionReason | null = null;

      // One reason per material, most blocking first. A failed parse also leaves
      // the material with no concepts; reporting both would say one thing twice.
      if (m.parsed_status === 'failed') reason = 'parse_failed';
      else if (m.parsed_status === 'pending' || m.parsed_status === 'processing') reason = 'parse_pending';
      else if (m.concept_count === 0) reason = 'no_concepts';
      else if (m.class_size === 0) reason = 'no_students';
      else if (m.started === 0) reason = 'nobody_started';

      if (!reason) continue;
      attention.push({
        material_id: m.material_id,
        title: m.title,
        reason,
        grade_levels: m.grade_levels,
        parse_error: reason === 'parse_failed' ? source.parseError : null,
        class_size: m.class_size,
      });
    }

    const classMean = meanOrNull(started.map((s) => s.m_doc as number));

    res.json({
      data: {
        educator,
        counts: {
          materials_live: live.length,
          materials_archived: archived,
          materials_unready: materials.filter(
            (m) => m.parsed_status !== 'completed' || m.concept_count === 0
          ).length,
          concepts_total: conceptIds.length,
          concepts_assessed: assessedConceptIds.size,
          grades,
        },
        // Shaped identically to `MaterialPerformance['class']` so the client can
        // reuse one caption helper for both screens.
        class: {
          size: roster.length,
          started: started.length,
          m_doc: classMean,
          tier: masteryTier(classMean ?? P_L0),
          by_tier: byTier,
        },
        attention,
        materials: [...startedMaterials, ...quietMaterials],
        students: [...started, ...notStarted],
        // Capped: a 500-concept library must not ship 500 rows nobody scrolls.
        // `counts.concepts_assessed` is the real total behind this list.
        concepts: conceptDtos.slice(0, WEAKEST_CONCEPTS),
        grades: gradeDtos,
        recent_uploads: live.slice(0, RECENT_UPLOADS).map((m) => ({
          material_id: m.id,
          title: m.title,
          subject: m.subject,
          grade_levels: m.gradeLevels,
          parsed_status: m.parsedStatus,
          concept_count: (conceptsByMaterial.get(m.id) ?? []).length,
          created_at: m.createdAt,
        })),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to load your dashboard', message });
  }
});

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
