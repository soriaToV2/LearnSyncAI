import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { generateTermMatches, generateTrivia, generateCrosswordWords } from '../lib/groq';
import { buildCrossword } from '../lib/crossword';
import { rejectInaccessibleMaterials } from '../lib/materialAccess';
import { requireOwnedSpace, spaceMaterialIds } from '../lib/spaceAccess';
import { masterySnapshot, masteryTier } from '../lib/testDifficulty';
import {
  pickConceptsByMastery,
  SELECT_BUFFER,
  TRIVIA_QUESTION_MS,
} from '../lib/gameDifficulty';
import type { DifficultyTier } from '../lib/testAllocation';
import { GenerateGameContentSchema } from '../types/api';

/**
 * The Procedural Gamification Engine (paper p. 67).
 *
 * Every game is calibrated from the student's document mastery. Paper p. 83:
 * "When a game session is initialized, the system retrieves the current M_doc
 * value from the database and applies it as a baseline parameter to the
 * generative AI prompt"; paper p. 58 adds that mastery adjusts "the question
 * selection and difficulty" of the games. Both halves live here — `M_doc` picks
 * the tier, and the tier reaches the prompts through `server/lib/gameDifficulty.ts`
 * while the per-concept map orders what the model even sees.
 *
 * GAMES READ MASTERY AND NEVER WRITE IT. Paper p. 58 (Limitations) permits games
 * to "utilize existing mastery estimates only ... without modifying the learner's
 * mastery state", and `bkt_source` is a two-value enum enforcing it. Nothing in
 * this file imports `server/lib/bkt.ts`.
 */

const router = Router();
router.use(authenticate, requireRole('student'));

type ConceptRow = { id: string; term: string; definition: string };

/**
 * POST /api/games/generate
 *
 * Gate order, identical to the deck generator and `practice.routes.ts`:
 *   1. Zod                                                            -> 400
 *   2. requireOwnedSpace          — the space is the caller's         -> 404
 *   3. rejectInaccessibleMaterials — the grade/archive rules          -> 403
 *   4. spaceMaterialIds            — this space actually holds them   -> 404
 *
 * Gate 4 is NOT redundant with gate 3: passing the grade rule proves the student
 * may READ the material, not that this space holds it — and this route stores a
 * `mastery_snapshot` attributed to `space_id`, so a material from another space
 * would corrupt that space's picture. Gates 3 and 4 were both missing before
 * calibration landed, which meant any signed-in student could generate from any
 * grade's materials; once the route began reading per-student mastery over those
 * concepts that became the same defect CLAUDE.md records for
 * `POST /api/flashcards/rate`.
 *
 * Then: concepts -> M_doc -> tier -> mastery-weighted selection -> Groq -> insert.
 * BOTH `difficulty` and `mastery_snapshot` are persisted, because the paper's
 * Difficulty Alignment check (p. 98) verifies that the mastery parameter reached
 * the prompt and cannot be run against data that was never written.
 */
router.post('/generate', async (req: Request, res: Response): Promise<void> => {
  const parsed = GenerateGameContentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { space_id, material_ids, game_type } = parsed.data;
  const studentId = req.user!.id;

  const space = await requireOwnedSpace(space_id, req, res);
  if (!space) return;
  if (!(await rejectInaccessibleMaterials(req, res, material_ids))) return;

  const inSpace = new Set(await spaceMaterialIds(space));
  if (!material_ids.every((id) => inSpace.has(id))) {
    res.status(404).json({ error: 'Material not found in this study space' });
    return;
  }

  const { data: concepts, error: conceptsError } = await supabaseAdmin
    .from('concepts')
    .select('id, term, definition')
    .in('material_id', material_ids);

  if (conceptsError) {
    res.status(500).json({ error: 'Failed to load concepts', message: conceptsError.message });
    return;
  }
  if (!concepts?.length) {
    res.status(422).json({ error: 'No concepts found for the selected materials' });
    return;
  }

  // EQ(4) over the union of the selected materials' concepts — the same function
  // Test Mode uses, so one figure cannot acquire two definitions. `byConcept`
  // comes back from the same round trip and feeds the selection below, so the
  // whole calibration costs one read.
  const { snapshot, byConcept } = await masterySnapshot(
    studentId,
    concepts.map((c) => c.id as string)
  );
  const tier = masteryTier(snapshot);

  let payload: Record<string, unknown>;
  try {
    payload = await buildPayload(
      game_type,
      concepts as ConceptRow[],
      byConcept,
      tier,
      space.title
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown generation error';
    res.status(502).json({ error: 'Game content generation failed', message });
    return;
  }

  const { data: row, error: insertError } = await supabaseAdmin
    .from('game_content')
    .insert({
      student_id: studentId,
      space_id,
      material_ids,
      game_type,
      difficulty: tier,
      mastery_snapshot: snapshot,
      payload,
    })
    .select('id')
    .single();

  if (insertError || !row) {
    res.status(500).json({ error: 'Failed to save game content', message: insertError?.message });
    return;
  }

  // `difficulty` and `mastery_snapshot` come back so "Play Again" can refresh the
  // tier chip and the timer without a second fetch — they change per generation
  // now, so echoing the request's own values would show the previous game's.
  res.status(201).json({
    data: { id: row.id, payload, difficulty: tier, mastery_snapshot: snapshot },
    message: 'Game content generated',
  });
});

/**
 * GET /api/games/content/:id
 * Returns the generated payload plus the source parameters (so the client can
 * regenerate a fresh game from the same materials via "Play Again").
 *
 * `mastery_snapshot` is included so the p. 99 black-box test — "educational game
 * generation and difficulty calibration" — is demonstrable from the browser's
 * network tab without database access. The client renders only the tier.
 */
router.get('/content/:id', async (req: Request, res: Response): Promise<void> => {
  const studentId = req.user!.id;

  const { data: row, error } = await supabaseAdmin
    .from('game_content')
    .select('payload, space_id, material_ids, game_type, difficulty, mastery_snapshot')
    .eq('id', req.params.id)
    .eq('student_id', studentId)
    .single();

  if (error || !row) {
    res.status(404).json({ error: 'Game content not found' });
    return;
  }

  res.json({
    data: {
      payload: row.payload,
      space_id: row.space_id,
      material_ids: row.material_ids,
      game_type: row.game_type,
      difficulty: row.difficulty,
      // NUMERIC arrives as a string over PostgREST.
      mastery_snapshot: row.mastery_snapshot === null ? null : Number(row.mastery_snapshot),
    },
  });
});

/**
 * Assembles a CourseGameData-shaped payload for the requested game type.
 * Only the fields the target game reads are populated; unused arrays stay empty.
 *
 * `settings` is written for `timed_trivia` ONLY. A `questionMs` on a game with no
 * clock would be a stored lie, and the two untimed games fall back to nothing.
 */
async function buildPayload(
  gameType: string,
  concepts: ConceptRow[],
  byConcept: ReadonlyMap<string, number>,
  tier: DifficultyTier,
  courseName: string
): Promise<Record<string, unknown>> {
  if (gameType === 'term_matcher') {
    const selected = pickConceptsByMastery(concepts, byConcept, SELECT_BUFFER.term_matcher);
    const terms = await generateTermMatches(selected, 4, tier);
    return { courseName, terms, trivia: [], crossword: [], crosswordClues: [] };
  }

  if (gameType === 'timed_trivia') {
    // The game plays 10 questions; generate 10 unique ones so it never repeats within a run.
    const selected = pickConceptsByMastery(concepts, byConcept, SELECT_BUFFER.timed_trivia);
    const trivia = await generateTrivia(selected, 10, tier);
    return {
      courseName,
      terms: [],
      trivia,
      crossword: [],
      crosswordClues: [],
      settings: { questionMs: TRIVIA_QUESTION_MS[tier] },
    };
  }

  // crossword — wider buffer so the layout has interlocking candidates to choose from.
  const selected = pickConceptsByMastery(concepts, byConcept, SELECT_BUFFER.crossword);
  const words = await generateCrosswordWords(selected, tier);
  const { crossword, crosswordClues } = buildCrossword(words);
  if (crossword.length === 0) {
    throw new Error('Could not lay out a crossword from the generated words.');
  }
  return { courseName, terms: [], trivia: [], crossword, crosswordClues };
}

export default router;
