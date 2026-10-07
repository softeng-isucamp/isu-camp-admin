import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LocationDraft, LocationType } from "../../types";
import { LocationDetailsFields } from "./LocationDetailsModal";

afterEach(cleanup);

function Fixture({ type, statusPersistenceAvailable = false }: { type: LocationType; statusPersistenceAvailable?: boolean }) {
  const [draft, setDraft] = useState<LocationDraft>({
    name: "Old Hall", code: "OLD", type, parentId: null,
    status: "Active", lat: null, lng: null, positioned: false,
  });
  return (
    <>
      <LocationDetailsFields draft={draft} statusPersistenceAvailable={statusPersistenceAvailable} onChange={setDraft} />
      <output>{draft.status}</output>
    </>
  );
}

describe("location details status field", () => {
  it("lets a Building be retired now that public.building.status persists it", () => {
    render(<Fixture type="Building" />);
    const status = screen.getByLabelText(/^status/i);

    expect(status).toBeEnabled();
    expect(screen.queryByText("Indoor status changes are not saved yet. Saving resets status to Active.")).not.toBeInTheDocument();
    // Only the two values the column accepts; "Unknown" has nowhere to go.
    expect([...(status as HTMLSelectElement).options].map((option) => option.text)).toEqual(["Active", "Inactive"]);

    fireEvent.change(status, { target: { value: "Inactive" } });
    expect(screen.getByRole("status")).toHaveTextContent("Inactive");
  });

  it("allows an Indoor Location status change and explains that the backend cannot save it", () => {
    render(<Fixture type="Room" />);

    const status = screen.getByLabelText(/^status/i);
    expect(status).toBeEnabled();
    expect(screen.getByText("Indoor status changes are not saved yet. Saving resets status to Active.")).toBeInTheDocument();
    fireEvent.change(status, { target: { value: "Inactive" } });
    expect(screen.getByRole("status")).toHaveTextContent("Inactive");
  });

  it("omits the saving limitation when the fixture adapter persists Indoor Location status", () => {
    render(<Fixture type="Room" statusPersistenceAvailable />);

    expect(screen.queryByText("Indoor status changes are not saved yet. Saving resets status to Active.")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^status/i), { target: { value: "Inactive" } });
    expect(screen.getByRole("status")).toHaveTextContent("Inactive");
  });
});
