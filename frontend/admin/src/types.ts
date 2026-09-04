export type LocationType =
  | "Building"
  | "Floor"
  | "Room"
  | "Office"
  | "Laboratory"
  | "Restroom"
  | "Facility";
export type RecordStatus = "Active" | "Inactive" | "Open" | "Closed" | "Unknown";
export type Shade =
  "Fully Shaded" | "Mostly Shaded" | "Partial Shade" | "Unshaded" | "Unknown";
export const PATHWAY_WAY_TYPES = ["Walkway", "Road", "Ramp", "Stairs", "Service path"] as const;
export type PathwayType = typeof PATHWAY_WAY_TYPES[number];
export const PATHWAY_ALLOWED_MODES = ["Walking", "Vehicle"] as const;
export type AllowedMode = typeof PATHWAY_ALLOWED_MODES[number];
export type PathwayLifecycleStatus = "Active" | "Closed" | "Open" | "Unknown";

/** Normalize compatibility values at the application boundary. */
export const normalizePathwayLifecycleStatus = (status: string | undefined): PathwayLifecycleStatus =>
  status === "Open" || status === "open" || status === "Active" || status === "active" ? "Active" : status === "Closed" || status === "closed" ? "Closed" : "Unknown";

/** Convert historical labels into the controlled Way type vocabulary. */
export const normalizePathwayWayType = (type: string | undefined): PathwayType | "Unknown" => {
  const normalized = type?.trim().toLowerCase() ?? "";
  const fixedType = PATHWAY_WAY_TYPES.find((candidate) => candidate.toLowerCase() === normalized);
  if (fixedType) return fixedType;
  if (/^(campus )?walkway$|^pedestrian path$|^walk$|^path$/.test(normalized)) return "Walkway";
  if (/^service road$/.test(normalized)) return "Service path";
  return "Unknown";
};
export interface SourceProvenance {
  provider: string;
  sourceType: string;
  sourceId: number;
  url: string | null;
  rawId: string | null;
}
export interface Building {
  id: string;
  name: string;
  code: string;
  type?: "Building" | "Facility";
  points: [number, number][];
  status?: RecordStatus;
  source?: SourceProvenance;
}
export interface Location {
  id: string;
  name: string;
  code: string;
  type: LocationType;
  parentId: string | null;
  building?: string;
  floor?: string;
  function?: string;
  keywords?: string;
  status: RecordStatus;
  lat: number | null;
  lng: number | null;
  positioned: boolean;
  /** Internal Admin Draft marker for footprint-backed Facilities. */
  spatialRole?: "building_footprint_owner";
  hasPhoto?: boolean;
  /** Frontend-only mock-session photo metadata; never implies server upload. */
  photo?: {
    name: string;
    type: string;
    dataUrl: string;
  };
  photoRemoved?: boolean;
  source?: SourceProvenance;
}
export type LocationDraft = Omit<Location, "id"> & { id?: string };
export interface LocationPosition { id: string; lat: number | null; lng: number | null; }
export interface RouteNode {
  id: string;
  name: string;
  nodeType: "Entrance" | "Junction" | "Access Point";
  associatedPlaceId?: string | null;
  lat: number;
  lng: number;
  status?: RecordStatus;
  sourceOsmNodeId?: number | null;
  sourceWayId?: number;
  sourceWayIds?: number[];
  source?: SourceProvenance;
}
export interface Pathway {
  id: string;
  name: string;
  sourceNodeId: string;
  destinationNodeId: string;
  distance: string;
  time: string;
  shade: Shade;
  type: PathwayType | string;
  direction: "Two-way" | "One-way" | "Unknown";
  status: PathwayLifecycleStatus;
  /** Independent travel-mode permissions for the shared routing graph. */
  allowedModes?: AllowedMode[];
  pathPoints: [number, number][];
  sourceOsmNodeIds?: number[];
  sourceWayId?: number;
  source?: SourceProvenance;
}
export interface UserAccount {
  id: string;
  username: string;
  createdAt: string;
  lastSignIn: string | null;
  role: "Administrator" | "Staff" | "User";
}
export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string;
  targetId?: string;
  detail?: string;
  createdAt: string;
  category: "Admin" | "User" | "System";
}
export interface Session {
  id: string;
  username: string;
}
export interface DashboardSummary {
  buildings: number;
  offices: number;
  locations: number;
  pathways: number;
  searches: number;
  topSearched: TopSearchedLocation[];
  recent: AuditEntry[];
}
export interface TopSearchedLocation {
  rank: string;
  name: string;
  context: string;
  searches: number;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  type: "info" | "success" | "warning";
}
export interface MapSavePayload {
  selected?: { type: string; id: string };
  place?: [number, number] | null;
  pathPoints?: [number, number][];
  areaPoints?: [number, number][];
  newNode?: {
    name: string;
    nodeType: "Entrance" | "Junction" | "Access Point";
    associatedPlaceId?: string | null;
    lat: number;
    lng: number;
  };
  movedLocation?: { id: string; lat: number; lng: number };
  movedNode?: { id: string; lat: number; lng: number };
  updatedPath?: { id: string; pathPoints: [number, number][] };
  locations?: Location[];
  nodes?: RouteNode[];
  buildings?: Building[];
  pathways?: Pathway[];
}
