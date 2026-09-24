import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LocationPhotoDraft } from "../../types";
import { LocationPhotoUpload } from "./LocationPhotoUpload";

afterEach(cleanup);

function Fixture() {
  const [photos, setPhotos] = useState<LocationPhotoDraft[]>([]);
  return <LocationPhotoUpload photos={photos} onChange={setPhotos} />;
}

describe("location photo upload", () => {
  it("keeps the chooser beside a collapsed gallery toggle and adds multiple photos", () => {
    render(<Fixture />);
    expect(screen.getByRole("button", { name: "Choose photos" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Show all photos" })).toHaveAttribute("aria-expanded", "false");

    fireEvent.change(screen.getByLabelText("Upload location photos"), {
      target: { files: [
        new File(["first"], "front.png", { type: "image/png" }),
        new File(["second"], "side.jpg", { type: "image/jpeg" }),
      ] },
    });

    expect(screen.getByText("Location photos (2/10)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Minimize photos" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("front.png · Cover photo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Make side.jpg cover photo" }));
    expect(screen.getByText("side.jpg · Cover photo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Minimize photos" }));
    expect(screen.getByRole("button", { name: "Choose photos" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Show all photos" })).toHaveAttribute("aria-expanded", "false");
  });

  it("accepts valid images in a mixed drop and reports rejected files", () => {
    render(<Fixture />);
    fireEvent.drop(screen.getByRole("region", { name: "Location photos" }), {
      dataTransfer: { files: [
        new File(["photo"], "entrance.webp", { type: "image/webp" }),
        new File(["document"], "notes.pdf", { type: "application/pdf" }),
      ] },
    });
    expect(screen.getByText("Location photos (1/10)")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("notes.pdf: use PNG, JPEG, or WebP");
  });
});
