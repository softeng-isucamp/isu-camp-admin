import type { WorkingOperation } from "../features/map/types";
import type { NetworkSnapshot, Pathway, RouteNode } from "./network";
import { validatePathway } from "./network";
import type { MapPoint } from "../features/map/campusBoundary";

export type ImportFindingSeverity = "blocking" | "advisory";

export interface WalkingNetworkImportFinding {
  severity: ImportFindingSeverity;
  row: number;
  entityId?: string;
  message: string;
}

export interface WalkingNetworkImportPreview {
  pathways: Pathway[];
  routeNodes: RouteNode[];
  operations: WorkingOperation[];
  findings: WalkingNetworkImportFinding[];
  affectedEntityIds: string[];
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const coordinate = (value: unknown): { latitude: number; longitude: number } | null => {
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    return Number.isFinite(value[0]) && Number.isFinite(value[1]) ? { latitude: value[0], longitude: value[1] } : null;
  }
  const record = asRecord(value);
  const latitude = typeof record?.latitude === "number" ? record.latitude : typeof record?.lat === "number" ? record.lat : NaN;
  const longitude = typeof record?.longitude === "number" ? record.longitude : typeof record?.lng === "number" ? record.lng : NaN;
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
};

const isRouteRecord = (record: Record<string, unknown>) =>
  record.kind === "Route" || record.entityType === "Route" || record.recordType === "Route" || Array.isArray(record.pathwayIds);

function parseNode(record: Record<string, unknown>): RouteNode | null {
  const id = text(record.id);
  const name = text(record.name);
  const point = coordinate(record);
  const rawType = text(record.type) ?? text(record.nodeType);
  const nodeType = rawType === "Entrance" || rawType === "entrance"
    ? "entrance" : rawType === "Access Point" || rawType === "access_point" ? "access_point" : rawType === "Junction" || rawType === "junction" ? "junction" : null;
  if (!id || !name || !point || !nodeType) return null;
  return {
    id,
    name,
    latitude: point.latitude,
    longitude: point.longitude,
    status: record.status === "inactive" || record.status === "Inactive" ? "inactive" : "active",
    type: nodeType,
    buildingId: nodeType === "entrance" && typeof record.buildingId === "string" ? record.buildingId : null,
  } as RouteNode;
}

function parsePathway(record: Record<string, unknown>): Pathway | null {
  const id = text(record.id);
  const name = text(record.name);
  const sourceNodeId = text(record.sourceNodeId);
  const destinationNodeId = text(record.destinationNodeId);
  const rawPoints = Array.isArray(record.pathPoints) ? record.pathPoints : asRecord(record.pathSequence)?.points;
  if (!id || !name || !sourceNodeId || !destinationNodeId || !Array.isArray(rawPoints)) return null;
  const points = rawPoints.map(coordinate);
  if (points.some((point) => !point)) return null;
  const direction = record.direction === "One-way" || record.direction === "one_way" ? "one_way" : record.direction === "Two-way" || record.direction === "two_way" ? "two_way" : null;
  const status = record.status === "Closed" || record.status === "closed" ? "closed" : record.status === "Open" || record.status === "open" ? "open" : null;
  return {
    id, name, sourceNodeId, destinationNodeId,
    pathSequence: { points: points.map((point) => point!) },
    distanceMeters: typeof record.distanceMeters === "number" ? record.distanceMeters : null,
    estimatedTimeSeconds: typeof record.estimatedTimeSeconds === "number" ? record.estimatedTimeSeconds : null,
    type: text(record.type),
    shade: text(record.shade),
    direction,
    status: status ?? "closed",
  };
}

/** Parse and validate a whole import without mutating the network. */
export function previewWalkingNetworkImport(json: string, snapshot: NetworkSnapshot, campusBoundary?: MapPoint[]): WalkingNetworkImportPreview {
  const findings: WalkingNetworkImportFinding[] = [];
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return { pathways: [], routeNodes: [], operations: [], findings: [{ severity: "blocking", row: 0, message: "Invalid JSON file." }], affectedEntityIds: [] }; }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const importedNodes: RouteNode[] = [];
  const importedPathways: Pathway[] = [];
  const ids = new Set<string>();
  const working = { ...snapshot, routeNodes: [...snapshot.routeNodes], pathways: [...snapshot.pathways] };
  rows.forEach((value, index) => {
    const row = index + 1;
    const record = asRecord(value);
    if (!record) { findings.push({ severity: "blocking", row, message: "Each row must be an object." }); return; }
    if (isRouteRecord(record)) { findings.push({ severity: "blocking", row, message: "Route records are calculated output and cannot be imported as administrable entities." }); return; }
    const explicitNode = record.entityType === "RouteNode" || record.recordType === "RouteNode" || record.kind === "Route Node" || record.nodeType !== undefined || record.latitude !== undefined || record.lat !== undefined;
    const entity = explicitNode ? parseNode(record) : parsePathway(record);
    if (!entity) { findings.push({ severity: "blocking", row, entityId: text(record.id) ?? undefined, message: `Row ${row} is not a valid Pathway or Route Node.` }); return; }
    if (ids.has(entity.id) || working.routeNodes.some((node) => node.id === entity.id) || working.pathways.some((pathway) => pathway.id === entity.id)) {
      findings.push({ severity: "blocking", row, entityId: entity.id, message: `Entity ${entity.id} is duplicated or already exists.` }); return;
    }
    ids.add(entity.id);
    if ("latitude" in entity) {
      if (entity.type === "entrance" && entity.buildingId == null) findings.push({ severity: "advisory", row, entityId: entity.id, message: "Entrance Route Node has no Building association." });
      importedNodes.push(entity); working.routeNodes.push(entity);
    } else {
      try { validatePathway(entity, working, { campusBoundary }); if (!record.status || !["open", "closed", "Open", "Closed"].includes(String(record.status))) throw new Error("Pathway lifecycle status is required."); } catch (error) { findings.push({ severity: "blocking", row, entityId: entity.id, message: error instanceof Error ? error.message : "Invalid Pathway." }); return; }
      if (!entity.shade || entity.distanceMeters == null || entity.estimatedTimeSeconds == null) findings.push({ severity: "advisory", row, entityId: entity.id, message: "Pathway quality metadata is incomplete; review before importing." });
      importedPathways.push(entity); working.pathways.push(entity);
    }
  });
  const operations: WorkingOperation[] = [...importedNodes, ...importedPathways].map((entity) => ({
    id: `import-${entity.id}`,
    type: "create_entity",
    domain: "Routes & Paths",
    entityId: entity.id,
    before: null,
    after: entity as unknown as Record<string, unknown>,
    description: `Import ${"latitude" in entity ? "Route Node" : "Pathway"} ${entity.name}`,
  }));
  return { pathways: importedPathways, routeNodes: importedNodes, operations: findings.some((finding) => finding.severity === "blocking") ? [] : operations, findings, affectedEntityIds: [...new Set(findings.flatMap((finding) => finding.entityId ? [finding.entityId] : [])), ...importedNodes.map((node) => node.id), ...importedPathways.map((pathway) => pathway.id)] };
}
