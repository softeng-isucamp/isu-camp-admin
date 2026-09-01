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
  /** Frontend-only mock-session photo metadata; never implies server upload. */
  photo?: {
    name: string;
    type: string;
    dataUrl: string;
  };
  source?: SourceProvenance;
}
export type LocationDraft = Omit<Location, "id"> & { id?: string };
export interface LocationPosition { id: string; lat: number; lng: number; }
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
  type: string;
  direction: "Two-way" | "One-way" | "Unknown";
  status: "Open" | "Closed" | "Unknown";
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
