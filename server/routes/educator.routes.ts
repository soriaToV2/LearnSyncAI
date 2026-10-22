/**
 * Educator analytics: class-level mastery, read-only (educators never write mastery; no bkt.ts import).
 * `GET /overview` spans every material; `/materials/:materialId/*` is the per-material drill-down.
 * The two must agree.
 * Computed here rather than from v_grade_level_mastery: its RLS scoping is inert under the service
 * role and it has no active-status filter.
 * Only per-student means are EQ(4) (documentMastery, unassessed = P(L₀)). Means over students never
 * fill an absent student with the prior.
 * Never print P(L₀): figures are null when nothing is measured. Gate on the counts, never `=== 0.1`.
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
  classFirstObservations,
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

/** 4dp rounding matching documentMastery(), for means over students. */
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

/** Concepts across many materials, with material_id. Chunked: `.in()` goes into the query string. */
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

// GET /api/educator/overview

/** Newest uploads on the dashboard's side column. */
const RECENT_UPLOADS = 5;

/** Weakest concepts shipped across the whole library. See `overview.concepts`. */
const WEAKEST_CONCEPTS = 20;

/** One reason per material, most blocking first (a failed parse also has no concepts). */
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
 * The educator dashboard in one request. Accepts no input, so no IDOR surface and no schema.
 * Four round trips whatever the library size; never call rosterFor() per material.
 * Live materials only: mastery rows survive archiving and would inflate denominators.
 * Invariant: materials[].m_doc equals class.m_doc on that material's Class Performance tab.
 */
router.get('/overview', async (req: Request, res: Response): Promise<void> => {
  const educatorId = req.user!.id;

  try {
    // 1. Identity + materials
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

    // 2. Concepts ‖ roster
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

    // 3. Mastery
    const rows = await classMasteryRows(roster.map((s) => s.id), conceptIds);

    // Partition the union roster per material in memory.
    const rosterByMaterial = new Map<string, RosterStudent[]>();
    for (const m of live) {
      rosterByMaterial.set(
        m.id,
        roster.filter((s) => m.gradeLevels.includes(s.gradeLevel))
      );
    }

    // 4. Per concept: mean across assessed students
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

    // 5. Per material: mean across started students
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

    // 6. Per student: EQ(4) across every visible material
    const students: StudentOverviewDto[] = roster.map((student) => {
      // A concept belongs to one material, so concatenating can't duplicate ids.
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

      // Started materials only.
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

    // Partition before sorting: a null in a comparator gives NaN (arbitrary order), and
    // not-started students must not rank above struggling ones.
    const started = students.filter((s) => s.m_doc !== null);
    const notStarted = students.filter((s) => s.m_doc === null);
    started.sort((a, b) => (a.m_doc as number) - (b.m_doc as number));

    const startedMaterials = materials.filter((m) => m.m_doc !== null);
    const quietMaterials = materials.filter((m) => m.m_doc === null);
    startedMaterials.sort((a, b) => (a.m_doc as number) - (b.m_doc as number));
    quietMaterials.sort((a, b) => b.created_at.localeCompare(a.created_at));

    // 7. Class, grades, attention
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

      // One reason per material, most blocking first.
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
        // Same shape as MaterialPerformance['class'] so the client shares one caption helper.
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
        // Capped; counts.concepts_assessed is the real total.
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

// GET /api/educator/materials/:materialId/performance

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
 * A material's class performance at document and concept level. The class is every active student
 * in its grades; those who never opened it are included as not started.
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

    // Per student: EQ(4) over this material's concepts
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

    // Weakest-first among started students only (partition, then sort). Not-started students keep
    // name order at the bottom.
    const started = students.filter((s) => s.m_doc !== null);
    const notStarted = students.filter((s) => s.m_doc === null);
    started.sort((a, b) => (a.m_doc as number) - (b.m_doc as number));

    // Per concept: mean across assessed students
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
    // Started students only: an untouched student is unmeasured, not foundational.
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

// GET /api/educator/materials/:materialId/students/:studentId/concepts

/**
 * One student's per-concept mastery for one material (an expanded Class Performance row).
 * A separate route for payload size. `:studentId` is re-derived via rosterStudent(); misses 404.
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

    // Weakest assessed first, unassessed last alphabetically (matches the student Analytics tab).
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

// GET /api/educator/materials/:materialId/concepts/:conceptId/students

/**
 * Every student in the class on one concept (the transpose of the route above).
 * The concept must belong to this material, or 404. Unassessed students are included.
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

    // Weakest assessed first; unassessed students have no position on this scale.
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

// GET /api/educator/materials/:materialId/mastery-evidence

/**
 * One (student, concept) evidence row, for assessed concepts only. `first_posterior` is null when
 * the audit row was lost; that concept is then excluded from both start and end.
 */
interface EvidenceConceptDto {
  student_id: string;
  last_name: string;
  first_name: string;
  concept_id: string;
  concept_term: string;
  /** Posterior after the FIRST opportunity on this concept. Not a baseline. */
  first_posterior: number | null;
  /** Current `bkt_mastery.latent_mastery`. */
  latent_mastery: number;
  opportunity_count: number;
  flashcard_observations: number;
  test_observations: number;
  first_observed_at: string | null;
  last_observed_at: string | null;
}

interface EvidenceStudentDto {
  student_id: string;
  first_name: string;
  last_name: string;
  grade_level: number;
  /** The lesson's concept count — the same for every row. */
  concept_count: number;
  /** |S| — the DENOMINATOR of start/end/growth. Meaningless without it. */
  assessed_concept_count: number;
  /** Has a mastery row but no surviving log row. Normally 0. */
  concepts_without_trail: number;
  opportunity_count: number;
  flashcard_observations: number;
  test_observations: number;
  /** Mean over S of the posterior AFTER THE FIRST OPPORTUNITY. Never a baseline. */
  start_mastery: number | null;
  /** Mean over the SAME S of current `latent_mastery`. */
  end_mastery: number | null;
  /** `end − start`, both rounded first so the column recomputes exactly. */
  growth: number | null;
  /** EQ(4) over EVERY concept — the number Class Performance prints. */
  m_doc: number | null;
  tier: DifficultyTier;
  first_observed_at: string | null;
  last_observed_at: string | null;
}

/**
 * Per-student learning-progress evidence for one material (replaces the removed pre/post test).
 *   S      = this material's concepts with a bkt_mastery row
 *   start  = mean over S of the oldest log row's p_l_posterior ("after the first opportunity", never a baseline)
 *   end    = mean over S of latent_mastery
 *   growth = end − start
 * Never print P(L₀): figures are null when nothing is assessed. Archive-blind. Roster order, not
 * weakest-first, so it joins against a class list.
 */
router.get(
  '/materials/:materialId/mastery-evidence',
  async (req: Request, res: Response): Promise<void> => {
    const material = await requireOwnedMaterial(req.params.materialId, req, res);
    if (!material) return;

    const [concepts, roster] = await Promise.all([
      conceptsFor(material.id),
      rosterFor(material),
    ]);

    const conceptIds = concepts.map((c) => c.id);
    const studentIds = roster.map((s) => s.id);

    const [mastery, observations] = await Promise.all([
      classMasteryRows(studentIds, conceptIds),
      classFirstObservations(studentIds, conceptIds),
    ]);

    // Integrity check: the newest log posterior should equal stored mastery. Logged, never returned.
    let mismatches = 0;

    // Per-concept rows let the .xlsx export rebuild every summary with live formulas. No extra query.
    const termById = new Map(concepts.map((c) => [c.id, c.term]));
    const conceptRows: EvidenceConceptDto[] = [];

    const students: EvidenceStudentDto[] = roster.map((student) => {
      const byConcept = new Map<string, number>();
      const starts: number[] = [];
      const ends: number[] = [];

      let withoutTrail = 0;
      let opportunities = 0;
      let flashcardObs = 0;
      let testObs = 0;
      let firstAt: string | null = null;
      let lastAt: string | null = null;

      for (const conceptId of conceptIds) {
        const key = classKey(student.id, conceptId);
        const row = mastery.get(key);
        if (!row) continue;

        // EQ(4) covers every concept, with or without an audit trail.
        byConcept.set(conceptId, row.mastery);
        opportunities += row.opportunityCount;

        const trail = observations.rows.get(key);
        if (!trail) {
          // Lost audit row: drop it from both start and end so the pairing holds.
          withoutTrail += 1;
          // Still emitted with a null start; AVERAGEIFS skips the blank the same way.
          conceptRows.push({
            student_id: student.id,
            last_name: student.lastName,
            first_name: student.firstName,
            concept_id: conceptId,
            concept_term: termById.get(conceptId) ?? '',
            first_posterior: null,
            latent_mastery: row.mastery,
            opportunity_count: row.opportunityCount,
            flashcard_observations: 0,
            test_observations: 0,
            first_observed_at: null,
            last_observed_at: null,
          });
          continue;
        }

        starts.push(trail.firstPosterior);
        ends.push(row.mastery);
        flashcardObs += trail.bySource.flashcard;
        testObs += trail.bySource.adaptive_test;
        if (firstAt === null || trail.firstAt < firstAt) firstAt = trail.firstAt;
        if (lastAt === null || trail.lastAt > lastAt) lastAt = trail.lastAt;
        if (Math.abs(trail.lastPosterior - row.mastery) > 1e-9) mismatches += 1;

        conceptRows.push({
          student_id: student.id,
          last_name: student.lastName,
          first_name: student.firstName,
          concept_id: conceptId,
          concept_term: termById.get(conceptId) ?? '',
          first_posterior: trail.firstPosterior,
          latent_mastery: row.mastery,
          opportunity_count: row.opportunityCount,
          flashcard_observations: trail.bySource.flashcard,
          test_observations: trail.bySource.adaptive_test,
          first_observed_at: trail.firstAt,
          last_observed_at: trail.lastAt,
        });
      }

      const mDoc = documentMastery(conceptIds, byConcept);
      const start = meanOrNull(starts);
      const end = meanOrNull(ends);

      return {
        student_id: student.id,
        first_name: student.firstName,
        last_name: student.lastName,
        grade_level: student.gradeLevel,
        concept_count: conceptIds.length,
        assessed_concept_count: byConcept.size,
        concepts_without_trail: withoutTrail,
        opportunity_count: opportunities,
        flashcard_observations: flashcardObs,
        test_observations: testObs,
        start_mastery: start,
        end_mastery: end,
        // Rounded operands so the column recomputes exactly.
        growth: start === null || end === null ? null : round4(end - start),
        // null, not the 0.10 `documentMastery()` returns for an untouched lesson.
        m_doc: byConcept.size === 0 ? null : mDoc,
        tier: masteryTier(mDoc),
        first_observed_at: firstAt,
        last_observed_at: lastAt,
      };
    });

    if (mismatches > 0) {
      console.error(
        `[mastery-evidence] ${mismatches} concept(s) on material ${material.id} have a newest ` +
          `log posterior that disagrees with bkt_mastery.latent_mastery`
      );
    }

    const started = students.filter((s) => s.m_doc !== null);
    const classMean = meanOrNull(started.map((s) => s.m_doc as number));
    const classStart = meanOrNull(
      started.flatMap((s) => (s.start_mastery === null ? [] : [s.start_mastery]))
    );
    const classEnd = meanOrNull(
      started.flatMap((s) => (s.end_mastery === null ? [] : [s.end_mastery]))
    );

    res.json({
      data: {
        material: {
          id: material.id,
          title: material.title,
          subject: material.subject,
          grade_levels: material.gradeLevels,
          concept_count: conceptIds.length,
          is_archived: material.isArchived,
          parsed_status: material.parsedStatus,
        },
        generated_at: new Date().toISOString(),
        truncated: observations.truncated,
        class: {
          size: roster.length,
          started: started.length,
          start_mastery: classStart,
          end_mastery: classEnd,
          growth:
            classStart === null || classEnd === null ? null : round4(classEnd - classStart),
          m_doc: classMean,
        },
        students,
        concept_rows: conceptRows,
      },
    });
  }
);

export default router;
