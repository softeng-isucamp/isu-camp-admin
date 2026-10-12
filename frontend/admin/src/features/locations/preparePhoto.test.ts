import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_BYTES, preparePhoto } from "./preparePhoto";

const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalToBlob = HTMLCanvasElement.prototype.toBlob;

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  HTMLCanvasElement.prototype.toBlob = originalToBlob;
  vi.unstubAllGlobals();
});

function photoOf(name: string, type: string, bytes: number) {
  return new File([new Uint8Array(bytes)], name, { type });
}

/**
 * jsdom has no image decoder or canvas encoder, so both are stood in for.
 * ``bytesPerPixel`` decides how compressible the fake image is, which is what
 * drives preparePhoto's quality and scale loops.
 */
function stubImaging({ width = 4000, height = 3000, bytesPerPixel = 1.2 } = {}) {
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width, height, close })));
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as never;
  HTMLCanvasElement.prototype.toBlob = function toBlob(
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
    quality?: number,
  ) {
    const size = Math.round(this.width * this.height * (quality ?? 1) * bytesPerPixel);
    // Only a result that will be kept needs real bytes behind it. Allocating
    // gigabytes for an attempt preparePhoto is about to discard would make
    // this test slower than the feature.
    callback(size > MAX_BYTES
      ? ({ size, type: type ?? "image/jpeg" } as Blob)
      : new Blob([new Uint8Array(size)], { type: type ?? "image/jpeg" }));
  } as never;
  return { close };
}

describe("preparing a chosen photo", () => {
  it("passes a photo inside the limit through untouched", async () => {
    const chosen = photoOf("front.png", "image/png", 2 * 1024 * 1024);

    const prepared = await preparePhoto(chosen);

    expect(prepared.file).toBe(chosen);
    expect(prepared.note).toBeUndefined();
    expect(prepared.error).toBeUndefined();
  });

  it("refuses a format the gallery cannot store", async () => {
    const prepared = await preparePhoto(photoOf("notes.pdf", "application/pdf", 1024));

    expect(prepared.error).toBe("use PNG, JPEG, or WebP");
  });

  it("resizes a camera photo instead of refusing it", async () => {
    const bitmap = stubImaging();
    const chosen = photoOf("IMG_4821.jpg", "image/jpeg", 9 * 1024 * 1024);

    const prepared = await preparePhoto(chosen);

    expect(prepared.error).toBeUndefined();
    expect(prepared.file).not.toBe(chosen);
    expect(prepared.file.size).toBeLessThanOrEqual(MAX_BYTES);
    expect(prepared.file.type).toBe("image/jpeg");
    expect(prepared.note).toContain("resized");
    // The decoded image is released whether or not the encoding worked.
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("renames a re-encoded photo so the extension matches its bytes", async () => {
    stubImaging();

    const prepared = await preparePhoto(photoOf("Front View.png", "image/png", 8 * 1024 * 1024));

    expect(prepared.file.name).toBe("Front View.jpg");
  });

  it("gives up pixels when lowering quality alone is not enough", async () => {
    // Four bytes a pixel: no quality setting fits at the first size, so the
    // long edge has to come down as well.
    stubImaging({ bytesPerPixel: 4 });

    const prepared = await preparePhoto(photoOf("huge.jpg", "image/jpeg", 24 * 1024 * 1024));

    expect(prepared.error).toBeUndefined();
    expect(prepared.file.size).toBeLessThanOrEqual(MAX_BYTES);
  });

  it("refuses an oversized photo when the browser cannot re-encode it", async () => {
    // No createImageBitmap: the pre-existing refusal is still the answer, and
    // it says how big the file was so the message can be acted on.
    vi.stubGlobal("createImageBitmap", undefined);

    const prepared = await preparePhoto(photoOf("IMG_4821.jpg", "image/jpeg", 9 * 1024 * 1024));

    expect(prepared.error).toContain("exceeds 5 MB");
    expect(prepared.error).toContain("9.0 MB");
  });

  it("refuses rather than uploading something it could not shrink", async () => {
    // An image that will not compress at any size this tries.
    stubImaging({ bytesPerPixel: 500 });

    const prepared = await preparePhoto(photoOf("stubborn.jpg", "image/jpeg", 9 * 1024 * 1024));

    expect(prepared.error).toContain("could not be resized");
  });
});
