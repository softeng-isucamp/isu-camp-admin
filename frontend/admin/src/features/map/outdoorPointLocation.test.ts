import { describe, expect, it } from "vitest";
import type { Location } from "../../types";
import { validateOutdoorPointLocation } from "./outdoorPointLocation";

const boundary: [number, number][] = [[0, 0], [0, 10], [10, 10], [10, 0]];
const existing: Location[] = [{
  id: "location-1", name: "Existing", code: "FLAG", type: "Facility", status: "Active",
  parentId: null, lat: 5, lng: 5, positioned: true,
}];

const input = {
  name: "Campus Flagpole", code: "FLAGPOLE", description: "A landmark", keywords: "landmark", position: [5, 5] as [number, number],
};

describe("validateOutdoorPointLocation", () => {
  it("accepts a complete in-boundary outdoor point with a unique code", () => {
    expect(validateOutdoorPointLocation(input, existing, boundary)).toEqual([]);
  });

  it("rejects incomplete details, duplicate codes, non-finite coordinates, and outside points", () => {
    expect(validateOutdoorPointLocation({ ...input, name: "", code: " flag ", description: "", position: [NaN, 20] }, existing, boundary)).toEqual([
      { field: "name", message: "Location name is required." },
      { field: "description", message: "Description is required." },
      { field: "code", message: "Location code must be unique." },
      { field: "position", message: "A finite latitude and longitude are required." },
    ]);
    expect(validateOutdoorPointLocation({ ...input, position: [20, 5] }, existing, boundary)).toContainEqual({
      field: "position", message: "The point must be inside the ISU Echague campus boundary.",
    });
  });
});
