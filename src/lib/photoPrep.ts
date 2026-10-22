/**
 * Redraws each photo through a canvas before upload:
 *   1. Orientation: bakes the EXIF rotation into the pixels (pdf-lib ignores the tag).
 *   2. Size: ~300–600 KB per page, so 20 pages fit the 20 MB limit.
 *   3. Resolution: 2000 px long edge is enough for OCR.
 * PNGs become JPEG over a white fill.
 */

export const PHOTO_MAX_EDGE = 2000;
export const PHOTO_JPEG_QUALITY = 0.85;

/** Accepted types; the server sniffs bytes regardless. */
export const PHOTO_MIMETYPES = new Set(['image/jpeg', 'image/png']);

export function isPhoto(file: File): boolean {
  return PHOTO_MIMETYPES.has(file.type);
}

/** Downscaled, upright JPEG. Throws when the browser can't decode the file (e.g. HEIC). */
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
