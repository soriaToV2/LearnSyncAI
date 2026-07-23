/* ------------------------------------------------------------------
   Placeholder data for the Educator Portal (UI only — no backend
   wiring yet), following the same convention as StudentDashboard.tsx.

   Every interface below mirrors a real table or view in schema.sql,
   field-for-field, so swapping these arrays for API responses later is
   a mechanical change rather than a rewrite:

     Subject             -> public.subjects
     EducatorProfile     -> public.profiles (role = 'educator')
     StudentProfile      -> public.profiles (role = 'student')
     EducatorMaterial    -> public.materials
     Concept             -> public.concepts
     ConceptMastery      -> public.bkt_mastery
     GradeLevelMasteryRow-> public.v_grade_level_mastery

   Concept mastery is the single source of truth here. The roster rows
   are DERIVED from it using the same arithmetic as document_mastery()
   and mastery_tier(), so the roster and the per-student drill-down can
   never disagree — which is what the real view guarantees too.
------------------------------------------------------------------- */

export type ParsedStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type MasteryTier = 'foundational' | 'intermediate' | 'advanced';

/** P(L0) — the BKT prior a concept sits at before any assessment. */
export const INITIAL_MASTERY = 0.1;

// ─────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────

export interface Subject {
  code: string;
  name: string;
  sort_order: number;
}

/** Every JHS grade level. An educator may grant access to any of these. */
export const ALL_GRADE_LEVELS = [7, 8, 9, 10];

export interface EducatorProfile {
  id: string;
  first_name: string;
  last_name: string;
  role: 'educator';
  status: 'active' | 'disabled';
  email: string;
}

export interface StudentProfile {
  id: string;
  first_name: string;
  last_name: string;
  grade_level: number;
  /** Not a column — drives the deterministic mastery generator below. */
  skill: number;
  /** Not a column — share of concepts this student has not touched yet. */
  unassessed_rate: number;
}

export interface EducatorMaterial {
  id: string;
  educator_id: string;
  title: string;
  description: string | null;
  subject: string;
  grade_levels: number[];
  storage_path: string;
  file_size_bytes: number | null;
  page_count: number | null;
  is_scanned: boolean;
  parsed_status: ParsedStatus;
  parse_error: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Concept {
  id: string;
  material_id: string;
  term: string;
  definition: string;
  created_at: string;
}

export interface ConceptMastery {
  student_id: string;
  concept_id: string;
  latent_mastery: number;
  opportunity_count: number;
  last_updated: string;
}

export interface GradeLevelMasteryRow {
  educator_id: string;
  material_id: string;
  material_title: string;
  subject: string;
  grade_level: number;
  student_id: string;
  first_name: string;
  last_name: string;
  concept_count: number;
  assessed_concept_count: number;
  m_doc: number;
  tier: MasteryTier;
  mastered_concept_count: number;
  last_updated: string | null;
}

// ─────────────────────────────────────────────────────────────
// Reference data
// ─────────────────────────────────────────────────────────────

/** The nine rows seeded into public.subjects. */
export const SUBJECTS: Subject[] = [
  { code: 'FIL', name: 'Filipino', sort_order: 1 },
  { code: 'ENG', name: 'English', sort_order: 2 },
  { code: 'MATH', name: 'Mathematics', sort_order: 3 },
  { code: 'SCI', name: 'Science', sort_order: 4 },
  { code: 'AP', name: 'Araling Panlipunan', sort_order: 5 },
  { code: 'ESP', name: 'Edukasyon sa Pagpapakatao', sort_order: 6 },
  { code: 'TLE', name: 'Technology and Livelihood Education', sort_order: 7 },
  { code: 'MAPEH', name: 'Music, Arts, Physical Education and Health', sort_order: 8 },
  { code: 'CL', name: 'Christian Living', sort_order: 9 },
];

export function subjectName(code: string): string {
  return SUBJECTS.find((s) => s.code === code)?.name ?? code;
}

/** Matches the demo account seeded by scripts/seed-demo-educator.ts. */
export const EDUCATOR: EducatorProfile = {
  id: '1e20c99b-96fa-4581-930f-19f30bb49ae3',
  first_name: 'Liza',
  last_name: 'Mendoza',
  role: 'educator',
  status: 'active',
  email: 'liza.mendoza@pca.edu.ph',
};

/**
 * Grades this educator can monitor: those they have published a live material
 * to. Mirrors private.auth_assigned_grades(), which drives the educator RLS
 * policies on profiles, bkt_mastery and bkt_update_logs.
 */
export function assignedGrades(): number[] {
  const grades = new Set<number>();
  for (const m of MATERIALS) {
    if (m.is_archived) continue;
    for (const g of m.grade_levels) grades.add(g);
  }
  return [...grades].sort((a, b) => a - b);
}

// ─────────────────────────────────────────────────────────────
// Materials
// ─────────────────────────────────────────────────────────────

const E = EDUCATOR.id;

export const MATERIALS: EducatorMaterial[] = [
  {
    id: 'mat-sci-1',
    educator_id: E,
    title: 'Cell Structure and Function',
    description:
      'Introductory module on the parts of plant and animal cells, their organelles, and what each one does.',
    subject: 'SCI',
    grade_levels: [7],
    storage_path: `${E}/1750000001-cell-structure.pdf`,
    file_size_bytes: 3_412_880,
    page_count: 24,
    is_scanned: false,
    parsed_status: 'completed',
    parse_error: null,
    is_archived: false,
    created_at: '2026-06-14T01:20:00Z',
    updated_at: '2026-06-14T01:38:00Z',
  },
  {
    id: 'mat-sci-2',
    educator_id: E,
    title: 'Photosynthesis and Cellular Respiration',
    description:
      'How plants convert light into chemical energy, and how cells release that energy again.',
    subject: 'SCI',
    // Published to two grades — the educator chooses this per material.
    grade_levels: [7, 8],
    storage_path: `${E}/1750000002-photosynthesis.pdf`,
    file_size_bytes: 2_104_552,
    page_count: 18,
    is_scanned: false,
    parsed_status: 'completed',
    parse_error: null,
    is_archived: false,
    created_at: '2026-06-28T02:05:00Z',
    updated_at: '2026-06-28T02:19:00Z',
  },
  {
    id: 'mat-sci-3',
    educator_id: E,
    title: 'The Solar System',
    description: 'The sun, the eight planets, and the smaller bodies that orbit alongside them.',
    subject: 'SCI',
    grade_levels: [7],
    storage_path: `${E}/1753240000-solar-system.pdf`,
    file_size_bytes: 5_890_112,
    page_count: 16,
    is_scanned: true,
    parsed_status: 'processing',
    parse_error: null,
    is_archived: false,
    created_at: '2026-07-22T23:41:00Z',
    updated_at: '2026-07-22T23:42:00Z',
  },
  {
    id: 'mat-sci-4',
    educator_id: E,
    title: 'Forces and Motion',
    description: "Newton's three laws, friction, and everyday examples of each.",
    subject: 'SCI',
    grade_levels: [7],
    storage_path: `${E}/1753280000-forces-and-motion.pdf`,
    file_size_bytes: 1_874_003,
    page_count: 21,
    is_scanned: false,
    parsed_status: 'pending',
    parse_error: null,
    is_archived: false,
    created_at: '2026-07-23T00:12:00Z',
    updated_at: '2026-07-23T00:12:00Z',
  },
  {
    id: 'mat-fil-1',
    educator_id: E,
    title: 'Alamat at Epiko ng Pilipinas',
    description:
      'Mga katangian ng alamat at epiko, at ang papel nila sa kulturang Pilipino bago dumating ang mga Kastila.',
    subject: 'FIL',
    grade_levels: [10],
    storage_path: `${E}/1750000005-alamat-at-epiko.pdf`,
    file_size_bytes: 4_802_331,
    page_count: 31,
    is_scanned: false,
    parsed_status: 'completed',
    parse_error: null,
    is_archived: false,
    created_at: '2026-06-17T03:44:00Z',
    updated_at: '2026-06-17T04:01:00Z',
  },
  {
    id: 'mat-fil-2',
    educator_id: E,
    title: 'Mga Tayutay sa Tulang Filipino',
    description: 'Talasalitaan ng mga tayutay na madalas gamitin sa panulaang Filipino.',
    subject: 'FIL',
    grade_levels: [10],
    storage_path: `${E}/1752900000-mga-tayutay.pdf`,
    file_size_bytes: 8_331_204,
    page_count: 12,
    is_scanned: true,
    parsed_status: 'failed',
    parse_error:
      'Scanned pages returned no readable text. Re-upload a text-based PDF, or a scan at a higher resolution.',
    is_archived: false,
    created_at: '2026-07-19T05:30:00Z',
    updated_at: '2026-07-19T05:34:00Z',
  },
  {
    id: 'mat-fil-3',
    educator_id: E,
    title: 'Mga Uri ng Pang-uri at Pang-abay',
    description: 'Pagkilala at paggamit ng pang-uri at pang-abay sa pangungusap.',
    subject: 'FIL',
    grade_levels: [9, 10],
    storage_path: `${E}/1750000007-pang-uri-pang-abay.pdf`,
    file_size_bytes: 2_667_940,
    page_count: 22,
    is_scanned: false,
    parsed_status: 'completed',
    parse_error: null,
    is_archived: false,
    created_at: '2026-07-02T01:10:00Z',
    updated_at: '2026-07-02T01:26:00Z',
  },
  {
    id: 'mat-fil-4',
    educator_id: E,
    title: 'Noli Me Tangere: Mga Pangunahing Tauhan',
    description: 'Lumang modyul mula sa nakaraang taon. Pinalitan na ng bagong bersyon.',
    subject: 'FIL',
    grade_levels: [10],
    storage_path: `${E}/1740000008-noli-tauhan.pdf`,
    file_size_bytes: 3_998_120,
    page_count: 28,
    is_scanned: false,
    parsed_status: 'completed',
    parse_error: null,
    is_archived: true,
    created_at: '2026-02-11T02:00:00Z',
    updated_at: '2026-06-01T07:15:00Z',
  },
];

// ─────────────────────────────────────────────────────────────
// Concepts
// ─────────────────────────────────────────────────────────────

function concept(material_id: string, n: number, term: string, definition: string): Concept {
  return {
    id: `${material_id}-c${n}`,
    material_id,
    term,
    definition,
    created_at: MATERIALS.find((m) => m.id === material_id)!.updated_at,
  };
}

export const CONCEPTS: Concept[] = [
  // Cell Structure and Function
  concept('mat-sci-1', 1, 'Cell', 'The smallest unit of life, and the basic building block of every living organism.'),
  concept('mat-sci-1', 2, 'Cell Membrane', 'The thin outer layer that controls which substances enter and leave the cell.'),
  concept('mat-sci-1', 3, 'Nucleus', 'The control centre of the cell, holding the DNA that directs the cell’s activities.'),
  concept('mat-sci-1', 4, 'Cytoplasm', 'The jelly-like fluid filling the cell, where most cell activities take place.'),
  concept('mat-sci-1', 5, 'Mitochondrion', 'The organelle that releases energy from food, often called the powerhouse of the cell.'),
  concept('mat-sci-1', 6, 'Chloroplast', 'A plant-cell organelle containing chlorophyll, where photosynthesis happens.'),
  concept('mat-sci-1', 7, 'Cell Wall', 'A rigid outer layer found in plant cells that gives the cell shape and support.'),
  concept('mat-sci-1', 8, 'Vacuole', 'A storage sac holding water, food, or waste. It is much larger in plant cells.'),
  concept('mat-sci-1', 9, 'Ribosome', 'A tiny structure where the cell assembles proteins.'),
  concept('mat-sci-1', 10, 'Prokaryotic Cell', 'A simple cell without a nucleus, such as a bacterium.'),

  // Photosynthesis and Cellular Respiration
  concept('mat-sci-2', 1, 'Photosynthesis', 'The process plants use to turn sunlight, water, and carbon dioxide into glucose and oxygen.'),
  concept('mat-sci-2', 2, 'Chlorophyll', 'The green pigment in chloroplasts that absorbs light energy.'),
  concept('mat-sci-2', 3, 'Glucose', 'The sugar plants produce during photosynthesis and use as fuel.'),
  concept('mat-sci-2', 4, 'Cellular Respiration', 'The process cells use to release energy from glucose, producing carbon dioxide and water.'),
  concept('mat-sci-2', 5, 'ATP', 'The molecule that stores and carries usable energy inside a cell.'),
  concept('mat-sci-2', 6, 'Stomata', 'Tiny pores on a leaf that let gases move in and out.'),
  concept('mat-sci-2', 7, 'Aerobic Respiration', 'Respiration that requires oxygen and releases a large amount of energy.'),
  concept('mat-sci-2', 8, 'Anaerobic Respiration', 'Respiration without oxygen, releasing far less energy and producing lactic acid or alcohol.'),

  // Alamat at Epiko ng Pilipinas
  concept('mat-fil-1', 1, 'Alamat', 'Kuwentong bayan na nagpapaliwanag kung paano nagsimula ang isang bagay, lugar, o pangyayari.'),
  concept('mat-fil-1', 2, 'Epiko', 'Mahabang tulang pasalaysay tungkol sa kabayanihan ng isang bayani ng lahi.'),
  concept('mat-fil-1', 3, 'Biag ni Lam-ang', 'Epiko ng mga Ilokano tungkol sa pambihirang lakas at pakikipagsapalaran ni Lam-ang.'),
  concept('mat-fil-1', 4, 'Hudhud ni Aliguyon', 'Epiko ng mga Ifugao na inaawit tuwing anihan, tungkol kay Aliguyon.'),
  concept('mat-fil-1', 5, 'Bayani', 'Ang pangunahing tauhan ng epiko na may angking tapang at kakaibang kapangyarihan.'),
  concept('mat-fil-1', 6, 'Panitikang Bayan', 'Mga akdang pasalindila na ipinapasa mula sa isang salinlahi patungo sa susunod.'),
  concept('mat-fil-1', 7, 'Mitolohiya', 'Mga kuwento tungkol sa mga diyos at diyosa na pinaniniwalaan ng sinaunang lipunan.'),
  concept('mat-fil-1', 8, 'Tradisyong Pasalita', 'Paraan ng pagpapasa ng kuwento sa pamamagitan ng pagsasalaysay, hindi ng pagsulat.'),
  concept('mat-fil-1', 9, 'Kaligirang Pangkasaysayan', 'Ang panahon at kalagayang panlipunan kung saan isinulat o isinalaysay ang akda.'),

  // Mga Uri ng Pang-uri at Pang-abay
  concept('mat-fil-3', 1, 'Pang-uri', 'Salitang naglalarawan sa pangngalan o panghalip.'),
  concept('mat-fil-3', 2, 'Pang-abay', 'Salitang naglalarawan sa pandiwa, pang-uri, o kapwa pang-abay.'),
  concept('mat-fil-3', 3, 'Panuring', 'Salita o grupo ng salitang nagbibigay-turing sa ibang salita sa pangungusap.'),
  concept('mat-fil-3', 4, 'Lantay', 'Payak na anyo ng pang-uri na naglalarawan nang walang paghahambing.'),
  concept('mat-fil-3', 5, 'Pahambing', 'Anyo ng pang-uri na naghahambing ng dalawang bagay o tao.'),
  concept('mat-fil-3', 6, 'Pasukdol', 'Anyo ng pang-uri na nagpapakita ng pinakamataas na antas ng katangian.'),
  concept('mat-fil-3', 7, 'Pang-abay na Pamanahon', 'Pang-abay na nagsasaad kung kailan naganap ang kilos.'),
  concept('mat-fil-3', 8, 'Pang-abay na Panlunan', 'Pang-abay na nagsasaad kung saan naganap ang kilos.'),

  // Noli Me Tangere (archived)
  concept('mat-fil-4', 1, 'Crisostomo Ibarra', 'Binatang nag-aral sa Europa na nais magtayo ng paaralan para sa kanyang bayan.'),
  concept('mat-fil-4', 2, 'Maria Clara', 'Kasintahan ni Ibarra, sagisag ng dalagang Pilipina sa panahon ng Kastila.'),
  concept('mat-fil-4', 3, 'Padre Damaso', 'Prayleng Pransiskano na tutol sa pagmamahalan nina Ibarra at Maria Clara.'),
  concept('mat-fil-4', 4, 'Elias', 'Piloto at kaibigan ni Ibarra na kumakatawan sa mga aping mamamayan.'),
  concept('mat-fil-4', 5, 'Sisa', 'Inang nawalan ng bait matapos mawala ang kanyang mga anak na sina Basilio at Crispin.'),
  concept('mat-fil-4', 6, 'Kapitan Tiago', 'Mayamang negosyante at ama-amahan ni Maria Clara.'),
];

export function conceptsForMaterial(materialId: string): Concept[] {
  return CONCEPTS.filter((c) => c.material_id === materialId);
}

/** Concept count per material — the join the API will do server-side. */
export function conceptCount(materialId: string): number {
  return conceptsForMaterial(materialId).length;
}

// ─────────────────────────────────────────────────────────────
// Students
// ─────────────────────────────────────────────────────────────

export const STUDENTS: StudentProfile[] = [
  { id: 'stu-g7-1', first_name: 'Andrei', last_name: 'Bautista', grade_level: 7, skill: 0.89, unassessed_rate: 0.05 },
  { id: 'stu-g7-2', first_name: 'Bea', last_name: 'Cruz', grade_level: 7, skill: 0.71, unassessed_rate: 0.1 },
  { id: 'stu-g7-3', first_name: 'Carlo', last_name: 'Delos Reyes', grade_level: 7, skill: 0.56, unassessed_rate: 0.2 },
  { id: 'stu-g7-4', first_name: 'Divina', last_name: 'Escobar', grade_level: 7, skill: 0.42, unassessed_rate: 0.15 },
  { id: 'stu-g7-5', first_name: 'Elijah', last_name: 'Fernandez', grade_level: 7, skill: 0.29, unassessed_rate: 0.3 },
  { id: 'stu-g7-6', first_name: 'Faith', last_name: 'Gonzales', grade_level: 7, skill: 0.64, unassessed_rate: 0.1 },
  { id: 'stu-g8-1', first_name: 'Miguel', last_name: 'Navarro', grade_level: 8, skill: 0.81, unassessed_rate: 0.05 },
  { id: 'stu-g8-2', first_name: 'Nadine', last_name: 'Ocampo', grade_level: 8, skill: 0.58, unassessed_rate: 0.2 },
  { id: 'stu-g8-3', first_name: 'Oliver', last_name: 'Pascual', grade_level: 8, skill: 0.33, unassessed_rate: 0.25 },
  { id: 'stu-g9-1', first_name: 'Patricia', last_name: 'Quinto', grade_level: 9, skill: 0.87, unassessed_rate: 0.05 },
  { id: 'stu-g9-2', first_name: 'Rafael', last_name: 'Salazar', grade_level: 9, skill: 0.61, unassessed_rate: 0.15 },
  { id: 'stu-g9-3', first_name: 'Sofia', last_name: 'Tolentino', grade_level: 9, skill: 0.4, unassessed_rate: 0.3 },
  { id: 'stu-g10-1', first_name: 'Gabriel', last_name: 'Hernandez', grade_level: 10, skill: 0.92, unassessed_rate: 0.0 },
  { id: 'stu-g10-2', first_name: 'Hannah', last_name: 'Ilagan', grade_level: 10, skill: 0.78, unassessed_rate: 0.1 },
  { id: 'stu-g10-3', first_name: 'Ivan', last_name: 'Jimenez', grade_level: 10, skill: 0.35, unassessed_rate: 0.25 },
  { id: 'stu-g10-4', first_name: 'Jasmine', last_name: 'Katigbak', grade_level: 10, skill: 0.67, unassessed_rate: 0.15 },
  { id: 'stu-g10-5', first_name: 'Kenneth', last_name: 'Lorenzo', grade_level: 10, skill: 0.48, unassessed_rate: 0.7 },
  { id: 'stu-g10-6', first_name: 'Liana', last_name: 'Manalo', grade_level: 10, skill: 0.53, unassessed_rate: 0.1 },
];

export function studentById(id: string): StudentProfile | undefined {
  return STUDENTS.find((s) => s.id === id);
}

export function studentName(s: Pick<StudentProfile, 'first_name' | 'last_name'>): string {
  return `${s.first_name} ${s.last_name}`;
}

// ─────────────────────────────────────────────────────────────
// Derived mastery
// ─────────────────────────────────────────────────────────────

/** FNV-1a, normalised to [0, 1). Stable across reloads, unlike Math.random(). */
function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100_000) / 100_000;
}

const NOW = new Date('2026-07-23T08:00:00Z').getTime();

/**
 * bkt_mastery rows. A concept the student has never been assessed on gets NO
 * row at all — exactly as in the real table, where mastery only exists once an
 * adaptive flashcard or test has produced an observation.
 */
export const CONCEPT_MASTERY: ConceptMastery[] = (() => {
  const rows: ConceptMastery[] = [];

  for (const student of STUDENTS) {
    const visible = MATERIALS.filter((m) => m.grade_levels.includes(student.grade_level));

    for (const material of visible) {
      for (const c of conceptsForMaterial(material.id)) {
        if (hash01(`assessed:${student.id}:${c.id}`) < student.unassessed_rate) continue;

        const jitter = (hash01(`mastery:${student.id}:${c.id}`) - 0.5) * 0.42;
        const latent = Math.min(0.99, Math.max(0.03, student.skill + jitter));
        const opportunities = 1 + Math.floor(hash01(`opps:${student.id}:${c.id}`) * 7);
        const daysAgo = Math.floor(hash01(`when:${student.id}:${c.id}`) * 21);

        rows.push({
          student_id: student.id,
          concept_id: c.id,
          latent_mastery: Number(latent.toFixed(4)),
          opportunity_count: opportunities,
          last_updated: new Date(NOW - daysAgo * 86_400_000).toISOString(),
        });
      }
    }
  }

  return rows;
})();

export function masteryFor(studentId: string, conceptId: string): ConceptMastery | undefined {
  return CONCEPT_MASTERY.find((m) => m.student_id === studentId && m.concept_id === conceptId);
}

/** Mirrors public.mastery_tier() exactly. */
export function masteryTier(mastery: number | null): MasteryTier {
  if (mastery === null) return 'foundational';
  if (mastery >= 0.85) return 'advanced';
  if (mastery >= 0.5) return 'intermediate';
  return 'foundational';
}

/**
 * v_grade_level_mastery. Built the same way the view is: one row per
 * (student, material) where the student's grade is in the material's
 * grade_levels, archived materials excluded, and unassessed concepts counted at
 * the P(L0) prior rather than dropped.
 */
export const GRADE_LEVEL_MASTERY: GradeLevelMasteryRow[] = (() => {
  const rows: GradeLevelMasteryRow[] = [];

  for (const material of MATERIALS) {
    if (material.is_archived) continue;

    const concepts = conceptsForMaterial(material.id);
    if (concepts.length === 0) continue; // the view INNER JOINs concepts

    for (const student of STUDENTS) {
      if (!material.grade_levels.includes(student.grade_level)) continue;

      const scores = concepts.map((c) => masteryFor(student.id, c.id));
      const assessed = scores.filter(Boolean) as ConceptMastery[];
      const values = scores.map((s) => s?.latent_mastery ?? INITIAL_MASTERY);
      const mDoc = values.reduce((a, b) => a + b, 0) / values.length;

      const lastUpdated = assessed.length
        ? assessed.map((a) => a.last_updated).sort().at(-1)!
        : null;

      rows.push({
        educator_id: material.educator_id,
        material_id: material.id,
        material_title: material.title,
        subject: material.subject,
        grade_level: student.grade_level,
        student_id: student.id,
        first_name: student.first_name,
        last_name: student.last_name,
        concept_count: concepts.length,
        assessed_concept_count: assessed.length,
        m_doc: Number(mDoc.toFixed(4)),
        tier: masteryTier(Number(mDoc.toFixed(4))),
        mastered_concept_count: values.filter((v) => v >= 0.85).length,
        last_updated: lastUpdated,
      });
    }
  }

  return rows;
})();

/**
 * Collapses a student's per-material rows into one overall figure, weighting by
 * concept count so a 9-concept module counts for more than a 4-concept one —
 * the same weighting an average over all concepts would give.
 */
export function overallMastery(rows: GradeLevelMasteryRow[]): number {
  if (rows.length === 0) return INITIAL_MASTERY;
  const totalConcepts = rows.reduce((sum, r) => sum + r.concept_count, 0);
  const weighted = rows.reduce((sum, r) => sum + r.m_doc * r.concept_count, 0);
  return Number((weighted / totalConcepts).toFixed(4));
}

export function masteryRowsForStudent(studentId: string): GradeLevelMasteryRow[] {
  return GRADE_LEVEL_MASTERY.filter((r) => r.student_id === studentId);
}

export function masteryRowsForMaterial(materialId: string): GradeLevelMasteryRow[] {
  return GRADE_LEVEL_MASTERY.filter((r) => r.material_id === materialId);
}

// ─────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────

export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diffMs = NOW - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
