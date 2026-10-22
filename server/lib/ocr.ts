/**
 * OCR for scanned/photographed materials; the only module that turns page images into text.
 * The transcript goes to extractConcepts() like a normal text layer, so all extraction rules apply.
 * Don't ask the model for concepts straight from images. Pages are sent in sequential chunks.
 * See CLAUDE.md § OCR.
 */

import { Type, ThinkingLevel, type Schema } from '@google/genai';
import { generateJsonFromDocument, GEMINI_EXTRACTION_MODEL } from './gemini';
import { slicePdfPages } from './pdfAssemble';
import type { PageText } from './conceptExtraction';

/** Smaller chunks also make a lazily abbreviated transcription detectable. */
export const OCR_PAGES_PER_CALL = 5;

const OCR_MODEL = GEMINI_EXTRACTION_MODEL;

/** Reading order on multi-column pages and tables is a judgement, so LOW like extraction. */
const OCR_THINKING = ThinkingLevel.LOW;

/** Generous: thinking shares the budget. A truncated chunk fails with MAX_TOKENS. */
const OCR_MAX_OUTPUT_TOKENS = 16384;

/** Required output for a word the model cannot read. */
export const UNREADABLE_MARK = '[?]';

/** Educator-facing; used only when no page at all is readable. */
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

/** True when a page has no letters or digits beyond unreadable marks. */
export function isBlankTranscript(text: string): boolean {
  return text.split(UNREADABLE_MARK).join('').replace(/[^\p{L}\p{N}]/gu, '').length === 0;
}

/**
 * Transcribes every page, returning 1..pageCount in order. Unreadable pages are `""` so page
 * numbering stays aligned. Throws OCR_UNREADABLE_MESSAGE when no page is readable.
 */
export async function transcribeScannedPdf(pdf: Buffer, pageCount: number): Promise<PageText[]> {
  if (pageCount < 1) throw new Error('This document has no pages.');

  const byPage = new Map<number, string>();

  for (let startPage = 1; startPage <= pageCount; startPage += OCR_PAGES_PER_CALL) {
    const endPage = Math.min(startPage + OCR_PAGES_PER_CALL - 1, pageCount);

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

      // A page outside the chunk can't be trusted.
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
