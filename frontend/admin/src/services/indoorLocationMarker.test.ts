import { describe, expect, it } from "vitest";
import { createLocalAdapter } from "./localAdapter";
import type { Building, Location } from "../types";

const building: Building = {
  id: "building-1", name: "Library", code: "LIB", points: [
    [16.7200, 121.6890], [16.7200, 121.6900],
    [16.7210, 121.6900], [16.7210, 121.6890],
  ],
};

const room: Location = {
  id: "room-1", name: "Reading Room", code: "LIB-R1", type: "Room",
  parentId: building.id, building: building.name, floor: "Ground Floor",
  status: "Active", lat: null, lng: null, positioned: false,
};

describe("indoor marker storage", () => {
  it("positions and clears a room only within its own building footprint", () => {
    const adapter = createLocalAdapter({ locations: [{ ...room }], buildings: [building] }, null);

    expect(adapter.locations.saveIndoorPosition(room.id, building.id, 16.7205, 121.6895))
      .toMatchObject({ lat: 16.7205, lng: 121.6895, positioned: true });
    expect(() => adapter.locations.saveIndoorPosition(room.id, building.id, 16.725, 121.695))
      .toThrow(/inside.*Building footprint/);
    expect(() => adapter.locations.saveIndoorPosition(room.id, "other-building", 16.7205, 121.6895))
      .toThrow(/does not belong/);
    expect(adapter.locations.saveIndoorPosition(room.id, building.id, null, null))
      .toMatchObject({ lat: null, lng: null, positioned: false });
  });
});
