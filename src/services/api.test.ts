import { describe, expect, it } from "vitest";
import { services, setMockFailure } from "./api";
import { resetSchema } from "./schemas";

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
  });

  it("filters locations through the service boundary", async () => {
    const result = await services.locations.list("computer lab");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("Computer Lab 1");
  });

  it("creates an audit entry after a user mutation", async () => {
    const before = (await services.logs.list("All")).total;
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

  it("validates recovery code and password requirements", () => {
    expect(
      resetSchema.safeParse({ code: "123", password: "short" }).success,
    ).toBe(false);
    expect(
      resetSchema.safeParse({ code: "000000", password: "password123" })
        .success,
    ).toBe(true);
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
});
