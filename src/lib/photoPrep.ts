/**
 * Prepares a photographed page for upload.
 *
 * Every photo an educator picks is redrawn through a canvas before it leaves
 * the browser, for three reasons that all matter:
 *
 *   1. ORIENTATION. A phone stores a portrait photo as landscape pixels plus an
 *      EXIF "rotate me" tag. The server embeds the raw bytes into a PDF with
 *      `pdf-lib`, which ignores that tag, so an un-redrawn portrait page would
 *      render sideways for every student. Decoding with
 *      `imageOrientation: 'from-image'` and re-encoding bakes the rotation into
 *      the pixels and drops the tag.
 *   2. SIZE. A 12-megapixel photo is 3–5 MB; twenty of them blow the 20 MB
 *      material limit several times over. At PHOTO_MAX_EDGE the same page is
 *      ~300–600 KB, so a full 20-page lesson fits comfortably.
 *   3. ENOUGH RESOLUTION, NOT MORE. Gemini renders a PDF page at up to
 *      3072 px and Google's own guidance is that OCR quality saturates at its
 *      default page resolution, so 2000 px on the long edge loses nothing the
 *      model would have read, while staying legible in the student viewer.
 *
 * PNG input is re-encoded as JPEG too (a screenshot of a page is the same job),
 * over a white fill so a transparent PNG does not come out black.
 */

export const PHOTO_MAX_EDGE = 2000;
export const PHOTO_JPEG_QUALITY = 0.85;

/** What the picker accepts. The server sniffs the bytes again regardless. */
export const PHOTO_MIMETYPES = new Set(['image/jpeg', 'image/png']);

export function isPhoto(file: File): boolean {
  return PHOTO_MIMETYPES.has(file.type);
}

/**
 * Downscaled, upright, JPEG. Throws when the browser cannot decode the file —
 * a HEIC picked on a browser that does not convert it, or a corrupt image —
 * and the caller turns that into a sentence naming the photo.
 */
export async function preparePhoto(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable in this browser.');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', PHOTO_JPEG_QUALITY)
    );
    if (!blob) throw new Error('The photo could not be encoded.');

    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}
