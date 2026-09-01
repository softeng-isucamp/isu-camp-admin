import { describe, expect, it } from "vitest";
import {
  createCanonicalNetworkStore,
  formatDistanceMeters,
  formatEstimatedTimeSeconds,
  normalizePathway,
  normalizeRouteNode,
  evaluateBuildingRoutability,
  parseDistanceMeters,
  parseEstimatedTimeSeconds,
} from "./network";

describe("canonical walking-network contract", () => {
  it("defines routability from Building state and active entrance associations", () => {
    const building = { id: "b", name: "Building", code: "B", geometry: [{ latitude: 1, longitude: 1 }, { latitude: 1, longitude: 2 }, { latitude: 2, longitude: 2 }], status: "active" as const };
    const entrance = { id: "entrance", name: "Main", type: "entrance" as const, buildingId: "b", status: "active" as const, latitude: 1, longitude: 1 };
    expect(evaluateBuildingRoutability(building, [entrance])).toEqual({ routable: true, reason: null, entranceIds: ["entrance"] });
    expect(evaluateBuildingRoutability({ ...building, status: "inactive" }, [entrance])).toMatchObject({ routable: false, reason: "inactive_building" });
    expect(evaluateBuildingRoutability(building, [{ ...entrance, status: "inactive" }])).toMatchObject({ routable: false, reason: "no_active_entrance" });
    expect(evaluateBuildingRoutability({ ...building, geometry: null }, [entrance])).toMatchObject({ routable: false, reason: "unpositioned_building" });
  });

  it("associates and clears an Entrance Route Node without replacing it", () => {
    const store = createCanonicalNetworkStore({
      buildings: [{ id: "b", name: "Building", code: "B", points: [[1, 1], [1, 2], [2, 2]], status: "Active" }],
      nodes: [{ id: "n", name: "Junction", nodeType: "Junction", lat: 1, lng: 1 }], pathways: [],
    }, null);
    const associated = store.associateEntrance("n", "b");
    expect(associated).toMatchObject({ id: "n", type: "entrance", buildingId: "b", latitude: 1, longitude: 1 });
    const cleared = store.clearEntranceAssociation("n");
    expect(cleared).toMatchObject({ id: "n", type: "access_point", buildingId: null, latitude: 1, longitude: 1 });
  });
  it("adapts legacy tuples, associations, and display metrics at the boundary", () => {
    expect(normalizeRouteNode({ id: "entrance", name: "Main", nodeType: "Entrance", associatedPlaceId: "building", lat: 1, lng: 2 })).toMatchObject({
      type: "entrance", buildingId: "building", latitude: 1, longitude: 2,
    });
    expect(normalizePathway({
      id: "path", name: "Walk", sourceNodeId: "a", destinationNodeId: "b",
      pathPoints: [[1, 2]], distance: "1.2 km", time: "2 min", shade: "Unknown",
      type: "", direction: "Unknown", status: "Unknown",
    })).toMatchObject({
      pathSequence: { points: [{ latitude: 1, longitude: 2 }] },
      distanceMeters: 1200, estimatedTimeSeconds: 120, shade: null, type: null,
      direction: null, status: "closed",
    });
  });

  it("uses named numeric transport values and a display-only formatter", () => {
    expect(parseDistanceMeters("48 m")).toBe(48);
    expect(parseEstimatedTimeSeconds("1 min")).toBe(60);
    expect(parseDistanceMeters("Unknown")).toBeNull();
    expect(formatDistanceMeters(48)).toBe("48 m");
    expect(formatEstimatedTimeSeconds(60)).toBe("1 min");
  });

  it("persists canonical writes and keeps ordered empty sequences", () => {
    const store = createCanonicalNetworkStore({
      buildings: [{ id: "b", name: "Building", code: "B", points: [[1, 1]], status: "Active" }],
      nodes: [
        { id: "a", name: "A", nodeType: "Junction", lat: 1, lng: 1 },
        { id: "b-node", name: "B", nodeType: "Access Point", lat: 2, lng: 2 },
      ],
      pathways: [{ id: "p", name: "Straight", sourceNodeId: "a", destinationNodeId: "b-node", pathPoints: [], distance: "—", time: "—", shade: "Unknown", type: "Walkway", direction: "Two-way", status: "Open" }],
    }, null);
    const next = store.snapshot();
    next.pathways[0].name = "Renamed";
    store.save(next);
    expect(store.pathways()[0]).toMatchObject({ name: "Renamed", pathSequence: { points: [] }, distanceMeters: null });
  });
});
