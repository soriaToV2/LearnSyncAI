import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  generateTermMatches,
  generateTrivia,
  generateCrosswordWords,
  GameDifficulty,
} from '../lib/groq';
import { buildCrossword } from '../lib/crossword';
import { GenerateGameContentSchema } from '../types/api';

const router = Router();
router.use(authenticate, requireRole('student'));

/**
 * POST /api/games/generate
 * Generates AI game content from the concepts of the selected materials and
 * persists it as a game_content row. Returns the new row id + payload.
 *
 * Flow:
 * 1. Validate body (space_id, material_ids, game_type, difficulty).
 * 2. Fetch concepts for the selected materials (422 if none).
 * 3. Branch by game_type → Groq helper (+ deterministic crossword layout).
 * 4. Assemble a CourseGameData-shaped payload.
 * 5. Insert into game_content and return { id, payload }.
 */
router.post('/generate', async (req: Request, res: Response): Promise<void> => {
  const parsed = GenerateGameContentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
    return;
  }

  const { space_id, material_ids, game_type, difficulty } = parsed.data;
  const studentId = req.user!.id;

  // 1. Fetch concepts from the selected materials.
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

  // 2. Resolve the study space title for the payload's courseName.
  const { data: space } = await supabaseAdmin
    .from('study_spaces')
    .select('title')
    .eq('id', space_id)
    .single();

  const courseName = space?.title ?? 'Study Space';
  const conceptInputs = concepts.map((c) => ({ term: c.term, definition: c.definition }));

  // 3. Generate content. Groq has no internal retry, so a failure here is a 502.
  let payload: Record<string, unknown>;
  try {
    payload = await buildPayload(game_type, conceptInputs, difficulty as GameDifficulty, courseName);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown generation error';
    res.status(502).json({ error: 'Game content generation failed', message });
    return;
  }

  // 4. Persist.
  const { data: row, error: insertError } = await supabaseAdmin
    .from('game_content')
    .insert({
      student_id: studentId,
      space_id,
      material_ids,
      game_type,
      difficulty,
      payload,
    })
    .select('id')
    .single();

  if (insertError || !row) {
    res.status(500).json({ error: 'Failed to save game content', message: insertError?.message });
    return;
  }

  res.status(201).json({ data: { id: row.id, payload }, message: 'Game content generated' });
});

/**
 * GET /api/games/content/:id
 * Returns the generated payload plus the source parameters (so the client can
 * regenerate a fresh game from the same materials via "Play Again").
 */
router.get('/content/:id', async (req: Request, res: Response): Promise<void> => {
  const studentId = req.user!.id;

  const { data: row, error } = await supabaseAdmin
    .from('game_content')
    .select('payload, space_id, material_ids, game_type, difficulty')
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
    },
  });
});

type ConceptRow = { term: string; definition: string };

/**
 * Randomly samples up to `n` concepts. This is the code-side selection seam:
 * instead of sending every concept of a material to the LLM (token-heavy), we
 * hand it a bounded subset. A different subset each call keeps replays varied.
 * When BKT lands, swap this shuffle for a mastery-weighted ordering.
 */
function pickConcepts(concepts: ConceptRow[], n: number): ConceptRow[] {
  if (concepts.length <= n) return concepts;
  const copy = [...concepts];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

// Per-game selection buffers. Each is larger than the game's output so the model
// still has a little room to choose the best items — the crossword gets the widest
// buffer because it needs interlocking words to lay out a dense grid.
const SELECT_BUFFER: Record<string, number> = {
  term_matcher: 8, // → 4 pairs
  timed_trivia: 14, // → 10 questions
  crossword: 18, // → 8–12 words, placed into the grid
};

/**
 * Assembles a CourseGameData-shaped payload for the requested game type.
 * Only the fields the target game reads are populated; unused arrays stay empty.
 */
async function buildPayload(
  gameType: string,
  concepts: ConceptRow[],
  difficulty: GameDifficulty,
  courseName: string
): Promise<Record<string, unknown>> {
  if (gameType === 'term_matcher') {
    const selected = pickConcepts(concepts, SELECT_BUFFER.term_matcher);
    const terms = await generateTermMatches(selected, 4, difficulty);
    return { courseName, terms, trivia: [], crossword: [], crosswordClues: [] };
  }

  if (gameType === 'timed_trivia') {
    // The game plays 10 questions; generate 10 unique ones so it never repeats within a run.
    const selected = pickConcepts(concepts, SELECT_BUFFER.timed_trivia);
    const trivia = await generateTrivia(selected, 10, difficulty);
    return { courseName, terms: [], trivia, crossword: [], crosswordClues: [] };
  }

  // crossword — wider buffer so the layout has interlocking candidates to choose from.
  const selected = pickConcepts(concepts, SELECT_BUFFER.crossword);
  const words = await generateCrosswordWords(selected, difficulty);
  const { crossword, crosswordClues } = buildCrossword(words);
  if (crossword.length === 0) {
    throw new Error('Could not lay out a crossword from the generated words.');
  }
  return { courseName, terms: [], trivia: [], crossword, crosswordClues };
}

export default router;
