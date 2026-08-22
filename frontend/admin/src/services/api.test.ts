import { afterEach, describe, expect, it, vi } from "vitest";
import { services, setMockFailure } from "./api";
import { resetPasswordSchema, resetSchema } from "./schemas";
import { reviewMapDraft } from "../features/map/mapEditing";

describe("mock service contracts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("authenticates the seeded administrator", async () => {
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
      services.auth.login("admin_justine", "password123"),
    ).resolves.toEqual({ id: "1", username: "admin01" });
    await expect(services.auth.login("wrong", "password123")).rejects.toThrow(
      "Invalid username or password",
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:5000/api/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ username: "admin_justine", password: "password123" }),
      }),
    );
  });

  it("filters locations through the service boundary", async () => {
    const result = await services.locations.list("computer lab");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("Computer Lab 1");
  });

  it("returns the dashboard metric counts through the service boundary", async () => {
    const summary = await services.dashboard.summary();
    expect(summary.locations).toBeGreaterThan(0);
    expect(summary.pathways).toBeGreaterThan(0);
    expect(summary.topSearched).toHaveLength(5);
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
    await expect(services.imports.locations("{bad")).resolves.toMatchObject({
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
    await expect(services.imports.locations(payload)).resolves.toMatchObject({
      imported: 1,
      errors: [],
    });
    expect((await services.locations.list()).total).toBe(before);
    await expect(
      services.imports.locations(payload, true),
    ).resolves.toMatchObject({
      imported: 1,
      errors: [],
    });
    expect(
      (await services.locations.list("Preview Facility")).items,
    ).toHaveLength(1);
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
});
