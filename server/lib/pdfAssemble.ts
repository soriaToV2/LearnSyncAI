/**
 * Uploaded photos become one PDF (photo N = page N), so the rest of the app sees a normal scan.
 * pdf-lib ignores EXIF orientation; the client must redraw photos upright before upload.
 */

import { PDFDocument } from 'pdf-lib';

export interface UploadedImage {
  buffer: Buffer;
  /** Client-reported; never trusted. */
  mimetype: string;
}

/** Sniffed from the bytes, not the client's mimetype. */
type ImageKind = 'jpeg' | 'png' | null;

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buffer: Buffer, magic: number[]): boolean {
  if (buffer.length < magic.length) return false;
  return magic.every((byte, i) => buffer[i] === byte);
}

export function sniffImageKind(buffer: Buffer): ImageKind {
  if (startsWith(buffer, JPEG_MAGIC)) return 'jpeg';
  if (startsWith(buffer, PNG_MAGIC)) return 'png';
  return null;
}

/** One page per photo at 1 px = 1 pt. Throws an educator-readable message for a bad image. */
export async function imagesToPdf(files: UploadedImage[]): Promise<Buffer> {
  if (!files.length) throw new Error('No photos were received.');

  const doc = await PDFDocument.create();

  for (let i = 0; i < files.length; i++) {
    const { buffer } = files[i];
    const kind = sniffImageKind(buffer);
    if (!kind) {
      throw new Error(`Photo ${i + 1} is not a JPEG or PNG image.`);
    }

    let image;
    try {
      image = kind === 'jpeg' ? await doc.embedJpg(buffer) : await doc.embedPng(buffer);
    } catch {
      throw new Error(`Photo ${i + 1} could not be read as an image. Try saving it again as JPEG.`);
    }

    const page = doc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }

  // Plain PDF for maximum compatibility with pdfjs and Gemini.
  const bytes = await doc.save({ useObjectStreams: false });
  return Buffer.from(bytes);
}

/** Copies pages [startPage, endPage] (1-based, inclusive) into a new PDF, for chunked OCR. */
export async function slicePdfPages(pdf: Buffer, startPage: number, endPage: number): Promise<Buffer> {
  const source = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const target = await PDFDocument.create();

  const indices: number[] = [];
  for (let p = startPage; p <= endPage; p++) indices.push(p - 1);

  const pages = await target.copyPages(source, indices);
  for (const page of pages) target.addPage(page);

  const bytes = await target.save({ useObjectStreams: false });
  return Buffer.from(bytes);
}
