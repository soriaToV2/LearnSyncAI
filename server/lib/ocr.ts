/**
 * OCR for scanned and photographed materials — the ONLY module that knows how
 * page images become text.
 *
 * ── Why Gemini, and why two steps ────────────────────────────────────────────
 *
 * The transcript produced here is handed to `extractConcepts()` exactly as the
 * text layer of a normal PDF is, so every extraction guarantee (fixed windows,
 * `[PAGE n]` markers, one-row-per-term folding, cross-term dedup, embeddings,
 * `source_pages`) applies to a photographed lesson unchanged. Asking the model
 * for concepts straight from the images would have bypassed all of that, and
 * would have left the educator nothing to inspect when a concept looked wrong.
 *
 * Google Cloud Vision was considered and not chosen (2026-09-19): it cannot be
 * enabled without a GCP billing account, a service-account secret on every
 * deployment and a gRPC dependency, for a job the model this app already pays
 * for does natively — Gemini renders each PDF page as an image (560 tokens per
 * page at the default resolution; Google's own guidance is that OCR quality
 * "saturates at medium", so no `mediaResolution` override is sent). The engine
 * is isolated behind `transcribeScannedPdf()` so it can be swapped without
 * touching the ingest route or the extractor.
 *
 * ── The known cost, and what bounds it ───────────────────────────────────────
 *
 * A language model can "read" a word that is not there. A dedicated OCR engine
 * returns garbage for garbage; a model may return plausible prose. Four things
 * bound that here: the prompt is verbatim-only and forbids correcting,
 * completing or translating; `UNREADABLE_MARK` is the required output for a
 * word the model cannot read, so uncertainty is written down rather than
 * papered over; the output shape is pinned by `PAGE_SCHEMA` and every page
 * number is range-checked; and the transcript is stored (`materials.ocr_pages`)
 * and shown to the educator, so a blurry page is diagnosable rather than
 * mysterious.
 *
 * ── Chunking ─────────────────────────────────────────────────────────────────
 *
 * Pages go to the model `OCR_PAGES_PER_CALL` at a time. A 20-page scan (the
 * schema's `materials_scanned_page_limit`) is therefore four calls, run
 * sequentially like extraction's windows so the free tier's 5 requests/minute is
 * absorbed by `withRetry()` rather than tripped. Chunking is also what makes a
 * lazy transcription detectable: a model asked for 20 pages at once may quietly
 * abbreviate page 17; asked for five it either returns five or fails loudly.
 */

import { Type, ThinkingLevel, type Schema } from '@google/genai';
import { generateJsonFromDocument, GEMINI_EXTRACTION_MODEL } from './gemini';
import { slicePdfPages } from './pdfAssemble';
import type { PageText } from './conceptExtraction';

/** Pages per model call. See the module note on chunking before changing it. */
export const OCR_PAGES_PER_CALL = 5;

/**
 * The transcript feeds concepts a student reads as fact, so by the model-choice
 * rule in `gemini.ts` this is authoring, not utility work — the same model
 * extraction itself runs on.
 */
const OCR_MODEL = GEMINI_EXTRACTION_MODEL;

/**
 * Matches extraction. Transcription is copying rather than reasoning, but
 * reading order on a two-column page or a table is a judgement, and LOW is what
 * extraction already pays for a comparable one. MINIMAL is a later measurement,
 * not a default.
 */
const OCR_THINKING = ThinkingLevel.LOW;

/**
 * Five dense pages run to ~4k tokens of text. Thinking draws on the same
 * budget, so this is deliberately generous; a truncated chunk surfaces as a
 * MAX_TOKENS error from `generateJsonFromDocument()`, never as a short page.
 */
const OCR_MAX_OUTPUT_TOKENS = 16384;

/** What the model must write in place of a word it cannot read. */
export const UNREADABLE_MARK = '[?]';

/**
 * Educator-facing. Reached only when EVERY page of the document came back with
 * no readable text — a scan of blank pages, or photos too dark or blurred to
 * read at all. One unreadable page among readable ones is NOT a failure: it is
 * transcribed as empty, visible as such in the transcript, and the lesson's
 * other pages still yield concepts.
 */
export const OCR_UNREADABLE_MESSAGE =
  'No readable text was found in these pages. Retake the photos flat, in focus and in good light, then upload again.';

/** Structure only. Page-range and blank-page rules are enforced in code below. */
const PAGE_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      page: { type: Type.INTEGER },
      text: { type: Type.STRING },
    },
    required: ['page', 'text'],
    propertyOrdering: ['page', 'text'],
  },
};

interface RawPage {
  page?: unknown;
  text?: unknown;
}

function transcriptionPrompt(startPage: number, endPage: number): string {
  const count = endPage - startPage + 1;
  return `You are transcribing a photographed or scanned learning module for Junior High School students. The attached document has ${count} page${count === 1 ? '' : 's'}; its first page is page ${startPage} of the module and its last is page ${endPage}.

Return a JSON array with EXACTLY one item per page, in order, each { "page": number, "text": string }, where "page" runs from ${startPage} to ${endPage}.

Rules:
- Transcribe EXACTLY what is printed, in reading order: top to bottom, and the left column before the right column on a multi-column page. Transcribe a table row by row, separating cells with " | ".
- Keep the original wording, spelling, capitalisation, punctuation and language. Do NOT correct, complete, translate, summarise, reorder or reformat anything.
- Put each printed paragraph, heading, list item or table row on its own line.
- Write ${UNREADABLE_MARK} in place of any word you cannot read with confidence. Never guess a word.
- Text inside diagrams, figures and labels is transcribed too. Do not describe pictures — transcribe only text that is printed.
- Omit page furniture: page numbers, running headers and footers, and watermarks.
- If a page has no readable text, return "" for it. Never omit a page and never add a page.`;
}

/**
 * True when a page carries nothing a reader could use: empty, whitespace, or
 * only unreadable marks and punctuation.
 */
export function isBlankTranscript(text: string): boolean {
  return text.split(UNREADABLE_MARK).join('').replace(/[^\p{L}\p{N}]/gu, '').length === 0;
}

/**
 * Transcribes every page of a scanned/photographed PDF.
 *
 * Returns one entry per page, 1..pageCount, in order — including pages the
 * model could not read, which come back as `""` so `[PAGE n]` numbering
 * downstream stays aligned with the document the student sees.
 *
 * Throws `OCR_UNREADABLE_MESSAGE` when no page at all yielded text, and a
 * page-ranged error when a model call fails after `withRetry()`'s own attempts.
 * The caller records either in `materials.parse_error`.
 */
export async function transcribeScannedPdf(pdf: Buffer, pageCount: number): Promise<PageText[]> {
  if (pageCount < 1) throw new Error('This document has no pages.');

  const byPage = new Map<number, string>();

  for (let startPage = 1; startPage <= pageCount; startPage += OCR_PAGES_PER_CALL) {
    const endPage = Math.min(startPage + OCR_PAGES_PER_CALL - 1, pageCount);

    // A document that fits in one call goes as-is; slicing would only
    // re-serialise the same bytes.
    const chunk = pageCount <= OCR_PAGES_PER_CALL ? pdf : await slicePdfPages(pdf, startPage, endPage);

    let raw: RawPage[];
    try {
      raw = await generateJsonFromDocument<RawPage[]>(
        transcriptionPrompt(startPage, endPage),
        'application/pdf',
        chunk.toString('base64'),
        {
          model: OCR_MODEL,
          thinkingLevel: OCR_THINKING,
          responseSchema: PAGE_SCHEMA,
          maxOutputTokens: OCR_MAX_OUTPUT_TOKENS,
        }
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`OCR failed on pages ${startPage}–${endPage}: ${reason}`);
    }

    if (!Array.isArray(raw)) {
      throw new Error(`OCR failed on pages ${startPage}–${endPage}: the model returned no page list.`);
    }

    for (const item of raw) {
      const page = typeof item?.page === 'number' ? Math.round(item.page) : NaN;
      const text = typeof item?.text === 'string' ? item.text.trim() : '';

      // Range-checked exactly as extraction range-checks `page` against its
      // window. A page outside the chunk cannot be trusted to belong anywhere.
      if (!Number.isInteger(page) || page < startPage || page > endPage) {
        console.warn(`[OCR] dropped an item outside pages ${startPage}–${endPage} (page=${String(item?.page)})`);
        continue;
      }
      // A duplicated page number keeps the fuller transcription.
      const existing = byPage.get(page);
      if (existing !== undefined && existing.length >= text.length) continue;
      byPage.set(page, text);
    }
  }

  const pages: PageText[] = [];
  let readable = 0;
  for (let page = 1; page <= pageCount; page++) {
    const text = byPage.get(page) ?? '';
    const blank = isBlankTranscript(text);
    if (!blank) readable++;
    pages.push({ page, text: blank ? '' : text });
  }

  if (readable === 0) throw new Error(OCR_UNREADABLE_MESSAGE);

  console.log(
    `[OCR] transcribed ${readable}/${pageCount} readable page(s) in ${Math.ceil(pageCount / OCR_PAGES_PER_CALL)} call(s)`
  );
  return pages;
}
