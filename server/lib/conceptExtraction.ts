/**
 * Concept extraction — the "Formative Content" half of the Material Ingestion
 * and Distribution Core.
 *
 * Design goals (from the capstone's verification criteria and the user's
 * requirements), and how each is met:
 *
 *   COVERAGE      We window the document by pages and loop over EVERY window, so
 *                 the last page is processed as thoroughly as the first. The
 *                 loop — not the model — decides when the document is finished.
 *   CONSISTENCY   Guaranteed structurally, not by sampling. Windows are fixed and
 *                 disjoint and are decided by code; CONCEPT_SCHEMA pins the shape
 *                 of every item returned; terms are required verbatim from the
 *                 text, so the same term normalises the same way on every run and
 *                 reaches the merge branch below. Note that Gemini 3 IGNORES
 *                 `temperature` (2.5's temperature: 0 no longer has an
 *                 equivalent), so definition WORDING may differ between runs over
 *                 the same PDF — which is what the dedup step exists to absorb.
 *   NO DUPLICATES Concepts are de-duplicated by MEANING (embedding cosine), which
 *                 also removes repeats that straddle a window boundary.
 *   MULTIPLE      The same term with two distinct meanings is kept as two rows
 *   MEANINGS      (same term, low similarity), so each meaning is independently
 *                 testable and Free Recall can credit either one.
 *   SELF-CONTAINED Empty definitions, and definitions that merely restate the
 *                 term, are dropped.
 *   TRACEABILITY  Each concept records the source page(s) it was drawn from.
 */

import { Type, ThinkingLevel, type Schema } from '@google/genai';
import { generateJson, generateEmbedding, GEMINI_EXTRACTION_MODEL } from './gemini';

export interface PageText {
  page: number;
  text: string;
}

export interface ExtractedConcept {
  term: string;
  definition: string;
  /** Source PDF page(s), for educator traceability. Sorted, de-duplicated. */
  source_pages: number[];
  /** Definition embedding (gemini-embedding-001, 3072-d). Reused by the caller. */
  embedding: number[];
}

// ── Tunables ───────────────────────────────────────────────
// Windows are kept small so a single call cannot silently truncate a long list.
const MAX_WINDOW_CHARS = 8000;
const MAX_WINDOW_PAGES = 6;

// A definition shorter than this, or equal to its term, is not self-contained.
const MIN_DEFINITION_CHARS = 12;

// Cosine thresholds on 3072-d gemini embeddings. Unrelated text scores ~0.6–0.7
// here ("hubness"), so real duplicates sit high.
const SAME_TERM_MERGE = 0.9;   // same term + this similar ⇒ one meaning, merge
const CROSS_TERM_DUP = 0.93;   // different terms this similar ⇒ reworded duplicate

// Thinking is on by default on Gemini 3 and its tokens draw on maxOutputTokens.
// Extraction is enumeration rather than reasoning, so LOW keeps per-window latency
// near what 2.5-flash gave us while leaving room for the "extract EVERY term" rule.
const EXTRACTION_THINKING = ThinkingLevel.LOW;

// A dense window yields 30+ concepts; with thinking sharing the budget, a default
// ceiling truncates mid-array and surfaces as unparseable JSON rather than a clean
// error. Explicit and generous, still far under the model's 64k cap.
const EXTRACTION_MAX_OUTPUT_TOKENS = 16384;

/**
 * Pins the shape of every item the model returns. STRUCTURE ONLY — the value
 * rules (definition length, definition ≠ term, page inside the window) are still
 * enforced in the validation loop below, because a schema cannot express them.
 */
const CONCEPT_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      term: { type: Type.STRING },
      definition: { type: Type.STRING },
      page: { type: Type.INTEGER },
    },
    required: ['term', 'definition', 'page'],
    propertyOrdering: ['term', 'definition', 'page'],
  },
};

/** What the model returns per item, before validation. */
interface RawConcept {
  term?: unknown;
  definition?: unknown;
  page?: unknown;
}

interface Window {
  startPage: number;
  endPage: number;
  text: string;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Groups pages into disjoint windows bounded by page count and character budget. */
function buildWindows(pages: PageText[]): Window[] {
  const windows: Window[] = [];
  let current: PageText[] = [];
  let chars = 0;

  const flush = () => {
    if (!current.length) return;
    windows.push({
      startPage: current[0].page,
      endPage: current[current.length - 1].page,
      text: current.map((p) => `[PAGE ${p.page}]\n${p.text}`).join('\n\n'),
    });
    current = [];
    chars = 0;
  };

  for (const p of pages) {
    const len = p.text.length;
    // Start a new window if adding this page would blow either budget — unless
    // the current window is empty (a single oversized page must still go somewhere).
    if (current.length && (current.length >= MAX_WINDOW_PAGES || chars + len > MAX_WINDOW_CHARS)) {
      flush();
    }
    current.push(p);
    chars += len;
  }
  flush();
  return windows;
}

const PROMPT_RULES = `Return a JSON array; each item is an object { "term": string, "definition": string, "page": number }.

Rules:
- Extract EVERY term or concept a teacher could test from this text — not only the highlights. Cover the whole excerpt, including the last page shown.
- Write "term" exactly as it appears in the text. Do not paraphrase it, expand an abbreviation, or change its capitalisation.
- "page" is the [PAGE n] number where the concept mainly appears.
- Definitions must be self-contained: understandable on their own without seeing the page, one to three sentences, and must NOT merely repeat the term. Never return an empty definition.
- If a term is used with two or more DISTINCT meanings in this text, return a SEPARATE item for each meaning, each with its own definition. Do not merge different meanings into one.
- Do not invent anything that is not in the text. Prefer domain-specific terminology over trivia.`;

/**
 * Extracts, validates, embeds, and de-duplicates concepts across the whole
 * document. Throws if a window fails after the Gemini helper's own retries; the
 * caller marks the material failed and records which page range broke.
 */
export async function extractConcepts(pages: PageText[]): Promise<ExtractedConcept[]> {
  const windows = buildWindows(pages);

  // 1. Extract per window, one call each, shape pinned by CONCEPT_SCHEMA.
  const candidates: Array<{ term: string; definition: string; page: number }> = [];

  for (const w of windows) {
    const prompt = `You are an expert academic content analyst preparing study material for Junior High School students. The following text is extracted from pages ${w.startPage}–${w.endPage} of a learning module. Each page begins with a [PAGE n] marker.

${PROMPT_RULES}

Text:
${w.text}`;

    let raw: RawConcept[];
    try {
      raw = await generateJson<RawConcept[]>(prompt, {
        model: GEMINI_EXTRACTION_MODEL,
        thinkingLevel: EXTRACTION_THINKING,
        responseSchema: CONCEPT_SCHEMA,
        maxOutputTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Extraction failed on pages ${w.startPage}–${w.endPage}: ${reason}`);
    }

    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      const term = typeof item?.term === 'string' ? item.term.trim() : '';
      const definition = typeof item?.definition === 'string' ? item.definition.trim() : '';
      if (!term || !definition) continue;

      // Self-contained checks.
      if (definition.length < MIN_DEFINITION_CHARS) continue;
      if (norm(definition) === norm(term)) continue;

      // Clamp the reported page into this window's real range.
      let page = typeof item?.page === 'number' ? Math.round(item.page) : w.startPage;
      if (page < w.startPage || page > w.endPage) page = w.startPage;

      candidates.push({ term, definition, page });
    }
  }

  // 2. Embed each candidate's definition (needed for both dedup and storage).
  const kept: ExtractedConcept[] = [];

  for (const c of candidates) {
    const embedding = await generateEmbedding(c.definition);

    // Find the most similar concept already kept.
    let bestIdx = -1;
    let bestSim = -1;
    for (let i = 0; i < kept.length; i++) {
      const sim = cosine(embedding, kept[i].embedding);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      const match = kept[bestIdx];
      const sameTerm = norm(match.term) === norm(c.term);

      // Same term + high similarity ⇒ one meaning: merge, keep the fuller
      // definition, union the pages.
      if (sameTerm && bestSim >= SAME_TERM_MERGE) {
        if (c.definition.length > match.definition.length) match.definition = c.definition;
        match.source_pages = unionPages(match.source_pages, c.page);
        continue;
      }
      // Different term but near-identical idea ⇒ reworded duplicate: drop.
      if (!sameTerm && bestSim >= CROSS_TERM_DUP) {
        match.source_pages = unionPages(match.source_pages, c.page);
        continue;
      }
      // Otherwise (incl. same term, LOW similarity) it is a distinct concept /
      // a second meaning: keep it as its own row.
    }

    kept.push({ term: c.term, definition: c.definition, source_pages: [c.page], embedding });
  }

  return kept;
}

function unionPages(pages: number[], page: number): number[] {
  return pages.includes(page) ? pages : [...pages, page].sort((a, b) => a - b);
}
