import { describe, expect, it } from "vitest";
import {
  distanceInMeters,
  findPointSnap,
  nudgePoint,
  type ScreenPoint,
} from "./pointInteractions";
import type { MapPoint } from "./campusBoundary";

const project = ([lat, lng]: MapPoint): ScreenPoint => ({ x: lng, y: lat });
const unproject = ({ x, y }: ScreenPoint): MapPoint => [y, x];

describe("point geometry interactions", () => {
  it("measures and nudges coordinates in meters", () => {
    const origin: MapPoint = [16.7205, 121.6895];
    const north = nudgePoint(origin, "north", 0.5);
    const east = nudgePoint(origin, "east", 5);

    expect(north[0]).toBeGreaterThan(origin[0]);
    expect(north[1]).toBeCloseTo(origin[1], 10);
    expect(distanceInMeters(origin, north)).toBeCloseTo(0.5, 2);
    expect(east[1]).toBeGreaterThan(origin[1]);
    expect(east[0]).toBeCloseTo(origin[0], 10);
    expect(distanceInMeters(origin, east)).toBeCloseTo(5, 2);
  });

  it("snaps to the nearest point on a building perimeter within 18px", () => {
    const snap = findPointSnap(
      [8, 10],
      [{ kind: "building_perimeter", start: [0, 0], end: [0, 20] }],
      project,
      unproject,
    );

    expect(snap).toEqual({
      point: [0, 10],
      kind: "building_perimeter",
      distancePixels: 8,
    });
  });

  it("snaps to a Pathway vertex but ignores targets beyond 18px", () => {
    expect(findPointSnap(
      [20, 17],
      [{ kind: "pathway_vertex", point: [20, 20] }],
      project,
      unproject,
    )).toEqual({
      point: [20, 20],
      kind: "pathway_vertex",
      distancePixels: 3,
    });

    expect(findPointSnap(
      [20, 1],
      [{ kind: "pathway_vertex", point: [20, 20] }],
      project,
      unproject,
    )).toBeNull();
  });
});
