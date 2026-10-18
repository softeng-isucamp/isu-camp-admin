import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { services } from "../../services/api";
import type { Location } from "../../types";
import { LocationDetailsModal } from "./LocationDetailsModal";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const place = (classification: Location["classification"]): Location => ({
  id: "place-1", name: "Hall", code: "HALL", type: "Place", classification, parentId: null,
  function: "Teaching", status: "Active", lat: null, lng: null, positioned: false,
});
const room: Location = {
  id: "room-1", name: "Room 101", code: "R101", type: "Room", parentId: "place-1", building: "Hall", floor: "Ground Floor",
  function: "Class", status: "Active", lat: null, lng: null, positioned: false,
};

function renderModal(location: Location, directory: Location[], onSubmit = vi.fn()) {
  vi.spyOn(services.locations, "getPhotos").mockResolvedValue([]);
  render(<LocationDetailsModal location={location} directory={directory} onClose={() => {}} onSubmit={onSubmit} />);
  return { onSubmit, select: screen.getByLabelText(/^location type/i) as HTMLSelectElement };
}

describe("LocationDetailsModal classification", () => {
  it("keeps a legacy Place as Unclassified (legacy) through a save", async () => {
    const { select, onSubmit } = renderModal(place("Building"), []);
    expect(screen.getByText("Unclassified")).toBeInTheDocument();
    expect(select).toHaveValue("Building");
    expect([...select.options].at(-1)?.text).toBe("Unclassified (legacy)");

    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ type: "Place", classification: "Building" });
  });

  it("blocks leaf classifications for a Place holding indoor Locations but allows College and Campus Services", async () => {
    const { select, onSubmit } = renderModal(place("College"), [place("College"), room]);
    const disabled = [...select.options].filter((option) => option.disabled).map((option) => option.text);
    expect(disabled).toEqual(["Food", "Parking", "Facility"]);
    expect(screen.getByText("Move or delete its 1 indoor Location before classifying it as Food, Parking, or Facility.")).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "Campus Services" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ classification: "Campus Services" });
  });

  it("refuses a forbidden classification on save, naming why, without calling onSubmit", async () => {
    const { select, onSubmit } = renderModal(place("College"), [place("College"), room]);
    // Bypass the disabled option the way a stale or scripted change could.
    fireEvent.change(select, { target: { value: "Parking" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));

    const message = "Move or delete its 1 indoor Location before classifying it as Food, Parking, or Facility.";
    expect(await screen.findAllByText(message, { selector: ".field-error-msg" })).toHaveLength(1);
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("associates the helper and error text with the select", () => {
    const { select } = renderModal(place("College"), [place("College"), room]);
    const helperId = select.getAttribute("aria-describedby")!;
    expect(document.getElementById(helperId)).toHaveTextContent(/Move or delete its 1 indoor Location/);
  });

  it("counts only indoor Locations, so a Place with just a compatibility Floor can be reclassified", async () => {
    const floor: Location = { ...room, id: "floor-1", name: "Ground Floor", code: "F1", type: "Floor" };
    const { select, onSubmit } = renderModal(place("College"), [place("College"), floor]);
    expect([...select.options].some((option) => option.disabled)).toBe(false);

    fireEvent.change(select, { target: { value: "Parking" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ classification: "Parking" });
  });

  it("does not block a Place with no indoor Locations", () => {
    const { select } = renderModal(place("Facility"), [place("Facility")]);
    expect([...select.options].some((option) => option.disabled)).toBe(false);
  });

  it("shows a backend type error on the classification field", async () => {
    const refusal = Object.assign(new Error("Invalid type."), { fieldErrors: { type: "Classification is not allowed." } });
    const { select } = renderModal(place("College"), [place("College")], vi.fn().mockRejectedValue(refusal));
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));

    expect(await screen.findByText("Classification is not allowed.", { selector: ".field-error-msg" })).toBeInTheDocument();
    expect(select).toHaveAttribute("aria-invalid", "true");
  });
});
