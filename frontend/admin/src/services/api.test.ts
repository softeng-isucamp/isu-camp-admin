import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeBackendDashboardAnalytics,
  normalizeBackendDashboardSummary,
  normalizeBackendUser,
  normalizeBackendLocationPage,
  services,
  setMockFailure,
} from "./api";
import { resetPasswordSchema, resetSchema } from "./schemas";
import { indoorLocationTypes } from "../lib/locationPolicy";
import { createLocalAdapter } from "./localAdapter";
import { generateDashboardAnalytics } from "./fixtures/dashboardAnalytics";
import type { Location } from "../types";

describe("mock service contracts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("authenticates the seeded administrator", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ admin: { id: "1", username: "admin01" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Invalid username or password" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      );

    await expect(
      httpServices.auth.login("admin_justine", "password123"),
    ).resolves.toEqual({ id: "1", username: "admin01" });
    await expect(httpServices.auth.login("wrong", "password123")).rejects.toThrow(
      "Invalid username or password",
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ username: "admin_justine", password: "password123" }),
      }),
    );
    vi.unstubAllEnvs();
  });

  it("normalizes the documented backend page and rejects malformed responses", () => {
    expect(normalizeBackendLocationPage({
      data: {
        items: [{
          location_id: 42,
          location_name: "Backend Library",
          location_code: "LIB-01",
          type_id: 4,
          building_id: null,
          floor_level: null,
          description: "A persisted facility",
          keywords: "books",
          lat: "16.7215",
          lng: 121.6895,
        }],
        total: 1,
        page: 2,
        pageSize: 10,
      },
    })).toEqual({
      items: [{
        id: "42",
        name: "Backend Library",
        code: "LIB-01",
        type: "Facility",
        parentId: null,
        status: "Active",
        lat: 16.7215,
        lng: 121.6895,
        positioned: true,
        function: "A persisted facility",
        keywords: "books",
      }],
      total: 1,
      page: 2,
      pageSize: 10,
    });

    expect(() => normalizeBackendLocationPage({ items: [], total: 0 })).toThrow(
      "Backend returned a malformed locations page.",
    );
    expect(() => normalizeBackendLocationPage({
      items: [{ id: "bad", name: "Missing code", type: "Facility" }],
      total: 1,
      page: 1,
      pageSize: 20,
    })).toThrow("Backend returned a malformed location record.");
  });

  it("normalizes persisted location type IDs without inferring Building or Floor", () => {
    const persistedTypes = [
      [1, "Room"],
      [2, "Laboratory"],
      [3, "Office"],
      [4, "Facility"],
      [5, "Restroom"],
    ] as const;

    for (const [type_id, type] of persistedTypes) {
      expect(normalizeBackendLocationPage({
        items: [{ id: type_id, name: "Persisted location", code: "PERSISTED", type_id }],
        total: 1,
        page: 1,
        pageSize: 10,
      }).items[0].type).toBe(type);
    }

    expect(normalizeBackendLocationPage({
      items: [{ id: "string-type", name: "String location", code: "STRING", type: "Building" }],
      total: 1,
      page: 1,
      pageSize: 10,
    }).items[0].type).toBe("Building");

    for (const type_id of [6, 7, 8]) {
      expect(() => normalizeBackendLocationPage({
        items: [{ id: type_id, name: "Obsolete location", code: "OBSOLETE", type_id }],
        total: 1,
        page: 1,
        pageSize: 10,
      })).toThrow("Backend returned a malformed location record.");
    }
  });

  it("uses only the real service response for list data and preserves pagination", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      items: [], total: 0, page: 3, pageSize: 7,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(httpServices.locations.list("missing", 3, 7)).resolves.toEqual({
      items: [], total: 0, page: 3, pageSize: 7,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/locations?page=3&pageSize=7&q=missing",
      expect.objectContaining({ credentials: "include" }),
    );

    fetchMock.mockRejectedValueOnce(new Error("backend unavailable"));
    await expect(httpServices.locations.list()).rejects.toThrow("backend unavailable");
    vi.unstubAllEnvs();
  });

  it("loads location history from the real backend by target id", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        items: [{
          id: 17,
          actor: "admin01",
          action: "update",
          target: "Engineering Hall",
          target_id: "4",
          detail: "Engineering Hall",
          created_at: "2026-09-20T01:02:03Z",
          category: "Admin",
        }],
        total: 1,
        page: 1,
        pageSize: 20,
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    await expect(httpServices.logs.forLocation("4", "Engineering Hall")).resolves.toMatchObject({
      items: [expect.objectContaining({ action: "update", targetId: "4" })],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/locations/4/history",
      expect.objectContaining({ credentials: "include" }),
    );
    vi.unstubAllEnvs();
  });

  it("filters locations through the service boundary", async () => {
    const result = await services.locations.list("computer lab");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("Computer Laboratory Building");
  });

  it("ships a representative indoor directory with metadata-owned floor levels", async () => {
    const inventory = (await services.locations.list()).items;
    const indoor = inventory.filter((location) =>
      indoorLocationTypes.includes(location.type as typeof indoorLocationTypes[number]),
    );

    expect(indoor.length).toBeGreaterThanOrEqual(15);
    expect(new Set(indoor.map((location) => location.parentId)).size).toBeGreaterThanOrEqual(3);
    expect(indoor.every((location) => location.parentId && location.floor && location.lat === null && location.lng === null && !location.positioned)).toBe(true);
    expect(new Set(indoor.map((location) => location.floor)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(indoor.map((location) => location.type))).toEqual(new Set(indoorLocationTypes));
  });

  it("returns the dashboard metric counts through the service boundary", async () => {
    const summary = await services.dashboard.summary();
    expect(summary.locations).toBeGreaterThan(0);
    expect(summary.pathways).toBeGreaterThan(0);
    expect(summary.topSearched).toHaveLength(0);
  });

  it("validates recovery code and password requirements", () => {
    expect(
      resetSchema.safeParse({ code: "123", password: "short" }).success,
    ).toBe(false);
    expect(
      resetSchema.safeParse({ code: "000000", password: "password123" })
        .success,
    ).toBe(false);
    expect(
      resetSchema.safeParse({ code: "000000", password: "Passw0rd!x" })
        .success,
    ).toBe(true);
    expect(
      resetPasswordSchema.safeParse({
        code: "000000",
        password: "Passw0rd!x",
        confirmPassword: "Different1!",
      }).success,
    ).toBe(false);
  });

  it("persists map geometry edits through the service boundary", async () => {
    const nodes = await services.map.nodes();
    const node = nodes[0];
    const next: [number, number] = [node.lat + 0.0001, node.lng + 0.0001];
    await services.map.save({
      selected: { type: "node", id: node.id },
      place: next,
    });
    expect(
      (await services.map.nodes()).find((item) => item.id === node.id),
    ).toMatchObject({ lat: next[0], lng: next[1] });
  });

  it("makes a newly saved Building footprint available to a fresh map read", async () => {
    const polygon: [number, number][] = [
      [16.7201, 121.6891],
      [16.7201, 121.6894],
      [16.7204, 121.6894],
    ];

    const saved = await services.locations.save({
      id: "local-footprint-building",
      name: "Local Footprint Building",
      code: "LOCAL-FOOTPRINT",
      type: "Building",
      parentId: null,
      status: "Active",
      lat: null,
      lng: null,
      positioned: false,
      polygonCoordinates: polygon,
    });

    expect((await services.map.buildings()).find((building) => building.id === saved.id))
      .toMatchObject({
        id: saved.id,
        name: "Local Footprint Building",
        code: "LOCAL-FOOTPRINT",
        type: "Building",
        points: polygon,
        status: "Active",
      });
  });

  it("persists a location position through the narrow position seam", async () => {
    const location = (await services.locations.list()).items[0];
    const next = { lat: 16.7215, lng: 121.6895 };
    await services.locations.savePosition({ id: location.id, ...next });
    expect((await services.locations.list()).items.find((item) => item.id === location.id)).toMatchObject({
      ...next,
      positioned: true,
    });
  });

  it("preserves hierarchical child locations and permanently deletes families", async () => {
    const building = await services.locations.save({
      id: "ticket-01-building", name: "Ticket 01 Building", code: "T01-B", type: "Building",
      parentId: null, status: "Active", lat: 16.72, lng: 121.69, positioned: true,
    });
    const room = await services.locations.save({
      id: "ticket-01-room", name: "Ticket 01 Room", code: "T01-R", type: "Room",
      parentId: building.id, floor: "2nd Floor", status: "Active", lat: null, lng: null, positioned: false,
    });

    expect((await services.locations.list()).items.find((item) => item.id === room.id)).toMatchObject({
      parentId: building.id, floor: "2nd Floor", lat: null, lng: null, positioned: false,
    });

    await services.locations.remove(building.id);
    const persistedBuilding = (await services.locations.list()).items.find((item) => item.id === building.id);
    expect(persistedBuilding).toBeUndefined();
    expect((await services.locations.list()).items.find((item) => item.id === room.id)).toBeUndefined();
    expect((await services.logs.forLocation(building.id)).items[0]).toMatchObject({
      action: "Deleted Location", targetId: building.id, target: building.name,
    });
  });

  it("keeps map-building compatibility behavior and records an exact-ID audit entry", async () => {
    const building = {
      id: "ticket-01-map-building",
      name: "Map Building",
      code: "MAP-BLDG",
      points: [[16.72, 121.69], [16.721, 121.69], [16.72, 121.691]] as [number, number][],
      status: "Active" as const,
    };

    await services.map.save({ buildings: [building] });
    await services.map.removeBuilding(building.id);

    expect((await services.map.buildings()).find((item) => item.id === building.id)).toMatchObject({
      status: "Inactive",
    });
    expect((await services.logs.forLocation(building.id)).items[0]).toMatchObject({
      action: "Removed Building",
      target: building.name,
      targetId: building.id,
    });
  });

  it("rejects positioned child locations", async () => {
    await expect(services.locations.save({
      id: "positioned-child", name: "Positioned", code: "POS", type: "Office", parentId: "building",
      floor: "1st Floor", status: "Active", lat: 16.72, lng: 121.69, positioned: true,
    })).rejects.toThrow();
  });

  it("persists a drawn map area only when it has a valid polygon", async () => {
    const before = (await services.map.buildings()).length;
    await services.map.save({
      areaPoints: [
        [1, 1],
        [1, 2],
      ],
    });
    expect((await services.map.buildings()).length).toBe(before);
    await services.map.save({
      areaPoints: [
        [1, 1],
        [1, 2],
        [2, 2],
      ],
    });
    expect((await services.map.buildings()).length).toBe(before + 1);
  });

  it("filters logs by actor and date through the service boundary", async () => {
    const result = await services.logs.list(
      "Admin",
      "",
      "admin01",
      "Aug 17, 2026",
    );
    expect(
      result.items.every(
        (entry) =>
          entry.actor === "admin01" && entry.createdAt.includes("Aug 17, 2026"),
      ),
    ).toBe(true);
    expect(result.total).toBe(result.items.length);
  });

  it("enforces unique codes when the local adapter creates a new location", () => {
    const adapter = createLocalAdapter({
      locations: [{
        id: "building-1",
        name: "Building One",
        code: "BUILDING-ONE",
        type: "Building",
        parentId: null,
        status: "Active",
        lat: null,
        lng: null,
        positioned: false,
      }, {
        id: "existing-room",
        name: "Existing Room",
        code: "DUPLICATE-CODE",
        type: "Room",
        parentId: "building-1",
        building: "Building One",
        floor: "Ground Floor",
        status: "Active",
        lat: null,
        lng: null,
        positioned: false,
      }],
      buildings: [],
      nodes: [],
      pathways: [],
    }, null);

    expect("map" in adapter).toBe(false);

    expect(() => adapter.locations.save({
      name: "New Room",
      code: "duplicate-code",
      type: "Room",
      parentId: "building-1",
      building: "Building One",
      floor: "Ground Floor",
      status: "Active",
      lat: null,
      lng: null,
      positioned: false,
    })).toThrow("Location code must be unique.");
  });

  it("keeps legacy indoor records without a floor under Unspecified Floor", async () => {
    const legacy = await services.locations.save({
      id: "legacy-unspecified-floor", name: "Legacy Unspecified Room", code: "LEGACY-UNSPECIFIED",
      type: "Room", parentId: "osm-location-c5fb7a267a8ca63d", status: "Active",
      lat: null, lng: null, positioned: false,
    });
    expect(legacy.floor).toBeUndefined();
    expect((await services.locations.list("Legacy Unspecified Room")).items[0]).toMatchObject({
      id: legacy.id,
      parentId: "osm-location-c5fb7a267a8ca63d",
    });
  });

  it("permanently deletes a building, its connected children, and audits each record", async () => {
    const building = await services.locations.save({ id: "deleted-building", name: "Deleted Building", code: "DELETED-BLDG", type: "Building", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    const child = await services.locations.save({ id: "deleted-room", name: "Deleted Room", code: "DELETED-ROOM", type: "Room", parentId: building.id, building: building.name, floor: "2nd Floor", status: "Active", lat: null, lng: null, positioned: false });

    await services.locations.remove(building.id);

    expect((await services.locations.list()).items.some((item) => item.id === building.id || item.id === child.id)).toBe(false);
    expect((await services.logs.forLocation(building.id)).items[0]).toMatchObject({ action: "Deleted Location", targetId: building.id });
    expect((await services.logs.forLocation(child.id)).items[0]).toMatchObject({ action: "Deleted Location", targetId: child.id });
  });

  it("cascades only the Indoor Locations directly owned by the deleted Building", async () => {
    const first = await services.locations.save({ id: "same-name-building-a", name: "Duplicate Name Building", code: "DUP-A", type: "Building", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    const second = await services.locations.save({ id: "same-name-building-b", name: "Duplicate Name Building", code: "DUP-B", type: "Building", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    const firstChild = await services.locations.save({ id: "same-name-room-a", name: "Room A", code: "DUP-A-ROOM", type: "Room", parentId: first.id, building: first.name, floor: "Ground Floor", status: "Active", lat: null, lng: null, positioned: false });
    const secondChild = await services.locations.save({ id: "same-name-room-b", name: "Room B", code: "DUP-B-ROOM", type: "Room", parentId: second.id, building: second.name, floor: "Ground Floor", status: "Active", lat: null, lng: null, positioned: false });

    await services.locations.remove(first.id);

    const remaining = (await services.locations.list()).items;
    expect(remaining.some((item) => item.id === first.id || item.id === firstChild.id)).toBe(false);
    expect(remaining.some((item) => item.id === second.id || item.id === secondChild.id)).toBe(true);
  });

  it("associates save and position audits exactly while keeping targets readable", async () => {
    const precise = await services.locations.save({ id: "audit-exact", name: "Exact Hall", code: "EXACT", type: "Facility", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ id: "audit-substring", name: "Exact Hall Annex", code: "ANNEX", type: "Facility", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.savePosition({ id: precise.id, lat: 16.72, lng: 121.69 });
    const history = await services.logs.forLocation(precise.id, precise.name);
    expect(history.items.map((entry) => entry.action)).toEqual(expect.arrayContaining(["Updated Location", "Positioned Location"]));
    expect(history.items.every((entry) => entry.target === precise.name && entry.targetId === precise.id)).toBe(true);
    expect(history.items.some((entry) => entry.target === "Exact Hall Annex")).toBe(false);
  });

  it("retains exact audit linkage through a rename", async () => {
    const original = await services.locations.save({ id: "renamed-audit", name: "Original audit name", code: "RENAME", type: "Facility", parentId: null, status: "Active", lat: null, lng: null, positioned: false });
    await services.locations.save({ ...original, name: "Renamed audit name" });
    const history = await services.logs.forLocation(original.id, "Renamed audit name");
    expect(history.items).toHaveLength(2);
    expect(history.items.map((entry) => entry.target)).toEqual(expect.arrayContaining(["Original audit name", "Renamed audit name"]));
    expect(history.items.every((entry) => entry.targetId === original.id)).toBe(true);
  });

  it("exposes injectable location save failures", async () => {
    const location = (await services.locations.list()).items[0];
    setMockFailure("locationSave", true);
    await expect(services.locations.save(location)).rejects.toThrow(
      "Mock locationSave failed",
    );
    setMockFailure("locationSave", false);
  });

  it("rejects malformed CRUD payloads before mutating mock data", async () => {
    const locationsBefore = (await services.locations.list()).total;
    await expect(
      services.locations.save({ id: "bad" } as never),
    ).rejects.toThrow();
    expect((await services.locations.list()).total).toBe(locationsBefore);

  });

  it("accepts unpositioned location drafts and rejects partial coordinates", async () => {
    const created = await services.locations.save({
      name: "Unpositioned Facility",
      code: "UNP-01",
      type: "Facility",
      parentId: null,
      status: "Active",
      lat: null,
      lng: null,
      positioned: false,
    });
    expect(created).toMatchObject({ lat: null, lng: null, positioned: false });
    await expect(services.locations.save({ ...created, lat: 16.72, lng: null })).rejects.toThrow();
  });

  it("persists new route nodes, moved locations, and updated path shapes", async () => {
    const nodeName = `Test Gate ${Date.now()}`;
    await services.map.save({
      newNode: {
        name: nodeName,
        nodeType: "Access Point",
        lat: 16.1234,
        lng: 121.5678,
      },
    });
    const nodes = await services.map.nodes();
    expect(nodes.some((n) => n.name === nodeName)).toBe(true);

    const locations = await services.map.locations();
    const targetLoc = locations.find((location) => location.type === "Facility" && location.parentId === null)!;
    await services.map.save({
      movedLocation: {
        id: targetLoc.id,
        lat: 16.9999,
        lng: 121.9999,
      },
    });
    const updatedLocations = await services.map.locations();
    const locResult = updatedLocations.find((l) => l.id === targetLoc.id);
    expect(locResult?.lat).toBe(16.9999);
    expect(locResult?.positioned).toBe(true);

    const pathways = await services.map.pathways();
    const targetPath = pathways[0];
    const newPoints: [number, number][] = [[16.1, 121.1], [16.2, 121.2]];
    await services.map.save({
      updatedPath: {
        id: targetPath.id,
        pathPoints: newPoints,
      },
    });
    const updatedPathways = await services.map.pathways();
    const pathResult = updatedPathways.find((p) => p.id === targetPath.id);
    expect(pathResult?.pathPoints).toEqual(newPoints);
  });
});

describe("real dashboard service boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("requests the selected range and normalizes the dashboard response", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const response = {
      buildings: 12,
      buildingChange: 2,
      indoorLocations: 34,
      users: 56,
      locations: 98,
      pathways: 21,
      searches: 55,
      topSearched: [{ rank: "1", locationId: "42", name: "Library", context: "Student Services", searches: 18 }],
      recent: [{ id: "7", actor: "admin01", action: "update", target: "Library", createdAt: "2026-09-12T08:30:00Z", category: "Admin" }],
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: response }), { status: 200 }),
    );

    await expect(httpServices.dashboard.summary("month")).resolves.toEqual({ ...response, usersByType: null });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard?range=month",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("rejects malformed dashboard data before it reaches the UI", () => {
    expect(() => normalizeBackendDashboardSummary({ buildings: "12" }))
      .toThrow("Backend returned a malformed dashboard summary.");
  });
});

describe("real locations service boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("maps database-shaped location rows and sends pagination parameters", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        items: [{ location_id: 42, location_name: "Room 204", location_code: "ENG-204", type_id: 1, building: "Engineering Hall", floor: "2nd Floor", description: "Teaching room", keywords: "lecture" }],
        total: 1, page: 2, pageSize: 10,
      }), { status: 200 }),
    );

    await expect(httpServices.locations.list("LECTURE", 2, 10)).resolves.toEqual({
      items: [expect.objectContaining({ id: "42", name: "Room 204", type: "Room", parentId: null, status: "Active", lat: null, lng: null, positioned: false })],
      total: 1, page: 2, pageSize: 10,
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/locations?page=2&pageSize=10&q=LECTURE", expect.objectContaining({ credentials: "include" }));
    vi.unstubAllEnvs();
  });

  it("sends directory filters to the real backend", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [], total: 0, page: 3, pageSize: 10 }), { status: 200 }),
    );

    await httpServices.locations.list("lab", 3, 10, {
      type: "Laboratory", status: "Active", buildingId: "4", floor: "2nd Floor",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/locations?page=3&pageSize=10&q=lab&type=Laboratory&status=Active&buildingId=4&floor=2nd+Floor",
      expect.objectContaining({ credentials: "include" }),
    );
    vi.unstubAllEnvs();
  });

  it("rejects malformed location pages and preserves authentication errors", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, message: "Authentication required" }), { status: 401 }));
    await expect(httpServices.locations.list()).rejects.toThrow("malformed locations page");
    await expect(httpServices.locations.list()).rejects.toThrow("Authentication required");
    vi.unstubAllEnvs();
  });

  it("rejects malformed or inconsistent coordinate state", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ id: "7", name: "Water Station", code: "WATER", type: "Facility", lat: "north", lng: 121.69, positioned: true }],
        total: 1, page: 1, pageSize: 20,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ id: "8", name: "Gate", code: "GATE", type: "Facility", lat: null, lng: null, positioned: true }],
        total: 1, page: 1, pageSize: 20,
      }), { status: 200 }));

    await expect(httpServices.locations.list()).rejects.toThrow("malformed location coordinates");
    await expect(httpServices.locations.list()).rejects.toThrow("inconsistent location position");
    vi.unstubAllEnvs();
  });

  it("maps create requests and unwraps normalized mutation responses", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const saved = { id: "42", name: "Room 204", code: "ENG-204", type: "Room", parentId: "1", building: "Engineering Hall", floor: "2nd Floor", function: "Teaching room", keywords: "lecture", status: "Active", lat: null, lng: null, positioned: false } as const;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ location: saved }), { status: 201 }));

    await expect(httpServices.locations.save({ ...saved, id: undefined })).resolves.toEqual(saved);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/locations", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: saved.name, code: saved.code, type: saved.type, parentId: saved.parentId, building: saved.building, floor: saved.floor, function: saved.function, keywords: saved.keywords, status: saved.status }) }));
  });

  it("saves an indoor marker through its Building scoped endpoint", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const saved = {
      id: "8", name: "Reading Room", code: "LIB-R1", type: "Room",
      parentId: "42", building: "Library", floor: "Ground Floor",
      status: "Active", lat: 16.7205, lng: 121.6895, positioned: true,
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(saved), { status: 200 }),
    );

    await expect(httpServices.locations.saveIndoorPosition({
      id: "8", buildingId: "42", lat: 16.7205, lng: 121.6895,
    })).resolves.toMatchObject(saved);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/map/buildings/42/indoor-locations/8",
      expect.objectContaining({
        method: "PATCH", credentials: "include",
        body: JSON.stringify({ lat: 16.7205, lng: 121.6895 }),
      }),
    );
  });

  it("creates a Building through the canonical locations endpoint without a client id", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const saved = { id: "42", name: "Engineering Hall", code: "ENG-01", type: "Building", parentId: null, function: "Academic building", keywords: "engineering", status: "Active", lat: null, lng: null, positioned: false } as const;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ location: saved }), { status: 201 }));

    await expect(httpServices.locations.save({ ...saved, id: undefined })).resolves.toEqual(saved);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/locations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: saved.name, code: saved.code, type: saved.type, parentId: null, function: saved.function, keywords: saved.keywords, status: saved.status }),
      }),
    );
    vi.unstubAllEnvs();
  });

  it("updates existing locations through the actions endpoint", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const saved = { id: "42", name: "Room 204", code: "ENG-204", type: "Room", parentId: "1", status: "Active", lat: null, lng: null, positioned: false } as const;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(saved), { status: 200 }),
    );

    await expect(httpServices.locations.save(saved)).resolves.toEqual(saved);
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/api\/actions\/locations\/42\?type=Room$/);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: "PUT", body: JSON.stringify({ name: saved.name, code: saved.code, type: saved.type, parentId: saved.parentId, status: saved.status }) }));
  });

  it("deletes locations through the actions endpoint", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    await expect(httpServices.locations.remove("42", "Room")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/api\/actions\/locations\/42\?type=Room$/);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: "DELETE" }));
  });

  it("preserves backend validation details for the form", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: "Location validation failed.", fields: { floor: "A Floor Level is required." } }), { status: 400 }));
    const error = await httpServices.locations.save({ name: "Room", code: "R", type: "Room", parentId: "1", status: "Active", lat: null, lng: null, positioned: false }).catch((cause) => cause);
    expect(error).toMatchObject({ message: "Location validation failed.", fieldErrors: { floor: "A Floor Level is required." } });
    vi.unstubAllEnvs();
  });

  it("uploads photos as multipart when creating a location", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "42", name: "Room 204", code: "ROOM-204", type: "Room", parentId: "1", floor: "2nd Floor", status: "Active", lat: null, lng: null, positioned: false, hasPhoto: true }), { status: 201 }));

    const saved = await httpServices.locations.save({
      name: "Room 204", code: "ROOM-204", type: "Room", parentId: "1", floor: "2nd Floor",
      status: "Active", lat: null, lng: null, positioned: false,
      photo: { name: "library.png", type: "image/png", dataUrl: "data:image/png;base64,cGhvdG8=" },
    });
    expect(saved).toMatchObject({ id: "42", hasPhoto: true });
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.body).toBeInstanceOf(FormData);
    expect((request?.body as FormData).get("photo")).toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("submits multiple location photos with the chosen cover", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "42", name: "Room 204", code: "ROOM-204", type: "Room", parentId: "1", status: "Active", lat: null, lng: null, positioned: false, hasPhoto: true }), { status: 201 }),
    );
    const first = new File(["front"], "front.png", { type: "image/png" });
    const second = new File(["side"], "side.jpg", { type: "image/jpeg" });
    await httpServices.locations.save({ name: "Room 204", code: "ROOM-204", type: "Room", parentId: "1", status: "Active", lat: null, lng: null, positioned: false }, [
      { id: "new:front", name: first.name, type: first.type, previewUrl: "", file: first, isCover: false },
      { id: "new:side", name: second.name, type: second.type, previewUrl: "", file: second, isCover: true },
    ]);
    const form = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(form.getAll("photos")).toHaveLength(2);
    expect(form.get("coverIndex")).toBe("1");
    expect(form.get("removePhotoIds")).toBe("[]");
  });

  it("removes a stored photo when a Building is reclassified as a Facility", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const previousCreateObjectURL = URL.createObjectURL;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:photo-preview" });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "7", name: "front.png", type: "image/png", isCover: true }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Blob(["image"], { type: "image/png" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "42", name: "Library", code: "LIB", type: "Facility", parentId: null, status: "Active", lat: null, lng: null, positioned: false, hasPhoto: false }), { status: 200 }));
    await httpServices.locations.getPhotos("42", "Building");
    await httpServices.locations.save({ id: "42", name: "Library", code: "LIB", type: "Facility", parentId: null, status: "Active", lat: null, lng: null, positioned: false }, []);
    const form = fetchMock.mock.calls[2]?.[1]?.body as FormData;
    expect(form.get("removePhotoIds")).toBe("[7]");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: previousCreateObjectURL });
    vi.unstubAllEnvs();
  });
});

describe("real walking network service boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("round-trips persisted Route Node names and associations", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ route_nodes: [{
        node_id: 42,
        name: "Library Entrance",
        location_id: null,
        building_id: 7,
        latitude: 16.72,
        longitude: 121.69,
        node_type: "entrance",
        status: "active",
      }] }), { status: 200 }),
    );

    await expect(httpServices.map.nodes()).resolves.toEqual([{
      id: "42",
      name: "Library Entrance",
      nodeType: "Entrance",
      associatedPlaceId: "7",
      lat: 16.72,
      lng: 121.69,
      status: "Active",
    }]);

    const savedNode = {
      id: "42",
      name: "North Library Entrance",
      nodeType: "Entrance" as const,
      associatedPlaceId: "7",
      lat: 16.721,
      lng: 121.691,
      status: "Active" as const,
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ route_node: {
      node_id: 42,
      name: savedNode.name,
      location_id: null,
      building_id: 7,
      latitude: savedNode.lat,
      longitude: savedNode.lng,
      node_type: "entrance",
      status: "active",
    } }), { status: 200 }));
    await expect(httpServices.map.updateRouteNode(savedNode)).resolves.toMatchObject(savedNode);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({
        name: "North Library Entrance",
        latitude: 16.721,
        longitude: 121.691,
        location_id: null,
        building_id: 7,
        node_type: "entrance",
        status: "active",
      }),
    }));
  });

  it("round-trips pathway names, direction, detailed shade, modes, and path points", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ pathways: [{
        pathway_id: 9,
        name: "Covered Road Connector",
        source_node_id: 3,
        destination_node_id: 4,
        path_type: "Road",
        status: "active",
        shaded: true,
        shade: "Mostly Shaded",
        direction: "One-way",
        surface_type: "concrete",
        allowed_modes: ["Walking", "Vehicle"],
      }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ path_points: [{
        point_id: 1,
        pathway_id: 9,
        sequence_no: 1,
        latitude: 16.7205,
        longitude: 121.6905,
        building_id: null,
        node_type: "Waypoint",
        status: "active",
      }] }), { status: 200 }));

    await expect(httpServices.map.pathways()).resolves.toEqual([{
      id: "9",
      name: "Covered Road Connector",
      sourceNodeId: "3",
      destinationNodeId: "4",
      shade: "Mostly Shaded",
      type: "Road",
      direction: "One-way",
      status: "Active",
      allowedModes: ["Walking", "Vehicle"] as ("Walking" | "Vehicle")[],
      pathPoints: [[16.7205, 121.6905]],
    }]);

    const pathway = {
      id: "9",
      name: "Updated Road Connector",
      sourceNodeId: "3",
      destinationNodeId: "4",
      shade: "Partial Shade" as const,
      type: "Road",
      direction: "Two-way" as const,
      status: "Active" as const,
      allowedModes: ["Walking", "Vehicle"] as ("Walking" | "Vehicle")[],
      pathPoints: [],
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ pathway: {
      pathway_id: 9,
      name: pathway.name,
      source_node_id: 3,
      destination_node_id: 4,
      path_type: "Road",
      status: "active",
      shaded: true,
      shade: pathway.shade,
      direction: pathway.direction,
      surface_type: null,
      allowed_modes: ["Walking", "Vehicle"],
    } }), { status: 200 }));
    await expect(httpServices.map.updatePathway(pathway)).resolves.toMatchObject(pathway);
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({
        name: "Updated Road Connector",
        source_node_id: 3,
        destination_node_id: 4,
        path_type: "Road",
        status: "active",
        shade: "Partial Shade",
        direction: "Two-way",
        allowed_modes: ["Walking", "Vehicle"],
        path_points: [],
      }),
    }));
  });

  it("loads legacy pathways without mode rows as Walking", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ pathways: [{
        pathway_id: 11,
        name: "Legacy Covered Walk",
        source_node_id: 3,
        destination_node_id: 4,
        path_type: "Walkway",
        status: "inactive",
        shaded: true,
        shade: "Fully Shaded",
        direction: "One-way",
        surface_type: null,
      }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ path_points: [] }), { status: 200 }));

    await expect(httpServices.map.pathways()).resolves.toEqual([expect.objectContaining({
      id: "11",
      name: "Legacy Covered Walk",
      shade: "Fully Shaded",
      direction: "One-way",
      status: "Closed",
      allowedModes: ["Walking"],
      pathPoints: [],
    })]);
  });

  it("persists path-point edits with PUT, POST, and DELETE operations", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ path_points: [
        { point_id: 4, pathway_id: 9, sequence_no: 1, latitude: 16.72, longitude: 121.69, building_id: null, node_type: "Waypoint", status: "active" },
        { point_id: 5, pathway_id: 9, sequence_no: 2, latitude: 16.73, longitude: 121.70, building_id: null, node_type: "Waypoint", status: "active" },
        { point_id: 6, pathway_id: 9, sequence_no: 3, latitude: 16.74, longitude: 121.71, building_id: null, node_type: "Waypoint", status: "active" },
      ] }), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

    await httpServices.map.replacePathPoints("9", [
      [16.721, 121.691],
      [16.722, 121.692],
      [16.723, 121.693],
      [16.724, 121.694],
    ]);

    expect(fetchMock.mock.calls.map(([url, init]) => [String(url).replace(/^https?:\/\/[^/]+/, ""), init?.method])).toEqual([
      ["/api/path-points", undefined],
      ["/api/path-points/4", "PUT"],
      ["/api/path-points/5", "PUT"],
      ["/api/path-points/6", "PUT"],
      ["/api/path-points", "POST"],
    ]);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({
      pathway_id: 9, sequence_no: 1, latitude: 16.721, longitude: 121.691, node_type: "Waypoint", status: "active",
    }));
    expect(fetchMock.mock.calls[4]?.[1]?.body).toBe(JSON.stringify({
      pathway_id: 9, sequence_no: 4, latitude: 16.724, longitude: 121.694, node_type: "Waypoint", status: "active",
    }));
  });

  it("rejects point persistence with an actionable error and does not report success", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ path_points: [
        { point_id: 4, pathway_id: 9, sequence_no: 1, latitude: 16.72, longitude: 121.69, building_id: null, node_type: "Waypoint", status: "active" },
      ] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Coordinate is outside the campus boundary." }), { status: 422 }));

    await expect(httpServices.map.replacePathPoints("9", [[16.721, 121.691]])).rejects.toThrow(
      "Could not persist Path Points for Pathway 9: Coordinate is outside the campus boundary.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("deletes surplus persisted Path Points after the retained points are updated", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ path_points: [
        { point_id: 4, pathway_id: 9, sequence_no: 1, latitude: 16.72, longitude: 121.69, building_id: null, node_type: "Waypoint", status: "active" },
        { point_id: 5, pathway_id: 9, sequence_no: 2, latitude: 16.73, longitude: 121.70, building_id: null, node_type: "Waypoint", status: "active" },
      ] }), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

    await httpServices.map.replacePathPoints("9", [[16.721, 121.691]]);

    expect(fetchMock.mock.calls.map(([url, init]) => [String(url).replace(/^https?:\/\/[^/]+/, ""), init?.method])).toEqual([
      ["/api/path-points", undefined],
      ["/api/path-points/4", "PUT"],
      ["/api/path-points/5", "DELETE"],
    ]);
  });

  it("sends Pathway geometry in the same create request as its metadata", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ pathway: {
        pathway_id: 9, name: "New Path", source_node_id: 3, destination_node_id: 4,
        path_type: "Walkway", status: "active", surface_type: null,
        shade: "Unshaded", direction: "Unknown", allowed_modes: ["Walking"],
        path_points: [{ point_id: 12, pathway_id: 9, sequence_no: 1, latitude: 16.721, longitude: 121.691, building_id: null, node_type: "Waypoint", status: "active" }],
      } }), { status: 201 }))

    await expect(httpServices.map.createPathway({
      name: "New Path", sourceNodeId: "3", destinationNodeId: "4",
      shade: "Unshaded", type: "Walkway", direction: "Unknown", status: "Active", allowedModes: ["Walking"],
      pathPoints: [[16.721, 121.691]],
    })).resolves.toMatchObject({ id: "9", pathPoints: [[16.721, 121.691]] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        name: "New Path",
        source_node_id: 3,
        destination_node_id: 4,
        path_type: "Walkway",
        status: "active",
        shade: "Unshaded",
        direction: "Unknown",
        allowed_modes: ["Walking"],
        path_points: [{ sequence_no: 1, latitude: 16.721, longitude: 121.691, node_type: "Waypoint", status: "active" }],
      }),
    }));
  });

  it("normalizes Building and Facility footprints and reads the committed result after deletion", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { id: "4", name: "Engineering Hall", code: "ENG-01", type: "Building", status: "Active", points: [[16.72, 121.69], [16.721, 121.69], [16.721, 121.691]] },
        { id: "8", name: "Campus Clinic", code: "CLINIC", type: "Facility", status: "Active", points: [[16.722, 121.692], [16.723, 121.692], [16.723, 121.693]] },
      ]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    await expect(httpServices.map.buildings()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "4", type: "Building" }),
      expect.objectContaining({ id: "8", type: "Facility", points: [[16.722, 121.692], [16.723, 121.692], [16.723, 121.693]] }),
    ]));
    await httpServices.map.removeBuilding("4");
    await expect(httpServices.map.buildings()).resolves.toEqual([]);
    expect(String(fetchMock.mock.calls[1]?.[0])).toMatch(/\/api\/map\/buildings\/4$/);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ method: "DELETE" }));
  });
});

describe("account type contract", () => {
  const dashboard = { buildings: 1, buildingChange: null, indoorLocations: 1, users: 10, locations: 1, pathways: 1, searches: 0, topSearched: [], recent: [] };

  it("normalizes userType and user_type case-insensitively, with unknown values becoming null", () => {
    expect(normalizeBackendUser({ id: 1, username: "a", userType: "Student" }).userType).toBe("student");
    expect(normalizeBackendUser({ id: 2, username: "b", user_type: "TEACHER" }).userType).toBe("teacher");
    expect(normalizeBackendUser({ id: 3, username: "c", user_type: "admin" }).userType).toBeNull();
    expect(normalizeBackendUser({ id: 4, username: "d" }).userType).toBeNull();
  });

  it("treats dashboard usersByType as optional", () => {
    expect(normalizeBackendDashboardSummary(dashboard).usersByType).toBeNull();
    const split = { student: 7, teacher: 2, visitor: 1 };
    expect(normalizeBackendDashboardSummary({ ...dashboard, usersByType: split }).usersByType).toEqual(split);
    expect(() => normalizeBackendDashboardSummary({ ...dashboard, usersByType: { student: -1, teacher: 0, visitor: 0 } })).toThrow();
  });

  it("filters local fixture users by type, search, range and page, newest first", async () => {
    const all = await services.users.list("", 1, 100);
    expect(all.total).toBe(60);
    expect(all.items.every((user) => user.userType !== null)).toBe(true);
    const dates = all.items.map((user) => Date.parse(user.createdAt));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));

    const teachers = await services.users.list("", 1, 100, "all", "teacher");
    expect(teachers.total).toBeGreaterThan(0);
    expect(teachers.items.every((user) => user.userType === "teacher")).toBe(true);
    const counts = await Promise.all((["student", "teacher", "visitor"] as const).map((type) => services.users.list("", 1, 100, "all", type)));
    expect(counts.reduce((sum, page) => sum + page.total, 0)).toBe(all.total);

    const first = all.items[0];
    const searched = await services.users.list(first.username.toUpperCase(), 1, 10);
    expect(searched.items.map((user) => user.id)).toContain(first.id);
    const recent = await services.users.list("", 1, 100, "7d");
    expect(recent.total).toBeLessThan(all.total);
    expect((await services.users.list("", 2, 25)).items).toHaveLength(25);
  });

  it("derives the local dashboard split and recent activity from fixtures", async () => {
    const summary = await services.dashboard.summary();
    const split = summary.usersByType!;
    expect(summary.users).toBe(60);
    expect(split.student + split.teacher + split.visitor).toBe(summary.users);
    expect(summary.recent.length).toBeGreaterThan(0);
    const logs = await services.logs.list("Admin", "", "All Actors", "all", 1, 100);
    expect(logs.total).toBeGreaterThan(10);
  });
});

describe("dashboard analytics", () => {
  it("generates deterministic fixture analytics that satisfy the backend contract", async () => {
    const week = await services.dashboard.analytics("week");
    const again = await services.dashboard.analytics("week");
    expect(again).toEqual(week);
    expect(normalizeBackendDashboardAnalytics({ data: week })).toEqual(week);
    expect(week.timeline).toHaveLength(7);
    expect(week.previous).not.toBeNull();
    expect((await services.dashboard.analytics("month")).timeline).toHaveLength(30);
    const all = await services.dashboard.analytics("all");
    expect(all.timeline).toHaveLength(12);
    expect(all.previous).toBeNull();
  });

  it("rejects a malformed analytics payload", () => {
    expect(() => normalizeBackendDashboardAnalytics({ range: "week" })).toThrow("malformed dashboard analytics");
  });

  it("requests the selected range from the real backend and unwraps the envelope", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    // The shape app/services/dashboard_analytics.py returns, including the
    // zeroed Visit figures it reports until an arrival event is recorded.
    const served = {
      range: "month",
      current: { activeUsers: 5, searches: 59, visits: 0, arrivalRate: 0 },
      previous: { activeUsers: 0, searches: 0, visits: 0, arrivalRate: 0 },
      timeline: [{ date: "2026-09-11", searches: 3, visits: 0 }],
      visitsByAccountType: { student: 0, teacher: 0, visitor: 0 },
      visitsByDestinationType: { Building: 0, Room: 0, Laboratory: 0, Office: 0, Restroom: 0 },
      registrations: [{ date: "2026-09-11", student: 1, teacher: 0, visitor: 0 }],
      topDestinations: [{ rank: "1", locationId: "Building:1", name: "Admin Building", context: "Building", searches: 16, visits: 0 }],
      completeness: [
        { key: "photo", label: "Photo", complete: 15, total: 76 },
        { key: "description", label: "Description", complete: 76, total: 76 },
        { key: "keywords", label: "Search keywords", complete: 34, total: 76 },
        { key: "mapPin", label: "Map pin", complete: 56, total: 76 },
      ],
      completenessTotal: 76,
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: served }), { status: 200 }),
    );

    await expect(httpServices.dashboard.analytics("month")).resolves.toEqual(served);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/analytics?range=month",
      expect.objectContaining({ credentials: "include" }),
    );
    vi.unstubAllEnvs();
  });
});


it("uses Manila dates and actual active directory metadata, including building footprints", () => {
  const now = Date.parse("2026-10-08T16:30:00Z"); // October 9 in Manila
  const directory: Location[] = [{
    id: "42", name: "Library", code: "LIB", type: "Building", parentId: null,
    status: "Active", lat: null, lng: null, positioned: false,
    function: "Study space", keywords: "library", hasPhoto: true,
  }];
  const data = generateDashboardAnalytics("week", directory, now, [{
    id: "42", name: "Library", code: "LIB", points: [[16, 121], [16.1, 121], [16, 121.1]],
  }]);
  expect(data.timeline.at(-1)?.date).toBe("2026-10-09");
  expect(data.completeness.map((check) => check.complete)).toEqual([1, 1, 1, 1]);
  expect(data.current.activeUsers).toBeLessThanOrEqual(600);
  expect(data.timeline.reduce((sum, day) => sum + day.visits, 0)).toBe(data.current.visits);
  directory[0] = { ...directory[0], name: "Renamed library", status: "Inactive" };
  const changed = generateDashboardAnalytics("week", directory, now);
  expect(changed.topDestinations).toEqual([]);
  expect(changed.completenessTotal).toBe(0);
});

describe("real administrators service boundary", () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const httpServices = async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    // Reset modules give the service its own error classes, so `instanceof` needs the same copy.
    return { services: (await import("./api")).services, errors: await import("./errors") };
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("passes each account's role through and reads a missing or unknown one as administrator", async () => {
    const { services: admins } = await httpServices();
    const account = { email: "", status: "Active", isCurrent: false };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({
      items: [
        { id: "1", username: "boss", role: "superadmin", ...account },
        { id: "2", username: "staff", role: "admin", ...account },
        { id: "3", username: "legacy", ...account },
        { id: "4", username: "odd", role: "owner", ...account },
      ],
      total: 4,
    }));

    const listed = await admins.admins.list();
    expect(listed.map((item) => [item.username, item.role])).toEqual([
      ["boss", "superadmin"], ["staff", "admin"], ["legacy", "admin"], ["odd", "admin"],
    ]);
  });

  it("sends the chosen role when adding an administrator, but never when editing one", async () => {
    const { services: admins } = await httpServices();
    const reply = { success: true, admin: { id: "9", username: "boss", email: "b@isu.edu.ph", status: "Active", role: "superadmin", isCurrent: false } };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(reply, 201))
      .mockResolvedValueOnce(json(reply))
      .mockResolvedValueOnce(json(reply));

    await expect(admins.admins.save({ username: "boss", email: "b@isu.edu.ph", password: "A-long-enough-secret1", role: "superadmin" }))
      .resolves.toMatchObject({ role: "superadmin" });
    await admins.admins.save({ username: "plain", email: "p@isu.edu.ph", password: "A-long-enough-secret1" });
    await admins.admins.save({ id: "9", username: "boss", email: "b@isu.edu.ph", role: "superadmin" });

    const [first, second, third] = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(first).toEqual({ username: "boss", email: "b@isu.edu.ph", password: "A-long-enough-secret1", role: "superadmin" });
    expect(second).not.toHaveProperty("role");
    expect(third).not.toHaveProperty("role");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "PUT" });
  });

  it("changes a role through the role route and returns the updated account", async () => {
    const { services: admins } = await httpServices();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(json({
      success: true,
      message: "staff was promoted to superadmin successfully.",
      admin: { id: "2", username: "staff", email: "", status: "Active", role: "superadmin", isCurrent: false },
    }));

    await expect(admins.admins.setRole("2", "superadmin")).resolves.toMatchObject({ username: "staff", role: "superadmin" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/admins\/2\/role$/);
    expect(init).toMatchObject({ method: "PUT" });
    expect(JSON.parse(String(init?.body))).toEqual({ role: "superadmin" });
  });

  it("raises the superadmin error for a 403 carrying its code, not for any other 403", async () => {
    const { services: admins, errors } = await httpServices();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(json({ success: false, code: "superadmin_required", message: "Superadmin access required" }, 403))
      .mockResolvedValueOnce(json({ success: false, code: "password_confirmation_required", message: "Confirm your password." }, 403))
      .mockResolvedValueOnce(json({ success: false, message: "Superadmin access required" }, 403));

    const refusal = await admins.admins.remove("2").catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(errors.SuperadminRequiredError);
    expect(refusal).toMatchObject({ message: "Superadmin access required" });

    expect(await admins.admins.remove("2").catch((error: unknown) => error)).toBeInstanceOf(errors.PasswordConfirmationRequiredError);

    // The message alone is not the signal: a 403 without the code stays a plain error.
    const plain = await admins.admins.remove("2").catch((error: unknown) => error);
    expect(plain).not.toBeInstanceOf(errors.SuperadminRequiredError);
    expect(plain).toMatchObject({ message: "Superadmin access required" });
  });
});
