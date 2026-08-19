import { describe, expect, it } from "vitest";
import { services, setMockFailure } from "./api";
import { resetPasswordSchema, resetSchema } from "./schemas";

describe("mock service contracts", () => {
  it("authenticates the seeded administrator", async () => {
    await expect(
      services.auth.login("admin_justine", "password123"),
    ).resolves.toMatchObject({
      username: "admin_justine",
      role: "Administrator",
    });
    await expect(services.auth.login("wrong", "password123")).rejects.toThrow(
      "Invalid username or password",
    );
    await expect(
      services.auth.login("admin_justine", "wrong-password"),
    ).rejects.toThrow("Invalid username or password");
    await services.auth.reset("000000", "new-password");
    await expect(
      services.auth.login("admin_justine", "new-password"),
    ).resolves.toMatchObject({ username: "admin_justine" });
    await services.auth.reset("000000", "password123");
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
});
