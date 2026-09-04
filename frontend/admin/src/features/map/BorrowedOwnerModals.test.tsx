import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocationDetailsModal } from "../locations/LocationDetailsModal";
import type { Location } from "../../types";

const location: Location = {
  id: "loc-1",
  name: "Library Plaza",
  code: "LIB-PLZ",
  type: "Facility",
  parentId: null,
  function: "Outdoor gathering space",
  keywords: "library, plaza",
  status: "Active",
  lat: 16.7205,
  lng: 121.6895,
  positioned: true,
};

describe("borrowed owner module forms", () => {
  afterEach(cleanup);

  it("submits canonical Location details without changing spatial coordinates", () => {
    const onSubmit = vi.fn();
    render(
      <LocationDetailsModal
        location={location}
        directory={[location]}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Location name" }), { target: { value: "Main Library Plaza" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Location" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: "Main Library Plaza",
      lat: 16.7205,
      lng: 121.6895,
    }));
  });

});
