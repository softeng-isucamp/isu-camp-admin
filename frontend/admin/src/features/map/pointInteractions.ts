import type { MapPoint } from "./campusBoundary";

export interface ScreenPoint {
  x: number;
  y: number;
}

export type PointSnapTarget =
  | { kind: "building_perimeter"; start: MapPoint; end: MapPoint }
  | { kind: "pathway_vertex"; point: MapPoint };

export interface PointSnap {
  point: MapPoint;
  kind: PointSnapTarget["kind"];
  distancePixels: number;
}

const earthRadiusMeters = 6_371_000;
const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (value: number) => value * 180 / Math.PI;

export function distanceInMeters(origin: MapPoint, destination: MapPoint): number {
  const latitudeDelta = radians(destination[0] - origin[0]);
  const longitudeDelta = radians(destination[1] - origin[1]);
  const originLatitude = radians(origin[0]);
  const destinationLatitude = radians(destination[0]);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(originLatitude) * Math.cos(destinationLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

export function nudgePoint(
  point: MapPoint,
  direction: "north" | "south" | "east" | "west",
  meters: number,
): MapPoint {
  const latitudeOffset = degrees(meters / earthRadiusMeters);
  const longitudeOffset = degrees(meters / (earthRadiusMeters * Math.cos(radians(point[0]))));
  if (direction === "north") return [point[0] + latitudeOffset, point[1]];
  if (direction === "south") return [point[0] - latitudeOffset, point[1]];
  if (direction === "east") return [point[0], point[1] + longitudeOffset];
  return [point[0], point[1] - longitudeOffset];
}

const screenDistance = (first: ScreenPoint, second: ScreenPoint) =>
  Math.hypot(first.x - second.x, first.y - second.y);

const closestPointOnSegment = (
  point: ScreenPoint,
  start: ScreenPoint,
  end: ScreenPoint,
): ScreenPoint => {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX ** 2 + segmentY ** 2;
  if (lengthSquared === 0) return start;
  const projection = ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / lengthSquared;
  const boundedProjection = Math.max(0, Math.min(1, projection));
  return {
    x: start.x + boundedProjection * segmentX,
    y: start.y + boundedProjection * segmentY,
  };
};

export function findPointSnap(
  candidate: MapPoint,
  targets: PointSnapTarget[],
  project: (point: MapPoint) => ScreenPoint,
  unproject: (point: ScreenPoint) => MapPoint,
  radiusPixels = 18,
): PointSnap | null {
  const candidateScreenPoint = project(candidate);
  let nearest: PointSnap | null = null;
  for (const target of targets) {
    const snappedScreenPoint = target.kind === "pathway_vertex"
      ? project(target.point)
      : closestPointOnSegment(candidateScreenPoint, project(target.start), project(target.end));
    const distancePixels = screenDistance(candidateScreenPoint, snappedScreenPoint);
    if (distancePixels <= radiusPixels && (!nearest || distancePixels < nearest.distancePixels)) {
      nearest = {
        point: target.kind === "pathway_vertex" ? target.point : unproject(snappedScreenPoint),
        kind: target.kind,
        distancePixels,
      };
    }
  }
  return nearest;
}
