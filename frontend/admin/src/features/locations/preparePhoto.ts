/**
 * Fit a chosen photo inside the limit the backend enforces.
 *
 * `services/location_photos.py` refuses an upload over 5 MB, and a photo
 * straight off a phone or a camera is routinely 6-12 MB, so rejecting it at
 * the picker leaves somebody unable to save a building for a reason they
 * cannot do anything about. Re-encoding it here keeps the upload under the
 * limit instead.
 *
 * This never raises the cap: the server's rule stays the authority, and this
 * only makes a file fit under it. An oversized image is redrawn at no more
 * than `MAX_EDGE` on its longest side and re-encoded as JPEG, dropping quality
 * and then pixels until it fits. JPEG has no transparency, so an oversized PNG
 * loses its alpha channel - acceptable for a building photograph, which is
 * what this gallery holds, and only ever applied to a file that would
 * otherwise be refused.
 *
 * Where the browser cannot re-encode (no `createImageBitmap`, no 2D context,
 * no `toBlob` - which is also the case in jsdom), the file comes back refused
 * exactly as it was before this existed.
 */

export const MAX_BYTES = 5 * 1024 * 1024;
export const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// Generous: the gallery shows a 52px thumbnail and a modal preview, so 2400px
// on the long edge is still more detail than any screen here will render.
const MAX_EDGE = 2400;

// Tried in order, and the first result under the cap wins.
const QUALITIES = [0.85, 0.72, 0.6, 0.45];

// Each round redraws at 70% of the previous size, so a very large original
// gives up pixels rather than ending as mush at the lowest quality.
const SCALE_ROUNDS = 4;
const SCALE_STEP = 0.7;

export interface PreparedPhoto {
  /** The file to upload: the original, or a smaller re-encoding of it. */
  file: File;
  /** Set when the file was re-encoded, for the picker to report. */
  note?: string;
  /** Set when the file cannot be uploaded at all. */
  error?: string;
}

function megabytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function decode(file: File) {
  if (typeof createImageBitmap !== "function") return null;
  try {
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

function draw(bitmap: ImageBitmap, scale: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const context = canvas.getContext("2d");
  if (!context) return null;

  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function encode(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    if (typeof canvas.toBlob !== "function") {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}

async function shrink(file: File) {
  const bitmap = await decode(file);
  if (!bitmap) return null;

  try {
    let scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));

    for (let round = 0; round < SCALE_ROUNDS; round += 1) {
      const canvas = draw(bitmap, scale);
      if (!canvas) return null;

      for (const quality of QUALITIES) {
        const blob = await encode(canvas, quality);
        if (!blob) return null;
        if (blob.size <= MAX_BYTES) {
          const name = `${file.name.replace(/\.[^./\\]+$/, "")}.jpg`;
          return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
        }
      }

      scale *= SCALE_STEP;
    }

    return null;
  } finally {
    bitmap.close?.();
  }
}

/** The file to upload for a chosen image, or the reason it cannot be used. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!MIME_TYPES.has(file.type)) {
    return { file, error: "use PNG, JPEG, or WebP" };
  }

  if (file.size <= MAX_BYTES) {
    return { file };
  }

  const smaller = await shrink(file);
  if (!smaller) {
    return { file, error: `exceeds 5 MB (${megabytes(file.size)}) and could not be resized here` };
  }

  return { file: smaller, note: `resized ${megabytes(file.size)} to ${megabytes(smaller.size)}` };
}
