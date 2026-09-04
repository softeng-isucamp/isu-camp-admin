import type { Location } from "../../types";
import { pointOnCampus, type MapPoint } from "./campusBoundary";

export interface OutdoorPointLocationInput {
  name: string;
  code: string;
  description: string;
  keywords: string;
  position: MapPoint | null;
}

export type OutdoorPointLocationField = "name" | "code" | "description" | "position";

export interface OutdoorPointLocationIssue {
  field: OutdoorPointLocationField;
  message: string;
}

export const validateOutdoorPointLocation = (
  input: OutdoorPointLocationInput,
  existingLocations: readonly Location[],
  campusBoundary: MapPoint[],
): OutdoorPointLocationIssue[] => {
  const issues: OutdoorPointLocationIssue[] = [];
  if (!input.name.trim()) issues.push({ field: "name", message: "Location name is required." });
  if (!input.code.trim()) issues.push({ field: "code", message: "Location code is required." });
  if (!input.description.trim()) issues.push({ field: "description", message: "Description is required." });

  const duplicate = existingLocations.some(
    (location) => location.code.trim().toLowerCase() === input.code.trim().toLowerCase(),
  );
  if (input.code.trim() && duplicate) {
    issues.push({ field: "code", message: "Location code must be unique." });
  }

  const [latitude, longitude] = input.position ?? [NaN, NaN];
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    issues.push({ field: "position", message: "A finite latitude and longitude are required." });
  } else if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    issues.push({ field: "position", message: "Latitude and longitude must be within their valid ranges." });
  } else if (!pointOnCampus([latitude, longitude], campusBoundary)) {
    issues.push({ field: "position", message: "The point must be inside the ISU Echague campus boundary." });
  }

  return issues;
};
