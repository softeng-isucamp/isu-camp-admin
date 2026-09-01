import { describe, expect, it, vi } from "vitest";

describe("generated map fixture service mode", () => {
  it("loads generated OSM data through the map service boundary", async () => {
    vi.stubEnv("VITE_MAP_FIXTURE", "osm");
    vi.stubEnv("VITE_API_MODE", "local");
    vi.resetModules();
    const [{ services }, { generatedMapFixture }] = await Promise.all([
      import("./api"),
      import("./generatedMapFixture"),
    ]);

    await expect(services.map.locations()).resolves.toEqual(generatedMapFixture.locations);
    await expect(services.map.pathways()).resolves.toEqual(generatedMapFixture.pathways);
    await expect(services.map.nodes()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: expect.stringMatching(/^OSM node \d+$/) })]),
    );
    expect(generatedMapFixture.nodes.every((node) => node.name.trim().length > 0)).toBe(true);
    expect(generatedMapFixture.nodes[0]).toMatchObject({
      sourceWayIds: expect.any(Array),
      source: expect.objectContaining({ provider: "OpenStreetMap" }),
    });
    expect(generatedMapFixture.pathways[0]).toMatchObject({
      sourceWayId: expect.any(Number),
      source: expect.objectContaining({ provider: "OpenStreetMap" }),
    });
    expect(generatedMapFixture.locations[0].code).toMatch(/^OSM (node|way|relation) \d+$/);
    expect(generatedMapFixture.locations[0].code).not.toBe(generatedMapFixture.locations[0].id);
    await expect(services.locations.savePosition({
      id: generatedMapFixture.locations[0].id,
      lat: 16.7201,
      lng: 121.6901,
    })).resolves.toMatchObject({ id: generatedMapFixture.locations[0].id, lat: 16.7201, lng: 121.6901 });
    vi.unstubAllEnvs();
  }, 10_000);

  it("supports a local administrator session without bypassing OSM fixture mode", async () => {
    vi.stubEnv("VITE_MAP_FIXTURE", "osm");
    vi.stubEnv("VITE_API_MODE", "local");
    vi.resetModules();
    let { services } = await import("./api");
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(services.auth.me()).resolves.toBeNull();
    await expect(services.auth.login("someone", "anything")).rejects.toThrow(
      "Invalid username or password",
    );
    await expect(services.auth.login("admin_justine", "password123")).resolves.toEqual({
      id: "local-admin",
      username: "admin_justine",
    });
    vi.resetModules();
    ({ services } = await import("./api"));
    await expect(services.auth.me()).resolves.toEqual({ id: "local-admin", username: "admin_justine" });
    await expect(services.auth.logout()).resolves.toBeUndefined();
    await expect(services.auth.me()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
