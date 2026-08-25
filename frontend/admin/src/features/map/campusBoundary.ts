export type MapPoint = [number, number];

// Echague campus fallback. Live data can override this with the existing
// Whole ISU Campus / CAMPUS_00 polygon.
export const echagueCampusBoundary: MapPoint[] = [
  [16.717488361227918, 121.68360872005417],
  [16.716379340457028, 121.68979066085349],
  [16.71589670903417, 121.69245232980877],
  [16.715794021339867, 121.69441638391689],
  [16.719829606126755, 121.69662728635554],
  [16.72098994930749, 121.6975610169971],
  [16.722704779843443, 121.69806544619426],
  [16.723269541015803, 121.69819423662759],
  [16.72442934084097, 121.69829188026694],
  [16.726524064022428, 121.69827041519467],
  [16.72708881388261, 121.69654247688096],
  [16.72744819928623, 121.69378421510072],
  [16.72812589563264, 121.69015661789554],
  [16.727602221394683, 121.68951266572894],
  [16.7257393991726, 121.68814769481655],
  [16.723860302589397, 121.68676319765835],
  [16.72217628773228, 121.68543236318074],
];

export const campusBoundaryPaddingMeters = 100;

export function formatBoundaryCandidate(points: MapPoint[]): string {
  return `ISU_ECHAGUE_BOUNDARY_CANDIDATE=${JSON.stringify(points)}`;
}

const metersPerDegree = 111_320;

export function pointInPolygon(point: MapPoint, polygon: MapPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [lat, lng] = polygon[i];
    const [previousLat, previousLng] = polygon[j];
    const intersects =
      lng > point[1] !== previousLng > point[1] &&
      point[0] < ((previousLat - lat) * (point[1] - lng)) / (previousLng - lng) + lat;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointOnCampus(point: MapPoint, boundary: MapPoint[]): boolean {
  return pointInPolygon(point, boundary);
}

function segmentsIntersect(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint): boolean {
  const orientation = (p: MapPoint, q: MapPoint, r: MapPoint) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const onSegment = (p: MapPoint, q: MapPoint, r: MapPoint) =>
    Math.min(p[0], r[0]) <= q[0] && q[0] <= Math.max(p[0], r[0]) &&
    Math.min(p[1], r[1]) <= q[1] && q[1] <= Math.max(p[1], r[1]);
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  return (first * second < 0 && third * fourth < 0) ||
    (first === 0 && onSegment(a, c, b)) || (second === 0 && onSegment(a, d, b)) ||
    (third === 0 && onSegment(c, a, d)) || (fourth === 0 && onSegment(c, b, d));
}

export function geometryOnCampus(points: MapPoint[], boundary: MapPoint[]): boolean {
  if (points.length === 0 || !points.every((point) => pointOnCampus(point, boundary))) return false;
  const edges = boundary.map((point, index) => [point, boundary[(index + 1) % boundary.length]] as const);
  return points.slice(1).every((point, index) =>
    !edges.some(([start, end]) => segmentsIntersect(points[index], point, start, end)),
  );
}

export function paddedCampusBounds(boundary: MapPoint[], paddingMeters = campusBoundaryPaddingMeters) {
  const lats = boundary.map(([lat]) => lat);
  const lngs = boundary.map(([, lng]) => lng);
  const meanLat = lats.reduce((sum, lat) => sum + lat, 0) / lats.length;
  const latPadding = paddingMeters / metersPerDegree;
  const lngPadding = paddingMeters / (metersPerDegree * Math.cos((meanLat * Math.PI) / 180));
  return {
    south: Math.min(...lats) - latPadding,
    west: Math.min(...lngs) - lngPadding,
    north: Math.max(...lats) + latPadding,
    east: Math.max(...lngs) + lngPadding,
  };
}
