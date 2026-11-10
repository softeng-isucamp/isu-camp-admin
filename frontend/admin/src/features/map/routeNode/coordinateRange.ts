import type { MapPoint } from "../campusBoundary";

export const LATITUDE_HINT = "Between −90 and 90.";
export const LONGITUDE_HINT = "Between −180 and 180.";

export interface CoordinateRangeIssues {
  latitude?: string;
  longitude?: string;
}

/** Range problems in a typed coordinate pair, for inline feedback before anything is saved. */
export function coordinateRangeIssues(position: MapPoint | null): CoordinateRangeIssues {
  if (!position) return {};
  const [latitude, longitude] = position;
  const issues: CoordinateRangeIssues = {};
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) issues.latitude = "Latitude must be between −90 and 90.";
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) issues.longitude = "Longitude must be between −180 and 180.";
  return issues;
}
