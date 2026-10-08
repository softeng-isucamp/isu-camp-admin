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

    const [locations, pathways, nodes] = await Promise.all([
      services.map.locations(),
      services.map.pathways(),
      services.map.nodes(),
    ]);
    // The map reads the same array as the Location Directory, so it carries the
    // generated campus records plus the seeded indoor Locations.
    expect(locations.map((location) => location.id)).toEqual(
      expect.arrayContaining(generatedMapFixture.locations.map((location) => location.id)),
    );
    expect(locations.length).toBeGreaterThanOrEqual(generatedMapFixture.locations.length);
    expect(pathways).toHaveLength(generatedMapFixture.pathways.length);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes).toEqual(
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
  }, 15_000);

  it("drops a deleted record from both the directory and the map", async () => {
    vi.stubEnv("VITE_MAP_FIXTURE", "osm");
    vi.stubEnv("VITE_API_MODE", "local");
    vi.resetModules();
    const { services } = await import("./api");

    const created = await services.locations.save({
      name: "Fixture Delete Probe",
      code: "FIXTURE-DEL",
      type: "Facility",
      parentId: null,
      status: "Active",
      function: "Checks that fixture writes reach the directory",
      lat: null,
      lng: null,
      positioned: false,
    });

    // A save must be visible to the directory, not only to the adapter's copy.
    const afterSave = await services.locations.list("Fixture Delete Probe");
    expect(afterSave.items.map((item) => item.id)).toContain(created.id);

    await services.locations.remove(created.id, created.type);

    const afterDelete = await services.locations.list("Fixture Delete Probe");
    expect(afterDelete.items.map((item) => item.id)).not.toContain(created.id);
    expect((await services.map.locations()).map((item) => item.id)).not.toContain(created.id);
    vi.unstubAllEnvs();
  }, 15_000);
});
