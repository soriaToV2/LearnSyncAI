/**
 * The mastery-evidence export, as a workbook that SHOWS ITS WORKING.
 *
 * ══ WHY THIS REPLACED A CSV ══
 * The CSV carried fifteen finished numbers per student and no way to check any of
 * them. A reader asked to trust `growth = 0.2391` had nothing to recompute it
 * from. This workbook ships the per-concept rows every figure is a mean OVER, and
 * rebuilds each summary column as a live formula against them — so every number
 * on the Summary sheet can be traced to the rows that produced it by clicking one
 * cell.
 *
 * ══ ⚠️ THE APP'S OWN NUMBERS ARE SHIPPED BESIDE THE FORMULAS, ON PURPOSE ══
 * Columns R-U hold what the server computed; K-N hold what Excel computes from
 * the raw rows. Column V compares them. That pairing is the point of the file: if
 * the platform's aggregation ever drifts from its own evidence, this column says
 * so in the educator's hands, without anyone running a script. Do not "tidy" the
 * duplicate columns away.
 *
 * ══ ⚠️ THE TOLERANCE IS 1e-4 AND THAT IS NOT SLOPPINESS ══
 * `meanOrNull()` on the server rounds to 4 decimal places; Excel averages at full
 * double precision. A correct pair therefore differs by up to 5e-5. Tightening
 * this to 1e-9 would flag every healthy row.
 */

import type { MasteryEvidence } from './educatorAnalytics';
import { buildXlsxBlob, downloadBlob, type XlsxCell, type XlsxSheet } from './xlsx';

/** Header on row 4, body from row 5 — leaves room for a title and a note. */
const HEADER_ROW = 4;
const FIRST_DATA = HEADER_ROW + 1;

/** Server rounds means to 4dp; Excel does not. See the module header. */
const TOLERANCE = 0.0001;

const P_L0 = 0.1;
const ADVANCED_AT = 0.85;
const INTERMEDIATE_AT = 0.5;

function header(labels: string[]): XlsxCell[] {
  return labels.map((label) => ({ value: label, style: 'header' as const }));
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'material';
}

/**
 * Build the workbook. Pure — takes the API payload, returns a Blob.
 */
export async function buildMasteryWorkbook(data: MasteryEvidence): Promise<Blob> {
  const detail = data.concept_rows;
  const students = data.students;

  // ── ConceptDetail: the raw rows every formula reads ─────────────────────
  const detailRows: XlsxCell[][] = [
    [{ value: 'Per-concept evidence — the rows every summary figure averages', style: 'title' }],
    [{
      value:
        'One row per student per ASSESSED concept. A concept nobody was asked about has no row here ' +
        'and none in the file: it enters EQ(4) as the constant P(L0), not as a measurement. ' +
        'A blank "first posterior" means the audit trail lost that row — it is excluded from start AND end.',
      style: 'note',
    }],
    [],
    header([
      'student id', 'last name', 'first name', 'concept id', 'concept',
      'first posterior', 'latent_mastery (now)', 'opportunities',
      'flashcard obs', 'test obs', 'first observed at', 'last observed at',
    ]),
  ];

  for (const row of detail) {
    detailRows.push([
      { value: row.student_id, style: 'cell' },
      { value: row.last_name, style: 'cell' },
      { value: row.first_name, style: 'cell' },
      { value: row.concept_id, style: 'cell' },
      { value: row.concept_term, style: 'cell' },
      { value: row.first_posterior, style: 'app10' },
      { value: row.latent_mastery, style: 'app10' },
      { value: row.opportunity_count, style: 'cell' },
      { value: row.flashcard_observations, style: 'cell' },
      { value: row.test_observations, style: 'cell' },
      { value: row.first_observed_at, style: 'cell' },
      { value: row.last_observed_at, style: 'cell' },
    ]);
  }

  const detailLast = HEADER_ROW + detail.length;

  // ── Summary: one row per student, every figure a formula ────────────────
  const summaryRows: XlsxCell[][] = [
    [{ value: `Mastery evidence — ${data.material.title}`, style: 'title' }],
    [{
      value:
        'YELLOW = recomputed here by formula from the ConceptDetail sheet. GREEN = what the platform ' +
        'computed. The "check" column compares them. Click any yellow cell to see the arithmetic.',
      style: 'note',
    }],
    [],
    header([
      'student id', 'last name', 'first name', 'grade', 'concept_count',
      'assessed', 'opportunities', 'flashcard obs', 'test obs', 'without trail',
      'start_mastery', 'end_mastery', 'growth', 'm_doc', 'tier',
      'first observed at', 'last observed at',
      'app start', 'app end', 'app growth', 'app m_doc', 'check',
    ]),
  ];

  // Group the raw rows once, so each cached value comes from the same inputs
  // the formula beside it reads.
  const byStudent = new Map<string, typeof detail>();
  for (const row of detail) {
    const list = byStudent.get(row.student_id);
    if (list) list.push(row);
    else byStudent.set(row.student_id, [row]);
  }

  students.forEach((student, i) => {
    const r = FIRST_DATA + i;
    const rows = byStudent.get(student.student_id) ?? [];
    const withTrail = rows.filter((x) => x.first_posterior !== null);

    const assessed = rows.length;
    const cStart = mean(withTrail.map((x) => x.first_posterior as number));
    const cEnd = mean(withTrail.map((x) => x.latent_mastery));
    const cGrowth = cStart === null || cEnd === null ? null : round4(cEnd) - round4(cStart);
    const masterySum = rows.reduce((a, x) => a + x.latent_mastery, 0);
    const cMDoc =
      assessed === 0
        ? null
        : (masterySum + P_L0 * (student.concept_count - assessed)) / student.concept_count;
    const cTier =
      cMDoc === null ? '' : cMDoc >= ADVANCED_AT ? 'advanced' : cMDoc >= INTERMEDIATE_AT ? 'intermediate' : 'foundational';

    const agrees =
      cMDoc === null
        ? 'not started'
        : Math.abs((cStart ?? 0) - (student.start_mastery ?? 0)) < TOLERANCE &&
          Math.abs((cEnd ?? 0) - (student.end_mastery ?? 0)) < TOLERANCE &&
          Math.abs(cMDoc - (student.m_doc ?? 0)) < TOLERANCE
        ? 'MATCH'
        : 'DIFFERS';

    const forStudent = `ConceptDetail!$A:$A,$A${r}`;

    summaryRows.push([
      { value: student.student_id, style: 'cell' },
      { value: student.last_name, style: 'cell' },
      { value: student.first_name, style: 'cell' },
      { value: student.grade_level, style: 'cell' },
      { value: student.concept_count, style: 'cell' },
      { formula: `COUNTIFS(${forStudent})`, cached: assessed, style: 'calc' },
      { formula: `SUMIFS(ConceptDetail!$H:$H,${forStudent})`, cached: student.opportunity_count, style: 'calc' },
      { formula: `SUMIFS(ConceptDetail!$I:$I,${forStudent})`, cached: student.flashcard_observations, style: 'calc' },
      { formula: `SUMIFS(ConceptDetail!$J:$J,${forStudent})`, cached: student.test_observations, style: 'calc' },
      {
        formula: `$F${r}-COUNTIFS(${forStudent},ConceptDetail!$F:$F,"<>")`,
        cached: assessed - withTrail.length,
        style: 'calc',
      },
      {
        formula: `IF($F${r}=0,"",IFERROR(AVERAGEIFS(ConceptDetail!$F:$F,${forStudent},ConceptDetail!$F:$F,"<>"),""))`,
        cached: cStart,
        style: 'calc4',
      },
      {
        formula: `IF($F${r}=0,"",IFERROR(AVERAGEIFS(ConceptDetail!$G:$G,${forStudent},ConceptDetail!$F:$F,"<>"),""))`,
        cached: cEnd,
        style: 'calc4',
      },
      {
        formula: `IF(ISNUMBER($K${r}),ROUND($L${r},4)-ROUND($K${r},4),"")`,
        cached: cGrowth,
        style: 'calc4',
      },
      {
        // EQ(4): assessed concepts at their stored value, the rest at P(L0).
        formula: `IF($F${r}=0,"",(SUMIFS(ConceptDetail!$G:$G,${forStudent})+P_L0*($E${r}-$F${r}))/$E${r})`,
        cached: cMDoc,
        style: 'calc4',
      },
      {
        formula: `IF(NOT(ISNUMBER($N${r})),"",IF($N${r}>=ADVANCED_AT,"advanced",IF($N${r}>=INTERMEDIATE_AT,"intermediate","foundational")))`,
        cached: cTier,
        style: 'calc',
      },
      { value: student.first_observed_at, style: 'cell' },
      { value: student.last_observed_at, style: 'cell' },
      { value: student.start_mastery, style: 'app4' },
      { value: student.end_mastery, style: 'app4' },
      { value: student.growth, style: 'app4' },
      { value: student.m_doc, style: 'app4' },
      {
        // N() reads a blank or text as 0, so "both absent" agrees and
        // "one absent" does not — without a nest of ISNUMBER guards.
        formula:
          `IF(NOT(ISNUMBER($N${r})),"not started",` +
          `IF(AND(ABS(N($K${r})-N($R${r}))<${TOLERANCE},` +
          `ABS(N($L${r})-N($S${r}))<${TOLERANCE},` +
          `ABS($N${r}-N($U${r}))<${TOLERANCE}),"MATCH","DIFFERS"))`,
        cached: agrees,
        style: 'calc',
      },
    ]);
  });

  const summaryLast = HEADER_ROW + students.length;
  const sumRange = (col: string) => `Summary!$${col}$${FIRST_DATA}:$${col}$${Math.max(summaryLast, FIRST_DATA)}`;

  // ── Class: the same figures one level up ────────────────────────────────
  const startedRows = students.filter((s) => s.m_doc !== null);
  const classStart = mean(startedRows.flatMap((s) => (s.start_mastery === null ? [] : [s.start_mastery])));
  const classEnd = mean(startedRows.flatMap((s) => (s.end_mastery === null ? [] : [s.end_mastery])));

  const classRows: XlsxCell[][] = [
    [{ value: 'Class-level figures', style: 'title' }],
    [{
      value:
        'Averaged across STARTED students only — a student who never opened the lesson is never filled ' +
        'in with P(L0). "started" is therefore the denominator, and it must be quoted with any figure below.',
      style: 'note',
    }],
    [],
    header(['figure', 'recomputed here', 'what the app sent', 'check']),
    [
      { value: 'class size (roster)', style: 'bold' },
      { value: data.class.size, style: 'calc' },
      { value: data.class.size, style: 'app4' },
      { value: '', style: 'cell' },
    ],
    [
      { value: 'started', style: 'bold' },
      { formula: `COUNT(${sumRange('N')})`, cached: startedRows.length, style: 'calc' },
      { value: data.class.started, style: 'app4' },
      {
        formula: `IF($B${FIRST_DATA + 1}=$C${FIRST_DATA + 1},"MATCH","DIFFERS")`,
        cached: startedRows.length === data.class.started ? 'MATCH' : 'DIFFERS',
        style: 'calc',
      },
    ],
    [
      { value: 'start_mastery', style: 'bold' },
      { formula: `IFERROR(AVERAGE(${sumRange('K')}),"")`, cached: classStart, style: 'calc4' },
      { value: data.class.start_mastery, style: 'app4' },
      {
        formula: `IF(ABS(N($B${FIRST_DATA + 2})-N($C${FIRST_DATA + 2}))<${TOLERANCE},"MATCH","DIFFERS")`,
        cached:
          Math.abs((classStart ?? 0) - (data.class.start_mastery ?? 0)) < TOLERANCE ? 'MATCH' : 'DIFFERS',
        style: 'calc',
      },
    ],
    [
      { value: 'end_mastery', style: 'bold' },
      { formula: `IFERROR(AVERAGE(${sumRange('L')}),"")`, cached: classEnd, style: 'calc4' },
      { value: data.class.end_mastery, style: 'app4' },
      {
        formula: `IF(ABS(N($B${FIRST_DATA + 3})-N($C${FIRST_DATA + 3}))<${TOLERANCE},"MATCH","DIFFERS")`,
        cached: Math.abs((classEnd ?? 0) - (data.class.end_mastery ?? 0)) < TOLERANCE ? 'MATCH' : 'DIFFERS',
        style: 'calc',
      },
    ],
    [
      { value: 'growth', style: 'bold' },
      {
        formula: `IF(ISNUMBER($B${FIRST_DATA + 2}),ROUND($B${FIRST_DATA + 3},4)-ROUND($B${FIRST_DATA + 2},4),"")`,
        cached: classStart === null || classEnd === null ? null : round4(classEnd) - round4(classStart),
        style: 'calc4',
      },
      { value: data.class.growth, style: 'app4' },
      { value: '', style: 'cell' },
    ],
    [
      { value: 'm_doc (EQ 4)', style: 'bold' },
      { formula: `IFERROR(AVERAGE(${sumRange('N')}),"")`, cached: mean(startedRows.map((s) => s.m_doc as number)), style: 'calc4' },
      { value: data.class.m_doc, style: 'app4' },
      { value: '', style: 'cell' },
    ],
  ];

  // ── Parameters ──────────────────────────────────────────────────────────
  const paramRows: XlsxCell[][] = [
    [{ value: 'Parameters', style: 'title' }],
    [{ value: 'Named cells. Every formula in this workbook reads these — change one and the file recomputes.', style: 'note' }],
    [],
    header(['name', 'value', 'meaning']),
    [
      { value: 'P_L0', style: 'bold' },
      { value: P_L0, style: 'calc4' },
      { value: 'P(L0) — the prior for a concept never assessed. Fills the unassessed part of EQ(4).', style: 'wrap' },
    ],
    [
      { value: 'INTERMEDIATE_AT', style: 'bold' },
      { value: INTERMEDIATE_AT, style: 'calc4' },
      { value: 'm_doc at or above this is "intermediate".', style: 'wrap' },
    ],
    [
      { value: 'ADVANCED_AT', style: 'bold' },
      { value: ADVANCED_AT, style: 'calc4' },
      { value: 'm_doc at or above this is "advanced".', style: 'wrap' },
    ],
    [],
    [{ value: 'EQ(4)   m_doc = ( sum of assessed latent_mastery + P_L0 x unassessed ) / concept_count', style: 'bold' }],
    [{ value: 'growth  = ROUND(end_mastery, 4) - ROUND(start_mastery, 4)', style: 'bold' }],
  ];

  // ── README ──────────────────────────────────────────────────────────────
  const grades = data.material.grade_levels.join(', ');
  const readmeRows: XlsxCell[][] = [
    [{ value: 'Mastery evidence', style: 'title' }],
    [{ value: `${data.material.title}  —  ${data.material.subject}  —  Grade ${grades}`, style: 'note' }],
    [],
    [{ value: 'generated', style: 'bold' }, { value: data.generated_at, style: 'cell' }],
    [{ value: 'concepts in lesson', style: 'bold' }, { value: data.material.concept_count, style: 'cell' }],
    [{ value: 'students on roster', style: 'bold' }, { value: data.class.size, style: 'cell' }],
    [{ value: 'students started', style: 'bold' }, { value: data.class.started, style: 'cell' }],
    [{ value: 'archived', style: 'bold' }, { value: data.material.is_archived ? 'yes' : 'no', style: 'cell' }],
    ...(data.truncated
      ? [[
          { value: 'TRUNCATED', style: 'bold' as const },
          {
            value:
              'The audit-trail read hit its row cap. end_mastery is anchored to bkt_mastery and is still ' +
              'correct; start_mastery may be missing concepts. Re-export per material.',
            style: 'wrap' as const,
          },
        ]]
      : []),
    [],
    [{ value: 'DOES THE APP AGREE WITH ITS OWN EVIDENCE?', style: 'section' }, { value: '', style: 'section' }],
    [
      { value: 'students matching', style: 'bold' },
      {
        formula: `COUNTIF(${sumRange('V')},"MATCH")&" of "&COUNTIF(${sumRange('V')},"MATCH")+COUNTIF(${sumRange('V')},"DIFFERS")`,
        style: 'calc',
      },
    ],
    [
      { value: 'students differing', style: 'bold' },
      { formula: `COUNTIF(${sumRange('V')},"DIFFERS")`, style: 'calc' },
    ],
    [
      { value: 'not started', style: 'bold' },
      { formula: `COUNTIF(${sumRange('V')},"not started")`, style: 'calc' },
    ],
    [],
    [{ value: 'HOW TO READ IT', style: 'section' }, { value: '', style: 'section' }],
    [{ value: 'Yellow cells', style: 'bold' }, { value: 'Recomputed by a live Excel formula from the ConceptDetail sheet. Click one to see the arithmetic.', style: 'wrap' }],
    [{ value: 'Green cells', style: 'bold' }, { value: 'What the platform itself computed and sent.', style: 'wrap' }],
    [{ value: '', style: 'bold' }, { value: 'They should agree to four decimal places. Column V on Summary says whether they do.', style: 'wrap' }],
    [],
    [{ value: 'SHEETS', style: 'section' }, { value: '', style: 'section' }],
    [{ value: 'Class', style: 'bold' }, { value: 'Class-level figures, over started students only.', style: 'wrap' }],
    [{ value: 'Summary', style: 'bold' }, { value: 'One row per student. This is the table for a statistics package.', style: 'wrap' }],
    [{ value: 'ConceptDetail', style: 'bold' }, { value: 'The raw per-concept rows every figure above averages.', style: 'wrap' }],
    [{ value: 'Parameters', style: 'bold' }, { value: 'P(L0) and the two tier thresholds, as named cells.', style: 'wrap' }],
    [],
    [{ value: 'start_mastery IS NOT A PRE-TEST', style: 'section' }, { value: '', style: 'section' }],
    [{ value: '', style: 'bold' }, { value: 'It is the mastery AFTER the student’s first opportunity on each concept, so that answer’s outcome is already inside it. Never label it "baseline", "pre-test" or "before studying".', style: 'wrap' }],
    [{ value: '', style: 'bold' }, { value: 'A concept assessed exactly once has start = end and growth = 0. That is correct, not a bug — there is only one measurement, so no change can be observed.', style: 'wrap' }],
    [],
    [{ value: 'READ THIS BEFORE QUOTING m_doc', style: 'section' }, { value: '', style: 'section' }],
    [{ value: '', style: 'bold' }, { value: 'm_doc counts every concept in the lesson, with untouched ones entering at P(L0) = 0.10. A student at 0.60 on the 13 concepts they studied, out of 63 in the lesson, shows m_doc = 0.20 — so it measures coverage as much as mastery.', style: 'wrap' }],
    [{ value: '', style: 'bold' }, { value: 'It also cannot show growth: m_doc before any opportunity is exactly 0.10 for every student. Use the growth column, which is paired over the same concepts on both sides.', style: 'wrap' }],
    [],
    [{ value: 'BEFORE YOU CLEAN UP ACCOUNTS', style: 'section' }, { value: '', style: 'section' }],
    [{ value: '', style: 'bold' }, { value: 'A student moved to another grade, or set to disabled, drops out of the roster and vanishes from this export. Export first. Re-uploading a material deletes its concepts and every mastery row and audit row beneath them, irrecoverably.', style: 'wrap' }],
  ];

  const sheets: XlsxSheet[] = [
    { name: 'README', columns: [30, 96], rows: readmeRows },
    { name: 'Class', columns: [22, 18, 18, 12], rows: classRows, freeze: { row: HEADER_ROW } },
    {
      name: 'Summary',
      columns: [34, 16, 16, 7, 13, 10, 13, 13, 10, 12, 14, 14, 12, 12, 13, 20, 20, 12, 12, 12, 12, 12],
      rows: summaryRows,
      freeze: { row: HEADER_ROW, col: 3 },
      autoFilter: students.length ? `A${HEADER_ROW}:V${summaryLast}` : undefined,
    },
    {
      name: 'ConceptDetail',
      columns: [34, 16, 16, 34, 40, 15, 18, 13, 13, 10, 20, 20],
      rows: detailRows,
      freeze: { row: HEADER_ROW, col: 3 },
      autoFilter: detail.length ? `A${HEADER_ROW}:L${detailLast}` : undefined,
    },
    { name: 'Parameters', columns: [20, 12, 74], rows: paramRows },
  ];

  return buildXlsxBlob(sheets, {
    P_L0: `Parameters!$B$${FIRST_DATA}`,
    INTERMEDIATE_AT: `Parameters!$B$${FIRST_DATA + 1}`,
    ADVANCED_AT: `Parameters!$B$${FIRST_DATA + 2}`,
  });
}

/** Build and hand it to the browser. */
export async function downloadMasteryWorkbook(data: MasteryEvidence): Promise<void> {
  const blob = await buildMasteryWorkbook(data);
  const today = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `learnsyncai-mastery-evidence-${slug(data.material.title)}-${today}.xlsx`);
}
