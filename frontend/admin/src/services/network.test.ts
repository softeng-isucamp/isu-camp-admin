import { describe, expect, it } from "vitest";
import { InvalidResponseError } from "./errors";
import {
  createCanonicalNetworkStore,
  validateNetworkSnapshot,
  validatePathway,
  normalizePathway,
  normalizeRouteNode,
  evaluateBuildingRoutability,
  filterPathwaysByMode,
  pathwayAllowsMode,
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
  it("adapts legacy tuples and associations at the boundary", () => {
    expect(normalizeRouteNode({ id: "entrance", name: "Main", nodeType: "Entrance", associatedPlaceId: "building", lat: 1, lng: 2 })).toMatchObject({
      type: "entrance", buildingId: "building", latitude: 1, longitude: 2,
    });
    expect(normalizePathway({
      id: "path", name: "Walk", sourceNodeId: "a", destinationNodeId: "b",
      pathPoints: [[1, 2]], shade: "Unknown",
      type: "", direction: "Unknown", status: "Unknown",
    })).toMatchObject({
      pathSequence: { points: [{ latitude: 1, longitude: 2 }] },
      shade: null, type: null,
      direction: null, status: "closed",
    });
    expect(normalizePathway({
      id: "legacy-open", name: "Legacy", sourceNodeId: "a", destinationNodeId: "b",
      pathPoints: [], shade: "Unknown", type: "Campus walkway", direction: "Two-way", status: "Open",
    })).toMatchObject({ type: "Walkway", status: "active", allowedModes: ["walking"] });
  });

  it("filters the shared graph independently for walking and vehicle travel", () => {
    const pathway = (id: string, status: "active" | "closed", allowedModes: ("walking" | "vehicle")[]) => ({
      id, name: id, sourceNodeId: "a", destinationNodeId: "b", pathSequence: { points: [] },
      type: "Walkway", shade: null,
      direction: "two_way" as const, status, allowedModes,
    });
    const pathways = [
      pathway("walk", "active", ["walking"]),
      pathway("road", "active", ["vehicle"]),
      pathway("shared", "active", ["walking", "vehicle"]),
    ];
    expect(filterPathwaysByMode(pathways, "walking").map((pathway) => pathway.id)).toEqual(["walk", "shared"]);
    expect(filterPathwaysByMode(pathways, "vehicle").map((pathway) => pathway.id)).toEqual(["road", "shared"]);
    expect(pathwayAllowsMode({ status: "closed", allowedModes: ["walking"] }, "walking")).toBe(false);
  });

  it("persists canonical writes and keeps ordered empty sequences", () => {
    const store = createCanonicalNetworkStore({
      buildings: [{ id: "b", name: "Building", code: "B", points: [[1, 1]], status: "Active" }],
      nodes: [
        { id: "a", name: "A", nodeType: "Junction", lat: 1, lng: 1 },
        { id: "b-node", name: "B", nodeType: "Access Point", lat: 2, lng: 2 },
      ],
      pathways: [{ id: "p", name: "Straight", sourceNodeId: "a", destinationNodeId: "b-node", pathPoints: [], shade: "Unknown", type: "Walkway", direction: "Two-way", status: "Open" }],
    }, null);
    const next = store.snapshot();
    next.pathways[0].name = "Renamed";
    store.save(next);
    expect(store.pathways()[0]).toMatchObject({ name: "Renamed", pathSequence: { points: [] } });
  });
});

describe("pathway validation wording", () => {
  const node = (id: string, status: "active" | "inactive" = "active") =>
    ({ id, name: id, type: "access_point" as const, buildingId: null, status, latitude: 16.72, longitude: 121.69 });
  const snapshot = (nodes = [node("a"), node("b")]) => ({
    buildings: [], routeNodes: nodes,
    pathways: [{
      id: "existing", name: "Main walk", sourceNodeId: "a", destinationNodeId: "b", pathSequence: { points: [] },
      type: "Walkway", shade: null, direction: "two_way" as const, status: "active" as const, allowedModes: ["walking" as const],
    }],
  });
  const draft = (changes: Record<string, unknown> = {}) => ({
    name: "New walk", sourceNodeId: "a", destinationNodeId: "b", pathSequence: { points: [] },
    type: "Walkway", shade: null, direction: "two_way" as const, status: "active" as const, allowedModes: ["walking" as const],
    ...changes,
  });

  it.each([
    ["inactive endpoint", { sourceNodeId: "a", destinationNodeId: "c" }, snapshot([node("a"), node("b"), node("c", "inactive")]), "Select two active route nodes to connect this pathway."],
    ["missing endpoint", { destinationNodeId: "gone" }, snapshot(), "One of the selected route nodes no longer exists. Reload the map and choose two route nodes."],
    ["same endpoint", { destinationNodeId: "a" }, snapshot(), "A pathway must connect two different route nodes."],
    ["duplicate connection", {}, snapshot(), "These route nodes are already connected by Main walk. Edit that pathway instead."],
    ["bad point", { destinationNodeId: "c", pathSequence: { points: [{ latitude: Number.NaN, longitude: 121.69 }] } }, snapshot([node("a"), node("c")]), "One of the pathway's points has an invalid position. Redraw that point and try again."],
    ["bad direction", { direction: "sideways" }, snapshot(), "Choose a direction: one-way or two-way."],
    ["bad status", { status: "paused" }, snapshot(), "Choose a status: active or closed."],
    ["bad way type", { type: "Trail" }, snapshot(), "Choose a way type: Walkway or Road."],
  ])("explains %s in plain words", (_name, changes, current, message) => {
    expect(() => validatePathway(draft(changes) as never, current as never)).toThrow(message);
  });

  it("keeps stored-data integrity failures out of the message", () => {
    const broken = { ...snapshot(), pathways: [{ ...snapshot().pathways[0], name: "  " }] };
    try {
      validateNetworkSnapshot(broken as never);
      throw new Error("Expected the snapshot to be rejected.");
    } catch (cause) {
      expect(cause).toBeInstanceOf(InvalidResponseError);
      expect((cause as InvalidResponseError).detail).toBe("Pathway existing must have a name.");
      expect((cause as InvalidResponseError).message).not.toContain("existing");
    }
  });
});
