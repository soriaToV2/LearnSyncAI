import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { generateTermMatches, generateTrivia, generateCrosswordWords } from '../lib/gameContent';
import { GeminiUnavailableError, studentFacingError } from '../lib/gemini';
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
 * Game generation (paper p. 67), calibrated from document mastery (paper pp. 58, 83): M_doc picks the
 * tier and per-concept mastery orders what the model sees. Games never write mastery; no bkt.ts import.
 */

const router = Router();
router.use(authenticate, requireRole('student'));

type ConceptRow = { id: string; term: string; definition: string };

/**
 * POST /api/games/generate. Gates: Zod 400 → requireOwnedSpace 404 → rejectInaccessibleMaterials 403
 * → spaceMaterialIds 404 (the space must hold the materials, not just be readable).
 * Persists `difficulty` and `mastery_snapshot` for the Difficulty Alignment check (p. 98).
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

  // EQ(4) over the selected materials, same function as Test Mode; byConcept feeds selection too.
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
    // Log the cause.
    console.error('[Games] content generation failed:', err);

    // Typed Gemini failures keep their status (429 quota / 503 outage).
    if (err instanceof GeminiUnavailableError) {
      // userMessage, never err.message.
      res.status(err.status).json({
        error: 'Game content generation failed',
        message: studentFacingError(err),
      });
      return;
    }

    // Anything else (e.g. no crossword layout) is a retryable generation failure.
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

  // Returned so "Play Again" can refresh the tier chip and timer.
  res.status(201).json({
    data: { id: row.id, payload, difficulty: tier, mastery_snapshot: snapshot },
    message: 'Game content generated',
  });
});

/**
 * GET /api/games/content/:id: the payload plus source parameters for "Play Again". mastery_snapshot
 * is included for verification; the client shows only the tier.
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

/** Builds the CourseGameData payload for one game type. `settings` only for timed_trivia. */
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
