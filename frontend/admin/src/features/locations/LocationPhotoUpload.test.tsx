import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocationPhotoDraft } from "../../types";
import { LocationPhotoUpload } from "./LocationPhotoUpload";

const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalToBlob = HTMLCanvasElement.prototype.toBlob;

afterEach(() => {
  cleanup();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  HTMLCanvasElement.prototype.toBlob = originalToBlob;
  vi.unstubAllGlobals();
});

function Fixture() {
  const [photos, setPhotos] = useState<LocationPhotoDraft[]>([]);
  return <LocationPhotoUpload photos={photos} onChange={setPhotos} />;
}

describe("location photo upload", () => {
  it("keeps the chooser beside a collapsed gallery toggle and adds multiple photos", async () => {
    render(<Fixture />);
    expect(screen.getByRole("button", { name: "Choose photos" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Show all photos" })).toHaveAttribute("aria-expanded", "false");

    fireEvent.change(screen.getByLabelText("Upload location photos"), {
      target: { files: [
        new File(["first"], "front.png", { type: "image/png" }),
        new File(["second"], "side.jpg", { type: "image/jpeg" }),
      ] },
    });

    // Files are prepared before they are added, so the gallery fills a tick later.
    expect(await screen.findByText("Location photos (2/10)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Minimize photos" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("front.png · Cover photo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Make side.jpg cover photo" }));
    expect(screen.getByText("side.jpg · Cover photo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Minimize photos" }));
    expect(screen.getByRole("button", { name: "Choose photos" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Show all photos" })).toHaveAttribute("aria-expanded", "false");
  });

  it("accepts valid images in a mixed drop and reports rejected files", async () => {
    render(<Fixture />);
    fireEvent.drop(screen.getByRole("region", { name: "Location photos" }), {
      dataTransfer: { files: [
        new File(["photo"], "entrance.webp", { type: "image/webp" }),
        new File(["document"], "notes.pdf", { type: "application/pdf" }),
      ] },
    });
    expect(await screen.findByText("Location photos (1/10)")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("notes.pdf: use PNG, JPEG, or WebP"));
  });

  it("adds a camera photo by resizing it rather than refusing the upload", async () => {
    // jsdom cannot decode or encode an image, so both ends are stood in for.
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })));
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as never;
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback: BlobCallback, type?: string) {
      callback(new Blob([new Uint8Array(1024)], { type: type ?? "image/jpeg" }));
    } as never;

    render(<Fixture />);
    fireEvent.change(screen.getByLabelText("Upload location photos"), {
      target: { files: [new File([new Uint8Array(9 * 1024 * 1024)], "IMG_4821.jpg", { type: "image/jpeg" })] },
    });

    expect(await screen.findByText("Location photos (1/10)")).toBeInTheDocument();
    expect(screen.getByText("IMG_4821.jpg · Cover photo")).toBeInTheDocument();
    // Reported, but not as a problem: nothing here needs the person to act.
    expect(await screen.findByRole("status")).toHaveTextContent("resized 9.0 MB");
  });
});
