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
    vi.unstubAllEnvs();
  });
});
