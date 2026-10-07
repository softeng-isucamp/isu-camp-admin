import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LocationDraft, LocationType } from "../../types";
import { LocationDetailsFields } from "./LocationDetailsModal";

afterEach(cleanup);

function Fixture({ type }: { type: LocationType }) {
  const [draft, setDraft] = useState<LocationDraft>({
    name: "Old Hall", code: "OLD", type, parentId: null,
    status: "Active", lat: null, lng: null, positioned: false,
  });
  return (
    <>
      <LocationDetailsFields draft={draft} statusEditable={false} onChange={setDraft} />
      <output>{draft.status}</output>
    </>
  );
}

describe("location details status field", () => {
  it("lets a Building be retired now that public.building.status persists it", () => {
    render(<Fixture type="Building" />);
    const status = screen.getByLabelText(/^status/i);

    expect(status).toBeEnabled();
    expect(screen.queryByText("Status is read-only until the backend persists lifecycle status.")).not.toBeInTheDocument();
    // Only the two values the column accepts; "Unknown" has nowhere to go.
    expect([...(status as HTMLSelectElement).options].map((option) => option.text)).toEqual(["Active", "Inactive"]);

    fireEvent.change(status, { target: { value: "Inactive" } });
    expect(screen.getByRole("status")).toHaveTextContent("Inactive");
  });

  it("keeps an Indoor Location's status read-only while public.location has no column", () => {
    render(<Fixture type="Room" />);

    expect(screen.getByLabelText(/^status/i)).toBeDisabled();
    expect(screen.getByText("Status is read-only until the backend persists lifecycle status.")).toBeInTheDocument();
  });
});
