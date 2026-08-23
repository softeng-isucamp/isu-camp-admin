export type MapPoint = [number, number];

// Echague campus fallback. Live data can override this with the existing
// Whole ISU Campus / CAMPUS_00 polygon.
export const echagueCampusBoundary: MapPoint[] = [
  [16.72305, 121.68735],
  [16.72222, 121.69182],
  [16.72022, 121.69118],
  [16.71835, 121.68945],
  [16.71928, 121.68678],
  [16.72108, 121.68718],
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

export function geometryOnCampus(points: MapPoint[], boundary: MapPoint[]): boolean {
  return points.length > 0 && points.every((point) => pointOnCampus(point, boundary));
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
