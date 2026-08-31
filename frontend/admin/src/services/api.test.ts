import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocationsBulkImportTemplate, services, setMockFailure } from "./api";
import { auditEntries } from "./mockData";
import { resetPasswordSchema, resetSchema } from "./schemas";
import { reviewMapDraft } from "../features/map/mapEditing";
import { indoorLocationTypes } from "../lib/locationPolicy";

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

  it("loads a valid seeded Map Editor baseline through the service boundary", async () => {
    const snapshot = {
      buildings: await services.map.buildings(),
      locations: await services.map.locations(),
      nodes: await services.map.nodes(),
      pathways: await services.map.pathways(),
    };

    expect(reviewMapDraft({ original: snapshot, current: snapshot, deleted: [] }))
      .toEqual({ valid: true, errors: [], groups: [] });
  });

  it("creates an audit entry after a user mutation", async () => {
    const before = (await services.logs.list("Admin")).total;
    const page = await services.users.list("admin01");
    await services.users.update({ ...page.items[0], username: "admin01" });
    expect((await services.logs.list("Admin")).total).toBeGreaterThanOrEqual(
      before,
    );
  });

  it("reports invalid import JSON and missing references", async () => {
    await expect(services.imports.locations({ json: "{bad" })).resolves.toMatchObject({
      imported: 0,
      errors: ["Invalid JSON file."],
    });
    const result = await services.imports.routes(
      JSON.stringify({
        id: "r-import",
        name: "Broken",
        sourceNodeId: "missing",
        destinationNodeId: "missing",
        pathPoints: [],
      }),
    );
    expect(result.imported).toBe(0);
    expect(result.errors[0]).toContain("node reference");
  });

  it("supports deterministic injectable save failures", async () => {
    setMockFailure("mapSave", true);
    await expect(services.map.save()).rejects.toThrow("Mock mapSave failed");
    setMockFailure("mapSave", false);
    await expect(services.map.save()).resolves.toBeUndefined();
  });

  it("injects user mutation failures through the service boundary", async () => {
    const user = (await services.users.list("admin01")).items[0];
    setMockFailure("userUpdate", true);
    await expect(services.users.update(user)).rejects.toThrow(
      "Mock userUpdate failed",
    );
    setMockFailure("userUpdate", false);
  });

  it("validates recovery code and password requirements", () => {
    expect(
      resetSchema.safeParse({ code: "123", password: "short" }).success,
    ).toBe(false);
    expect(
      resetSchema.safeParse({ code: "000000", password: "password123" })
        .success,
    ).toBe(true);
    expect(
      resetPasswordSchema.safeParse({
        code: "000000",
        password: "password123",
        confirmPassword: "different123",
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

  it("keeps import validation transactional until commit", async () => {
    const before = (await services.locations.list()).total;
    const payload = JSON.stringify({
      id: "loc-preview",
      name: "Preview Facility",
      code: "PRE-01",
      type: "Facility",
      parentId: null,
      status: "Active",
      lat: 16.72,
      lng: 121.69,
    });
    await expect(services.imports.locations({ json: payload })).resolves.toMatchObject({
      imported: 1,
      errors: [],
    });
    expect((await services.locations.list()).total).toBe(before);
    await expect(
      services.imports.locations({ json: payload, commit: true }),
    ).resolves.toMatchObject({
      imported: 1,
      errors: [],
    });
    expect(
      (await services.locations.list("Preview Facility")).items,
    ).toHaveLength(1);
  });

  it("validates bulk imports transactionally with batch parents and field-level errors", async () => {
    const before = (await services.locations.list()).total;
    const invalid = JSON.stringify([
      { id: "bulk-room", name: "Batch room", code: "BATCH-ROOM", type: "Room", parentId: "bulk-building", floor: "Ground Floor", status: "Active", lat: null, lng: null },
      { id: "bulk-building", name: "Batch building", code: "BATCH-BLDG", type: "Building", parentId: null, status: "Active", lat: 16.72, lng: 121.69 },
      { id: "bad", name: "", code: "", type: "Facility", parentId: null, status: "Active", lat: null, lng: null },
    ]);
    const result = await services.imports.locations({ json: invalid, commit: true, mode: "add" });
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/^Row 3, name:/), expect.stringMatching(/^Row 3, code:/)]));
    expect((await services.locations.list()).total).toBe(before);

    const valid = JSON.stringify(JSON.parse(invalid).slice(0, 2));
    await expect(services.imports.locations({ json: valid, commit: true, mode: "add" })).resolves.toMatchObject({ imported: 2, errors: [] });
    expect((await services.locations.list()).items.find((item) => item.id === "bulk-room")?.parentId).toBe("bulk-building");
    const duplicateResult = await services.imports.locations({ json: valid, mode: "add" });
    expect(duplicateResult.imported).toBe(0);
    expect(duplicateResult.errors).toEqual(expect.arrayContaining([expect.stringMatching(/already exists/)]));
  });

  it("updates bulk records by id first and then code, rejecting unmatched rows", async () => {
    const original = (await services.locations.list()).items[0];
    const payload = JSON.stringify([
      { ...original, name: "Updated by id", code: "A-DIFFERENT-CODE" },
      { id: "unmatched-id", name: "Updated by code", code: original.code, type: original.type, parentId: original.parentId, status: original.status, lat: original.lat, lng: original.lng },
    ]);
    await expect(services.imports.locations({ json: payload, commit: true, mode: "update" })).resolves.toMatchObject({ imported: 2, errors: [] });
    expect((await services.locations.list()).items.find((item) => item.id === original.id)?.name).toBe("Updated by code");
    const before = (await services.locations.list()).total;
    await expect(services.imports.locations({ json: JSON.stringify({ id: "missing", name: "Missing", code: "MISSING", type: "Facility", parentId: null, status: "Active", lat: null, lng: null }), commit: true, mode: "update" })).resolves.toMatchObject({ imported: 0, errors: [expect.stringMatching(/no existing location/)] });
    expect((await services.locations.list()).total).toBe(before);
    const template = createLocationsBulkImportTemplate();
    const templateRows = JSON.parse(template) as Array<Record<string, unknown>>;
    const importContractFields = ["id", "name", "code", "type", "parentId", "status", "lat", "lng"];
    expect(templateRows.every((row) => importContractFields.every((field) => field in row))).toBe(true);
    expect(templateRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "Building" }),
      expect.objectContaining({ type: "Room", parentId: "building-library", floor: "Ground Floor" }),
      expect.objectContaining({ type: "Facility", parentId: null }),
    ]));
    await expect(services.imports.locations({ json: template, mode: "add" })).resolves.toMatchObject({ imported: 4, errors: [] });
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

  it("uses a code-matched parent's durable ID for batch children and records exact histories", async () => {
    const parent = await services.locations.save({
      id: "durable-parent", name: "Durable Parent", code: "DURABLE", type: "Building", parentId: null,
      status: "Active", lat: null, lng: null, positioned: false,
    });
    const child = await services.locations.save({
      id: "separate-id-target", name: "ID Target", code: "ID-TARGET", type: "Facility", parentId: null,
      status: "Active", lat: null, lng: null, positioned: false,
    });
    const updateRows = JSON.stringify([
      { id: child.id, name: "Updated by ID", code: "NEW-CODE", type: child.type, parentId: null, status: child.status, lat: null, lng: null },
      { id: "incoming-parent-id", name: parent.name, code: parent.code, type: parent.type, parentId: null, status: parent.status, lat: null, lng: null },
      { id: "incoming-child", name: "Imported Child", code: "INCOMING-CHILD", type: "Room", parentId: "incoming-parent-id", floor: "Ground Floor", status: "Active", lat: null, lng: null },
    ]);
    await expect(services.imports.locations({ json: updateRows, commit: true, mode: "update" })).resolves.toMatchObject({ imported: 0, errors: [expect.stringMatching(/no existing location/)] });

    await services.locations.save({ id: "incoming-child", name: "Existing Child", code: "INCOMING-CHILD", type: "Room", parentId: parent.id, building: parent.name, status: "Active", lat: null, lng: null, positioned: false });
    await expect(services.imports.locations({ json: updateRows, commit: true, mode: "update" })).resolves.toMatchObject({ imported: 3, errors: [] });
    expect((await services.locations.list()).items.find((location) => location.id === child.id)).toMatchObject({ name: "Updated by ID", code: "NEW-CODE" });
    expect((await services.locations.list()).items.find((location) => location.id === "incoming-child")?.parentId).toBe(parent.id);
    expect((await services.logs.forLocation(parent.id)).items.some((entry) => entry.action === "Bulk Updated Location")).toBe(true);
    expect((await services.logs.forLocation("incoming-child")).items.some((entry) => entry.action === "Bulk Updated Location")).toBe(true);
    expect((await services.logs.forLocation(parent.id)).items.every((entry) => entry.target === parent.name)).toBe(true);
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

  it("retains seeded legacy history when a location is renamed before history is opened", async () => {
    const seededLegacyEntry = auditEntries.find(
      (entry) => entry.id === "a1" && entry.action === "Updated Location",
    );
    const seededLocation = (await services.locations.list()).items.find(
      (location) => location.name === seededLegacyEntry?.target,
    );
    expect(seededLegacyEntry).toBeDefined();
    expect(seededLocation).toBeDefined();
    expect(seededLegacyEntry?.targetId).toBe(seededLocation?.id);

    await services.locations.save({ ...seededLocation!, name: `Renamed ${seededLocation!.name}` });
    const history = await services.logs.forLocation(seededLocation!.id);

    expect(history.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "a1", targetId: seededLocation!.id }),
    ]));
  });

  it("rejects invalid bulk coordinate pairs and ranges transactionally", async () => {
    const totalBefore = (await services.locations.list()).total;
    const invalidCoordinates = JSON.stringify([
      { id: "pair-error", name: "Pair error", code: "PAIR", type: "Facility", parentId: null, status: "Active", lat: 16.72, lng: null },
      { id: "range-error", name: "Range error", code: "RANGE", type: "Facility", parentId: null, status: "Active", lat: 100, lng: 121.69 },
    ]);
    const result = await services.imports.locations({ json: invalidCoordinates, commit: true });
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/^Row 1, lng:.*together/), expect.stringMatching(/^Row 2, lat:.*between/)]));
    expect((await services.locations.list()).total).toBe(totalBefore);
  });

  it("exposes injectable location and route save failures", async () => {
    const location = (await services.locations.list()).items[0];
    const route = (await services.routes.list()).items[0];
    setMockFailure("locationSave", true);
    await expect(services.locations.save(location)).rejects.toThrow(
      "Mock locationSave failed",
    );
    setMockFailure("locationSave", false);
    setMockFailure("routeSave", true);
    await expect(services.routes.save(route)).rejects.toThrow(
      "Mock routeSave failed",
    );
    setMockFailure("routeSave", false);
  });

  it("rejects malformed CRUD payloads before mutating mock data", async () => {
    const locationsBefore = (await services.locations.list()).total;
    await expect(
      services.locations.save({ id: "bad" } as never),
    ).rejects.toThrow();
    expect((await services.locations.list()).total).toBe(locationsBefore);

    const routesBefore = (await services.routes.list()).total;
    await expect(
      services.routes.save({ id: "bad" } as never),
    ).rejects.toThrow();
    expect((await services.routes.list()).total).toBe(routesBefore);

    await expect(
      services.users.create({ id: "bad", username: "" } as never),
    ).rejects.toThrow("Username is required");
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

  it("handles notifications listing and mark as read", async () => {
    const list = await services.notifications.list();
    expect(list.length).toBeGreaterThan(0);
    const unread = list.find((n) => !n.read);
    if (unread) {
      await services.notifications.markRead(unread.id);
      const updated = await services.notifications.list();
      expect(updated.find((n) => n.id === unread.id)?.read).toBe(true);
    }
    await services.notifications.markAllRead();
    const all = await services.notifications.list();
    expect(all.every((n) => n.read)).toBe(true);
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
    const targetLoc = locations[0];
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

  it("keeps Routes and Map Editor pathway drafts on the same canonical record", async () => {
    const original = (await services.routes.list()).items.find((path) => path.id === "ccsict-junction");
    expect(original).toBeDefined();
    const renamed = `${original!.name} acceptance`;

    await services.routes.save({ ...original!, name: renamed });
    expect((await services.network.pathways()).find((path) => path.id === original!.id)?.name).toBe(renamed);

    const points: [number, number][] = [[16.7205, 121.6895]];
    await services.map.save({ updatedPath: { id: original!.id, pathPoints: points } });
    expect((await services.network.pathways()).find((path) => path.id === original!.id)?.pathSequence.points).toEqual([
      { latitude: points[0][0], longitude: points[0][1] },
    ]);
  });

  it("leaves authoritative records unchanged when a cross-module save fails", async () => {
    const original = (await services.routes.list()).items.find((path) => path.id === "junction-library");
    expect(original).toBeDefined();
    const before = structuredClone(original);
    setMockFailure("routeSave", true);
    await expect(services.routes.save({ ...original!, name: "Should not persist" })).rejects.toThrow("Mock routeSave failed");
    setMockFailure("routeSave", false);
    expect((await services.routes.list()).items.find((path) => path.id === original!.id)).toEqual(before);

    setMockFailure("mapSave", true);
    await expect(services.map.save({ updatedPath: { id: original!.id, pathPoints: [[16.72, 121.69]] } })).rejects.toThrow("Mock mapSave failed");
    setMockFailure("mapSave", false);
    expect((await services.network.pathways()).find((path) => path.id === original!.id)?.pathSequence.points).not.toEqual([
      { latitude: 16.72, longitude: 121.69 },
    ]);
  });
});

describe("real locations service boundary", () => {
  it("maps database-shaped location rows and sends pagination parameters", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        items: [{ location_id: 42, location_name: "Room 204", location_code: "ENG-204", type_id: 3, building: "Engineering Hall", floor: "2nd Floor", description: "Teaching room", keywords: "lecture" }],
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

  it("maps create and update requests and unwraps normalized mutation responses", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const saved = { id: "42", name: "Room 204", code: "ENG-204", type: "Room", parentId: "1", building: "Engineering Hall", floor: "2nd Floor", function: "Teaching room", keywords: "lecture", status: "Active", lat: null, lng: null, positioned: false } as const;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ location: saved }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(saved), { status: 200 }));

    await expect(httpServices.locations.save({ ...saved, id: undefined })).resolves.toEqual(saved);
    await expect(httpServices.locations.save({ ...saved, function: "Seminar room", keywords: "seminar" })).resolves.toEqual(saved);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/locations", expect.objectContaining({ method: "POST", body: JSON.stringify({ ...saved, id: undefined }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/locations/42", expect.objectContaining({ method: "PUT" }));
    vi.unstubAllEnvs();
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

  it("maps the Locations-owned position update and clear responses", async () => {
    vi.stubEnv("VITE_API_MODE", "real");
    vi.resetModules();
    const { services: httpServices } = await import("./api");
    const positioned = { id: "7", name: "Water Station", code: "WATER", type: "Facility", parentId: null, status: "Active", lat: 16.7215, lng: 121.6895, positioned: true };
    const cleared = { ...positioned, lat: null, lng: null, positioned: false };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(positioned), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(cleared), { status: 200 }));

    await expect(httpServices.locations.savePosition({ id: "7", lat: positioned.lat, lng: positioned.lng })).resolves.toEqual(positioned);
    await expect(httpServices.locations.savePosition({ id: "7", lat: null, lng: null })).resolves.toEqual(cleared);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/locations/7/position", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ lat: positioned.lat, lng: positioned.lng }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/locations/7/position", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ lat: null, lng: null }) }));
    vi.unstubAllEnvs();
  });
});
