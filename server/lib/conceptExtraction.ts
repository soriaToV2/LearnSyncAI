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
 *                 folds into the same record. Note that Gemini 3 IGNORES
 *                 `temperature` (2.5's temperature: 0 no longer has an
 *                 equivalent), so definition WORDING may differ between runs over
 *                 the same PDF — which is what the fold and dedup absorb.
 *   ONE ROW      A term appears AT MOST ONCE per material. Everything the document
 *   PER TERM     says about it is folded into that single record, in page order,
 *                and the source pages are unioned. Enforced in code by term
 *                matching BEFORE any embedding, so no similarity score can shadow
 *                it; the prompt asks for the same thing, but a prompt is a request
 *                and this is the invariant.
 *
 *                Matching is exact apart from one documented convention: a
 *                trailing ALL-CAPS acronym is ignored, so "… Life Cycle (SSDLC)"
 *                and "… Life Cycle" are one concept, as are a bare "SSDLC" and the
 *                term that introduced it. See TRAILING_ACRONYM for why the rule is
 *                narrow rather than "strip every bracket".
 *
 *                This replaced a rule that kept the same term as two rows whenever
 *                its definitions embedded far enough apart, on the theory they were
 *                two distinct meanings ("bank": river vs financial). In real JHS
 *                modules that branch almost never caught polysemy — it caught two
 *                PARTIAL definitions of one term from different pages, which embed
 *                apart simply because they stress different aspects.
 *
 *                The cost of getting it wrong is wildly asymmetric. A split concept
 *                is invisible: it silently inflates Free Recall's coverage
 *                denominator, and a picker offering the same term twice cannot show
 *                a student which is which. A wrongly merged concept is listed in
 *                the educator's Concepts tab and editable in seconds. Genuine
 *                polysemy stays recoverable by hand via
 *                POST /api/materials/:id/concepts.
 *   NO DUPLICATES Beyond the per-term fold, concepts under DIFFERENT terms that
 *                 mean the same thing are dropped by embedding cosine, which also
 *                 removes repeats that straddle a window boundary.
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

// Cosine threshold on 3072-d gemini embeddings. Unrelated text scores ~0.6–0.7
// here ("hubness"), so real duplicates sit high. There is deliberately NO
// same-term threshold: identical terms are folded by exact string match before
// any vector work happens, so no similarity score can shadow that decision.
const CROSS_TERM_DUP = 0.93;   // different terms this similar ⇒ reworded duplicate

// Ceiling on a folded definition. A term the document explains on eight pages
// would otherwise produce an eight-sentence flashcard back. Parts are added in
// page order until the next would breach this, so the earliest (usually most
// foundational) definitions are the ones kept.
//
// The flashcard back is now the whole reason for this cap. It used to be shared
// with POST /api/chat, which injects every concept of a material in `full` mode
// and 413'd on Groq past ~6000 tokens; since 2026-08-19 that route runs on
// Gemini behind its own `MAX_CONTEXT_CHARS`, and the window is ~1M tokens. Lower
// this only if flashcard backs read poorly.
const MAX_MERGED_DEFINITION_CHARS = 800;

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

/** One validated item from one window, before same-term folding. */
interface Candidate {
  term: string;
  definition: string;
  page: number;
}

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

/**
 * A trailing acronym in brackets: "… (SSDLC)", "… (IR)", "… (HTTP/2)".
 *
 * Deliberately narrow. Only an ALL-CAPS/digit token of 1–10 characters counts, so
 * this matches the "introduce the full name with its abbreviation" convention and
 * nothing else. A lowercase parenthetical is usually a DISAMBIGUATOR doing the
 * opposite job — "Bank (river)" and "Bank (financial)" are two concepts and must
 * stay two rows, which is exactly what stripping every bracket would destroy.
 *
 * Applied before lowercasing, since the capitalisation is the signal.
 */
const TRAILING_ACRONYM = /\s*\(\s*([A-Z0-9][A-Z0-9./-]{0,9})\s*\)\s*$/;

/**
 * The key same-term folding groups on.
 *
 * Beyond `norm()`, it drops a trailing acronym so a document that writes
 * "Secure Software Development Life Cycle (SSDLC)" on page 5 and the short form on
 * page 7 yields ONE concept rather than two. Measured on a real upload: those two
 * definitions embed at 0.887 cosine, comfortably under CROSS_TERM_DUP, so nothing
 * downstream would have caught them either.
 */
export function foldKey(term: string): string {
  const stripped = term.replace(TRAILING_ACRONYM, '');
  // A term that is *only* an acronym has nothing left after stripping; keep it.
  return norm(stripped) || norm(term);
}

/**
 * The acronym a term introduces, lowercased, or null.
 *
 * Exported alongside foldKey so Free Recall can resolve a term a STUDENT typed
 * to the concept it names, using the same convention rather than a second copy
 * of it. Duplicating this rule is how the two sides drift apart.
 */
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
- Return EXACTLY ONE item per term. If the text explains a term in more than one place, or in more than one way, combine everything it says into that single item's definition. Never return the same term twice.
- Do not invent anything that is not in the text. Prefer domain-specific terminology over trivia.`;

/**
 * Extracts, validates, embeds, and de-duplicates concepts across the whole
 * document. Throws if a window fails after the Gemini helper's own retries; the
 * caller marks the material failed and records which page range broke.
 */
export async function extractConcepts(pages: PageText[]): Promise<ExtractedConcept[]> {
  const windows = buildWindows(pages);

  // 1. Extract per window, one call each, shape pinned by CONCEPT_SCHEMA.
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

      // Self-contained checks.
      if (definition.length < MIN_DEFINITION_CHARS) continue;
      if (norm(definition) === norm(term)) continue;

      // Clamp the reported page into this window's real range.
      let page = typeof item?.page === 'number' ? Math.round(item.page) : w.startPage;
      if (page < w.startPage || page > w.endPage) page = w.startPage;

      candidates.push({ term, definition, page });
    }
  }

  // 2. Fold every candidate sharing a term into ONE record.
  //
  //    Pure string work on the normalised term, and it runs BEFORE any embedding.
  //    Exact identity cannot be missed the way a similarity search can, so this —
  //    not a threshold — is what guarantees one row per term. The prompt asks for
  //    the same thing, but a prompt is a request; this is the invariant.
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = foldKey(c.term);
    const group = groups.get(key);
    if (group) group.push(c);
    else groups.set(key, [c]); // Map preserves insertion order ⇒ stable output.
  }

  // A term may also appear as its bare acronym — "SSDLC" alongside "Secure
  // Software Development Life Cycle (SSDLC)". Whichever introduced the acronym
  // tells us they are the same thing, so fold the acronym group into the full
  // name, which is the more useful label to keep.
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
    // Prefer the spelling that carries the acronym — "Incident response (IR)"
    // teaches the student the abbreviation, "INCIDENT RESPONSE" does not. Falls
    // back to first appearance, which is document order.
    term: (group.find((c) => acronymOf(c.term)) ?? group[0]).term,
    definition: mergeDefinitions(group),
    source_pages: group.reduce<number[]>((pages, c) => unionPages(pages, c.page), []),
  }));

  // 3. Embed the FINAL definition of each concept, never an intermediate one.
  //
  //    Ordering matters: the previous code swapped in a longer definition during
  //    the merge but kept the ORIGINAL definition's embedding, leaving the stored
  //    vector describing text that was no longer stored. Free Recall (0.70 covered
  //    threshold), the chatbot's match_concepts RPC (0.60) and the dedup below all
  //    read that vector, so a stale one silently mis-scores students. Producing
  //    text and vector together makes that state unrepresentable.
  //
  //    It is also cheaper: one embedding call per final concept rather than one
  //    per raw candidate.
  const kept: ExtractedConcept[] = [];

  for (const m of merged) {
    const embedding = await generateEmbedding(m.definition);

    // Different term, near-identical idea ⇒ reworded duplicate ("Photosynthesis"
    // vs "Photosynthetic Process"). Drop it, but keep its pages on the survivor so
    // traceability is not lost.
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

/**
 * Folds every definition the document gave for one term into a single passage.
 *
 * Ordered by source page so the result reads in document order and is identical on
 * every run. Exact repeats, and definitions wholly contained in a longer one, are
 * dropped rather than restated — without that, a term introduced loosely on an
 * early page and defined properly later yields "A barrier. A barrier that filters
 * traffic."
 */
function mergeDefinitions(group: Candidate[]): string {
  const ordered = [...group].sort((a, b) => a.page - b.page);

  // Terminal punctuation is stripped before comparing: "A fast store." is contained
  // in "A fast store of recently used data.", but the full stop hides that from a
  // plain substring test and the fragment gets appended anyway.
  const core = (s: string) => norm(s).replace(/[.!?]+$/, '');

  const parts: string[] = [];
  for (const c of ordered) {
    const candidate = core(c.definition);

    // Already said, or already said more fully.
    if (parts.some((p) => core(p).includes(candidate))) continue;

    // Says everything an earlier part said and more: replace rather than append.
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
    // Stop before the cap rather than truncating mid-sentence. Parts are already
    // in page order, so the earliest definitions are the ones that survive.
    if (out && next.length > MAX_MERGED_DEFINITION_CHARS) break;
    out = next;
  }
  return out;
}

function unionPages(pages: number[], page: number): number[] {
  return pages.includes(page) ? pages : [...pages, page].sort((a, b) => a - b);
}
