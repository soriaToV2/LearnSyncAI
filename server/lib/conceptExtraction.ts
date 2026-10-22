/**
 * Concept extraction from a material's pages.
 * - Every page window is processed; code, not the model, decides when the document is done.
 * - A term appears at most once per material: same-term candidates are folded by exact key
 *   before any embedding. Never reintroduce a similarity threshold for same-term concepts.
 * - Different terms with near-identical definitions are dropped by embedding cosine.
 * - Each concept records its source pages.
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
  /** Source page(s), sorted and de-duplicated. */
  source_pages: number[];
  /** Embedding of the final definition (3072-d). */
  embedding: number[];
}

// Small windows so one call can't silently truncate a long list.
const MAX_WINDOW_CHARS = 8000;
const MAX_WINDOW_PAGES = 6;

const MIN_DEFINITION_CHARS = 12;

// Different terms this similar are a reworded duplicate. Unrelated text already scores ~0.6–0.7.
const CROSS_TERM_DUP = 0.93;

// Cap on a folded definition (flashcard back). Earliest pages are kept.
const MAX_MERGED_DEFINITION_CHARS = 800;

const EXTRACTION_THINKING = ThinkingLevel.LOW;

// Generous: dense windows yield 30+ concepts and thinking tokens share this budget.
const EXTRACTION_MAX_OUTPUT_TOKENS = 16384;

/** Structure only; value rules are enforced in the validation loop. */
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

/** A validated item, before same-term folding. */
interface Candidate {
  term: string;
  definition: string;
  page: number;
}

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

/**
 * A trailing ALL-CAPS acronym in brackets, e.g. "(SSDLC)". Narrow on purpose: a lowercase
 * parenthetical is a disambiguator ("Bank (river)" vs "Bank (financial)") and must stay distinct.
 */
const TRAILING_ACRONYM = /\s*\(\s*([A-Z0-9][A-Z0-9./-]{0,9})\s*\)\s*$/;

/** Same-term folding key: normalised term with any trailing acronym removed. */
export function foldKey(term: string): string {
  const stripped = term.replace(TRAILING_ACRONYM, '');
  // A term that is only an acronym has nothing left after stripping.
  return norm(stripped) || norm(term);
}

/** The acronym a term introduces, lowercased, or null. Shared with Free Recall; don't duplicate the rule. */
export function acronymOf(term: string): string | null {
  const match = TRAILING_ACRONYM.exec(term.trim());
  return match ? match[1].toLowerCase() : null;
}

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
    // New window if this page would exceed either budget (an oversized page still gets its own).
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
- Return EXACTLY ONE item per term. If the text explains a term in more than one place, or in more than one way, combine everything it says into that single item's definition. Never return the same term twice.
- Do not invent anything that is not in the text. Prefer domain-specific terminology over trivia.`;

/** Extracts, validates, folds, embeds and de-duplicates concepts. Throws naming the failed page range. */
export async function extractConcepts(pages: PageText[]): Promise<ExtractedConcept[]> {
  const windows = buildWindows(pages);

  // 1. Extract per window.
  const candidates: Candidate[] = [];

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

      if (definition.length < MIN_DEFINITION_CHARS) continue;
      if (norm(definition) === norm(term)) continue;

      // Clamp the reported page into this window's range.
      let page = typeof item?.page === 'number' ? Math.round(item.page) : w.startPage;
      if (page < w.startPage || page > w.endPage) page = w.startPage;

      candidates.push({ term, definition, page });
    }
  }

  // 2. Fold candidates sharing a term into one record, by exact key, before any embedding.
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = foldKey(c.term);
    const group = groups.get(key);
    if (group) group.push(c);
    else groups.set(key, [c]); // Map preserves insertion order ⇒ stable output.
  }

  // Fold a bare acronym ("SSDLC") into the full name that introduced it.
  const fullNameFor = new Map<string, string>();
  for (const c of candidates) {
    const acronym = acronymOf(c.term);
    if (acronym) fullNameFor.set(acronym, foldKey(c.term));
  }
  for (const [acronym, fullKey] of fullNameFor) {
    if (acronym === fullKey) continue;
    const acronymGroup = groups.get(acronym);
    const fullGroup = groups.get(fullKey);
    if (!acronymGroup || !fullGroup) continue;
    fullGroup.push(...acronymGroup);
    groups.delete(acronym);
  }

  const merged = [...groups.values()].map((group) => ({
    // Prefer the label carrying the acronym, else first appearance.
    term: (group.find((c) => acronymOf(c.term)) ?? group[0]).term,
    definition: mergeDefinitions(group),
    source_pages: group.reduce<number[]>((pages, c) => unionPages(pages, c.page), []),
  }));

  // 3. Embed the final merged definition, so the stored vector always describes the stored text.
  const kept: ExtractedConcept[] = [];

  for (const m of merged) {
    const embedding = await generateEmbedding(m.definition);

    // Reworded duplicate under a different term: drop it but keep its pages on the survivor.
    let bestIdx = -1;
    let bestSim = -1;
    for (let i = 0; i < kept.length; i++) {
      const sim = cosine(embedding, kept[i].embedding);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestSim >= CROSS_TERM_DUP) {
      const match = kept[bestIdx];
      for (const page of m.source_pages) match.source_pages = unionPages(match.source_pages, page);
      continue;
    }

    kept.push({ ...m, embedding });
  }

  return kept;
}

/** Joins a term's definitions in page order, dropping repeats and definitions contained in a longer one. */
function mergeDefinitions(group: Candidate[]): string {
  const ordered = [...group].sort((a, b) => a.page - b.page);

  // Strip terminal punctuation so containment checks aren't defeated by a full stop.
  const core = (s: string) => norm(s).replace(/[.!?]+$/, '');

  const parts: string[] = [];
  for (const c of ordered) {
    const candidate = core(c.definition);

    if (parts.some((p) => core(p).includes(candidate))) continue;

    // Supersedes an earlier part: replace it.
    const subsumed = parts.findIndex((p) => candidate.includes(core(p)));
    if (subsumed >= 0) {
      parts[subsumed] = c.definition;
      continue;
    }

    parts.push(c.definition);
  }

  let out = '';
  for (const part of parts) {
    const sentence = /[.!?]$/.test(part) ? part : `${part}.`;
    const next = out ? `${out} ${sentence}` : sentence;
    // Stop before the cap rather than cutting mid-sentence.
    if (out && next.length > MAX_MERGED_DEFINITION_CHARS) break;
    out = next;
  }
  return out;
}

function unionPages(pages: number[], page: number): number[] {
  return pages.includes(page) ? pages : [...pages, page].sort((a, b) => a - b);
}
