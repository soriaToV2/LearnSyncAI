/**
 * Photos → one PDF, for the Material Ingestion path.
 *
 * An educator may upload the pages of a lesson as JPEG/PNG photos. Rather than
 * teach every downstream reader about a second storage shape, the photos are
 * assembled here into a single PDF — one page per photo, in the order received —
 * and from that point on the material is indistinguishable from an uploaded scan:
 * same bucket (whose `allowed_mime_types` stays `application/pdf`), same
 * `storage_path`, same viewer (`PdfViewer.tsx`), same delete path, and
 * `page_count` / `concepts.source_pages` mean what they always meant, because
 * photo N IS page N.
 *
 * `pdf-lib` is pure JavaScript, so this adds nothing native to the Render build
 * or to a Windows dev machine. It embeds the image bytes as-is (DCTDecode /
 * FlateDecode) — no re-encoding, no quality loss beyond what the browser already
 * applied when it downscaled the photo before upload.
 *
 * ⚠️ ORIENTATION IS THE CLIENT'S JOB. pdf-lib embeds raw bytes and ignores EXIF,
 * so a portrait phone photo that relies on its orientation tag would render
 * sideways here. `UploadMaterialModal` redraws every photo through a canvas
 * (`imageOrientation: 'from-image'`) before uploading, which bakes the rotation
 * into the pixels. Do not "optimise" that step away on the client.
 */

import { PDFDocument } from 'pdf-lib';

export interface UploadedImage {
  buffer: Buffer;
  /** As reported by the client; used only for the error message, never trusted. */
  mimetype: string;
}

/** Sniffed from the bytes. The client's mimetype is a claim, not a fact. */
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

/**
 * Builds one PDF from the given photos, one page per photo, each page sized to
 * the photo's own pixel dimensions (1 px = 1 pt) so nothing is cropped or
 * letterboxed.
 *
 * Throws with a message fit for the educator when a file is not actually a
 * JPEG or PNG, or cannot be decoded. The caller turns that into a 400 before
 * anything reaches storage.
 */
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

  // `useObjectStreams: false` keeps the output a plain, maximally compatible PDF
  // for pdfjs (server text pass + student viewer) and for Gemini's page renderer.
  const bytes = await doc.save({ useObjectStreams: false });
  return Buffer.from(bytes);
}

/**
 * Copies pages [startPage, endPage] (1-based, inclusive) of a PDF into a new
 * document. Used by `ocr.ts` to transcribe a scan a few pages at a time.
 *
 * Lossless for image-only pages: the embedded image XObjects are copied as-is.
 */
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
