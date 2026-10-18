import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { placeClassificationOptions, withLocationTypeOption, type BackendLocationType } from "../../lib/locationPolicy";
import type { LocationDraft } from "../../types";
import { LocationDetailsFields } from "./LocationDetailsModal";

afterEach(cleanup);

function Fixture({ type }: { type: BackendLocationType }) {
  const [draft, setDraft] = useState<LocationDraft>(withLocationTypeOption({
    name: "Old Hall", code: "OLD", type: "Room", parentId: null,
    status: "Active", lat: null, lng: null, positioned: false,
  } as LocationDraft, type));
  return (
    <>
      <LocationDetailsFields draft={draft} onChange={setDraft} />
      <output>{draft.status}</output>
    </>
  );
}

describe("location details status field", () => {
  // public.building.status and public.location.status both persist the choice
  // now, so no type needs a caller's permission to edit it and no option is
  // offered that neither column can hold.
  it.each<BackendLocationType>(["Building", "Facility", "Room", "Laboratory", "Office", "Restroom"])(
    "lets a %s be retired and offers only the two stored values",
    (type) => {
      render(<Fixture type={type} />);
      const status = screen.getByLabelText(/^status/i);

      expect(status).toBeEnabled();
      expect([...(status as HTMLSelectElement).options].map((option) => option.text)).toEqual(["Active", "Inactive"]);

      fireEvent.change(status, { target: { value: "Inactive" } });
      expect(screen.getByRole("status")).toHaveTextContent("Inactive");

      fireEvent.change(status, { target: { value: "Active" } });
      expect(screen.getByRole("status")).toHaveTextContent("Active");
    },
  );

  it("no longer warns that an Indoor Location's status cannot be saved", () => {
    render(<Fixture type="Room" />);

    expect(screen.queryByText(/not saved yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/read-only/i)).not.toBeInTheDocument();
  });
});

describe("location type picker for a legacy classification", () => {
  const legacyDraft = () => withLocationTypeOption({
    name: "Old Hall", code: "OLD", type: "Room", parentId: null,
    status: "Active", lat: null, lng: null, positioned: false,
  } as LocationDraft, "Building");

  it("shows the legacy value as Unclassified (legacy), keeps it, and badges the field", () => {
    render(<LocationDetailsFields draft={legacyDraft()} allowedTypes={placeClassificationOptions("Building")} onChange={() => {}} />);
    const select = screen.getByLabelText(/^location type/i) as HTMLSelectElement;
    expect(select.value).toBe("Building");
    expect([...select.options].map((option) => option.text)).toEqual([
      "College", "Campus Services", "Food", "Parking", "Facility", "Unclassified (legacy)",
    ]);
    expect(screen.getByText("Unclassified")).toBeInTheDocument();
  });

  it("never offers Building by default, and shows no badge for a classified Place", () => {
    const draft = withLocationTypeOption(legacyDraft(), "College");
    render(<LocationDetailsFields draft={draft} onChange={() => {}} />);
    const select = screen.getByLabelText(/^location type/i) as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).not.toContain("Building");
    expect(screen.queryByText("Unclassified")).not.toBeInTheDocument();
  });

  it("disables the given types and shows a backend error on the field", () => {
    const draft = withLocationTypeOption(legacyDraft(), "College");
    render(<LocationDetailsFields draft={draft} disabledTypes={["Food"]} errors={{ type: "Not allowed." }} onChange={() => {}} />);
    const select = screen.getByLabelText(/^location type/i) as HTMLSelectElement;
    expect([...select.options].find((option) => option.value === "Food")).toBeDisabled();
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Not allowed.")).toBeInTheDocument();
  });
});
