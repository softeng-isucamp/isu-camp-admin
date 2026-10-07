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
      <LocationDetailsFields draft={draft} onChange={setDraft} />
      <output>{draft.status}</output>
    </>
  );
}

describe("location details status field", () => {
  // public.building.status and public.location.status both persist the choice
  // now, so no type is read-only and no option is offered that neither column
  // can hold.
  it.each<LocationType>(["Building", "Facility", "Room", "Laboratory", "Office", "Restroom"])(
    "lets a %s be retired and offers only the two stored values",
    (type) => {
      render(<Fixture type={type} />);
      const status = screen.getByLabelText(/^status/i);

      expect(status).toBeEnabled();
      expect([...(status as HTMLSelectElement).options].map((option) => option.text)).toEqual(["Active", "Inactive"]);

      fireEvent.change(status, { target: { value: "Inactive" } });
      expect(screen.getByRole("status")).toHaveTextContent("Inactive");
    },
  );

  it("no longer explains the field away as read-only", () => {
    render(<Fixture type="Room" />);

    expect(screen.queryByText(/read-only until the backend persists lifecycle status/i)).not.toBeInTheDocument();
  });
});
