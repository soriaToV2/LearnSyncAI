/**
 * Server-side PDF reading for the Material Ingestion path.
 *
 * We read the text layer page by page with pdfjs-dist's *legacy* build, which is
 * the one that runs under Node (the default build assumes a browser worker). No
 * canvas or worker is needed because we only pull the text layer — never render.
 *
 * Two jobs, one pass:
 *   1. Report page_count and whether the document is scanned (image-only), so the
 *      upload handler can refuse scanned files without an OCR phase.
 *   2. Hand the per-page text to the concept extractor, so every concept can
 *      record the page(s) it came from (educator traceability).
 */

// Runtime only. pdfjs-dist ships no `exports` map, so this subpath resolves by
// file; its types live elsewhere, so the module is treated as `any` — fine here.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface PdfPage {
  /** 1-based page number, matching what a human sees in a PDF reader. */
  page: number;
  /** Reading-order text for this page, with newlines at visual line breaks. */
  text: string;
}

export interface PdfExtract {
  pageCount: number;
  pages: PdfPage[];
  /**
   * True when the document carries essentially no text — i.e. it is a scan or
   * photos of printed pages. Extraction is not attempted on these; OCR is a
   * later phase.
   */
  isScanned: boolean;
}

/**
 * A page of real prose yields dozens to hundreds of text items; a scanned page
 * yields none, or a few stray marks. Averaging fewer than this many items per
 * page across the whole document means there is no usable text layer.
 */
const MIN_TEXT_ITEMS_PER_PAGE = 5;

/** Y positions closer than this (PDF points) are treated as the same line. */
const LINE_BREAK_TOLERANCE = 3;

/**
 * Reads a PDF buffer and returns its page count, per-page text, and whether it
 * is a scanned/image-only document.
 *
 * Throws if the buffer is not a readable PDF; the caller surfaces that as a
 * validation error rather than letting it reach concept extraction.
 */
export async function extractPdfPages(buffer: Buffer): Promise<PdfExtract> {
  const data = new Uint8Array(buffer);
  const pdf = await getDocument({ data, useSystemFonts: true }).promise;

  try {
    const pageCount: number = pdf.numPages;
    const pages: PdfPage[] = [];
    let totalItems = 0;

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      totalItems += content.items.length;

      let text = '';
      let lastY: number | null = null;
      for (const item of content.items) {
        // items are TextItem | TextMarkedContent; only TextItem carries `str`.
        if (!('str' in item)) continue;
        const y = item.transform?.[5];
        if (lastY !== null && typeof y === 'number' && Math.abs(y - lastY) > LINE_BREAK_TOLERANCE) {
          text += '\n';
        } else if (text.length && !text.endsWith('\n')) {
          text += ' ';
        }
        text += item.str;
        if (typeof y === 'number') lastY = y;
      }

      pages.push({ page: i, text: text.trim() });
      page.cleanup();
    }

    const isScanned = totalItems < MIN_TEXT_ITEMS_PER_PAGE * pageCount;
    return { pageCount, pages, isScanned };
  } finally {
    await pdf.destroy();
  }
}
