import { describe, expect, it } from "vitest";
import {
  echagueCampusBoundary,
  formatBoundaryCandidate,
  geometryOnCampus,
  paddedCampusBounds,
  pointOnCampus,
} from "./campusBoundary";

describe("Echague campus boundary", () => {
  it("accepts points inside the campus polygon and rejects points outside", () => {
    expect(pointOnCampus([16.7208, 121.6896], echagueCampusBoundary)).toBe(true);
    expect(pointOnCampus([16.73, 121.68], echagueCampusBoundary)).toBe(false);
  });

  it("requires every geometry point to remain inside campus", () => {
    expect(geometryOnCampus([[16.7208, 121.6896], [16.721, 121.690]], echagueCampusBoundary)).toBe(true);
    expect(geometryOnCampus([[16.7208, 121.6896], [16.73, 121.68]], echagueCampusBoundary)).toBe(false);
  });

  it("rejects a segment that leaves a concave campus boundary between vertices", () => {
    const concaveBoundary: [number, number][] = [
      [0, 0], [0, 4], [4, 4], [4, 3], [1, 3], [1, 1], [4, 1], [4, 0],
    ];

    expect(geometryOnCampus([[3, 0.5], [3, 3.5]], concaveBoundary)).toBe(false);
  });

  it("adds a 100 metre navigation buffer around the campus", () => {
    const bounds = paddedCampusBounds(echagueCampusBoundary);
    expect(bounds.south).toBeLessThan(Math.min(...echagueCampusBoundary.map(([lat]) => lat)));
    expect(bounds.east).toBeGreaterThan(Math.max(...echagueCampusBoundary.map(([, lng]) => lng)));
  });

  it("formats drawn points as a copyable boundary log line", () => {
    expect(formatBoundaryCandidate([[16.72, 121.69], [16.721, 121.691]])).toBe(
      "ISU_ECHAGUE_BOUNDARY_CANDIDATE=[[16.72,121.69],[16.721,121.691]]",
    );
  });
});
