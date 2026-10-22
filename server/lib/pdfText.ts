/**
 * Reads a PDF's text layer per page (pdfjs-dist legacy build, which runs under Node) and
 * detects image-only scans so they can go through OCR.
 */

// pdfjs-dist has no `exports` map; this subpath resolves by file and is typed as `any`.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface PdfPage {
  /** 1-based. */
  page: number;
  /** Reading-order text with newlines at visual line breaks. */
  text: string;
}

export interface PdfExtract {
  pageCount: number;
  pages: PdfPage[];
  /** No usable text layer (scan or assembled photos); route through OCR. */
  isScanned: boolean;
}

/** Fewer text items per page than this, on average, means no usable text layer. */
const MIN_TEXT_ITEMS_PER_PAGE = 5;

/** Y positions closer than this (PDF points) are the same line. */
const LINE_BREAK_TOLERANCE = 3;

/** Page count, per-page text and scan detection. Throws if the buffer isn't a readable PDF. */
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
        // Only TextItem carries `str`.
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
