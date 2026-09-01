import { describe, expect, it } from "vitest";
import { services } from "./api";

describe("canonical network service", () => {
  it("exposes relational fixtures and persists a canonical pathway write", async () => {
    const snapshot = await services.network.snapshot();
    const entrancesByBuilding = new Map<string, number>();
    snapshot.routeNodes.forEach((node) => {
      if (node.type === "entrance" && node.buildingId) {
        entrancesByBuilding.set(node.buildingId, (entrancesByBuilding.get(node.buildingId) ?? 0) + 1);
      }
    });
    expect([...entrancesByBuilding.values()]).toContain(2);
    expect(snapshot.buildings.some((building) => ![...entrancesByBuilding.keys()].includes(building.id))).toBe(true);
    expect(snapshot.pathways.some((pathway) => pathway.pathSequence.points.length === 0)).toBe(true);
    expect(snapshot.routeNodes.every((node) => "latitude" in node && "longitude" in node && "buildingId" in node)).toBe(true);

    const original = snapshot.pathways[0];
    const updated = await services.network.savePathway({ ...original, name: `${original.name} (canonical)` });
    expect(updated.name).toBe(`${original.name} (canonical)`);
    expect((await services.network.pathways()).find((pathway) => pathway.id === original.id)?.name).toBe(updated.name);
  });
});
