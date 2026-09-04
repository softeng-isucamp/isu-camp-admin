import type { Building as LegacyBuilding, Pathway as LegacyPathway, RouteNode as LegacyRouteNode } from "../types";
import { normalizePathwayLifecycleStatus, normalizePathwayWayType, PATHWAY_WAY_TYPES } from "../types";
import { geometryOnCampus, type MapPoint } from "../features/map/campusBoundary";

export type NetworkStatus = "active" | "inactive";
export type PathwayStatus = "active" | "closed";
export type TravelMode = "walking" | "vehicle";
export type Coordinate = { latitude: number; longitude: number };
export type PathPoint = Coordinate;
export type PathSequence = { points: PathPoint[] };

/** A calculated journey; Routes are intentionally not persisted by this admin seam. */
export interface Route {
  id: string;
  pathwayIds: string[];
}

export interface Building {
  id: string;
  name: string;
  code: string;
  geometry: PathPoint[] | null;
  status: NetworkStatus;
}

export interface BaseRouteNode {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  status: NetworkStatus;
  type: "junction" | "access_point";
  buildingId: null;
}

export interface EntranceRouteNode {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  status: NetworkStatus;
  type: "entrance";
  buildingId: string | null;
}

export type RouteNode = BaseRouteNode | EntranceRouteNode;

export interface Pathway {
  id: string;
  name: string;
  sourceNodeId: string;
  destinationNodeId: string;
  pathSequence: PathSequence;
  distanceMeters: number | null;
  estimatedTimeSeconds: number | null;
  type: string | null;
  shade: string | null;
  direction: "two_way" | "one_way" | null;
  status: PathwayStatus;
  allowedModes?: TravelMode[];
}

export type PathwayWriteRequest = Omit<Pathway, "id"> & { id?: string };
export type BuildingWriteRequest = Omit<Building, "id"> & { id?: string };
export type RouteNodeWriteRequest = Omit<RouteNode, "id"> & { id?: string };

export interface NetworkSnapshot {
  buildings: Building[];
  routeNodes: RouteNode[];
  pathways: Pathway[];
}

export type BuildingRoutabilityReason = "inactive_building" | "unpositioned_building" | "no_active_entrance";
export interface BuildingRoutability {
  routable: boolean;
  reason: BuildingRoutabilityReason | null;
  entranceIds: string[];
}

/** The single definition used by network consumers when deciding whether a Building is reachable. */
export const evaluateBuildingRoutability = (
  building: Building,
  routeNodes: readonly RouteNode[],
): BuildingRoutability => {
  const entranceIds = routeNodes
    .filter((node): node is EntranceRouteNode => node.type === "entrance" && node.buildingId === building.id && node.status === "active")
    .map((node) => node.id);
  if (building.status !== "active") return { routable: false, reason: "inactive_building", entranceIds };
  if (!building.geometry || building.geometry.length < 3 || building.geometry.some((point) => !coordinate(point))) {
    return { routable: false, reason: "unpositioned_building", entranceIds };
  }
  if (!entranceIds.length) return { routable: false, reason: "no_active_entrance", entranceIds };
  return { routable: true, reason: null, entranceIds };
};

export interface MapDraftSaveRequest {
  buildings?: Building[];
  routeNodes?: RouteNode[];
  pathways?: Pathway[];
}

const finite = (value: number) => Number.isFinite(value);
const coordinate = (value: Coordinate) => finite(value.latitude) && finite(value.longitude)
  && value.latitude >= -90 && value.latitude <= 90
  && value.longitude >= -180 && value.longitude <= 180;

export interface PathwayValidationOptions {
  campusBoundary?: MapPoint[];
  /** The pathway being replaced is ignored when checking duplicate connections. */
  existingPathwayId?: string;
}

/** A shared graph edge may be used by one or both supported travel modes. */
export const pathwayAllowsMode = (pathway: Pick<Pathway, "status" | "allowedModes">, mode: TravelMode): boolean =>
  pathway.status === "active" && (pathway.allowedModes ?? ["walking"]).includes(mode);

export const filterPathwaysByMode = (pathways: readonly Pathway[], mode: TravelMode): Pathway[] =>
  pathways.filter((pathway) => pathwayAllowsMode(pathway, mode));

const pathwayKey = (sourceNodeId: string, destinationNodeId: string) =>
  [sourceNodeId, destinationNodeId].sort().join("::");

/** Validate one managed Pathway against the current relational network. */
export const validatePathway = (
  pathway: PathwayWriteRequest,
  snapshot: NetworkSnapshot,
  options: PathwayValidationOptions = {},
): void => {
  if (!pathway.name.trim()) throw new Error("Pathway name is required.");
  if (!pathway.type?.trim()) throw new Error("Pathway type is required.");
  if (!pathway.direction) throw new Error("Pathway direction is required.");
  if (!pathway.status) throw new Error("Pathway lifecycle status is required.");
  if (pathway.direction !== "two_way" && pathway.direction !== "one_way") throw new Error("Pathway direction must be two_way or one_way.");
  if (pathway.status !== "active" && pathway.status !== "closed") throw new Error("Pathway lifecycle status must be active or closed.");
  if (!pathway.allowedModes?.length || pathway.allowedModes.some((mode) => mode !== "walking" && mode !== "vehicle")) throw new Error("At least one valid Allowed mode is required.");
  if (pathway.type === "Walkway" && pathway.allowedModes.includes("vehicle")) throw new Error("Walkways cannot allow Vehicle mode.");
  if (!PATHWAY_WAY_TYPES.includes(pathway.type as typeof PATHWAY_WAY_TYPES[number])) {
    throw new Error("Pathway Way type must use the fixed vocabulary: Walkway or Road.");
  }
  const source = snapshot.routeNodes.find((node) => node.id === pathway.sourceNodeId);
  const destination = snapshot.routeNodes.find((node) => node.id === pathway.destinationNodeId);
  if (!source || !destination) throw new Error("Pathway endpoints must reference existing Route Nodes.");
  if (source.status !== "active" || destination.status !== "active") {
    throw new Error("Pathway endpoints must reference active Route Nodes.");
  }
  if (pathway.sourceNodeId === pathway.destinationNodeId) {
    throw new Error("Pathway endpoints must be distinct; self-links are not allowed.");
  }
  const duplicate = snapshot.pathways.find((candidate) =>
    candidate.id !== (options.existingPathwayId ?? pathway.id) &&
    pathwayKey(candidate.sourceNodeId, candidate.destinationNodeId) === pathwayKey(pathway.sourceNodeId, pathway.destinationNodeId),
  );
  if (duplicate) throw new Error(`Pathway duplicates the physical connection already used by ${duplicate.name}.`);
  pathway.pathSequence.points.forEach((point) => {
    if (!coordinate(point)) throw new Error("Every Path Point must contain valid latitude and longitude coordinates.");
  });
  if (options.campusBoundary) {
    const geometry = [
      { latitude: source.latitude, longitude: source.longitude },
      ...pathway.pathSequence.points,
      { latitude: destination.latitude, longitude: destination.longitude },
    ].map((point) => [point.latitude, point.longitude] as MapPoint);
    if (!geometryOnCampus(geometry, options.campusBoundary)) {
      throw new Error("Pathway geometry must remain inside the ISU Echague campus boundary.");
    }
  }
};

export const parseDistanceMeters = (value: string | number | null | undefined): number | null => {
  if (typeof value === "number") return finite(value) ? value : null;
  if (!value || /^(unknown|—|-|n\/a)$/i.test(value.trim())) return null;
  const match = value.match(/[\d.]+/);
  if (!match) return null;
  const amount = Number(match[0]);
  if (!finite(amount)) return null;
  return /km/i.test(value) ? amount * 1000 : amount;
};

export const parseEstimatedTimeSeconds = (value: string | number | null | undefined): number | null => {
  if (typeof value === "number") return finite(value) ? value : null;
  if (!value || /^(unknown|—|-|n\/a)$/i.test(value.trim())) return null;
  const match = value.match(/[\d.]+/);
  if (!match) return null;
  const amount = Number(match[0]);
  if (!finite(amount)) return null;
  return /h(ours?)?/i.test(value) ? amount * 3600 : /s(ec(onds?)?)?/i.test(value) ? amount : amount * 60;
};

export const formatDistanceMeters = (value: number | null): string => value == null ? "—" : `${value % 1 ? value.toFixed(1) : value} m`;
export const formatEstimatedTimeSeconds = (value: number | null): string => {
  if (value == null) return "—";
  if (value >= 3600) return `${Math.round(value / 3600)} hr`;
  return `${Math.max(1, Math.round(value / 60))} min`;
};

const legacyCoordinate = ([latitude, longitude]: [number, number]): Coordinate => ({ latitude, longitude });
const legacyStatus = (value: string | undefined): NetworkStatus => value === "Inactive" ? "inactive" : "active";

export const normalizeBuilding = (value: LegacyBuilding, id = value.id): Building => ({
  id,
  name: value.name,
  code: value.code,
  geometry: value.points.length ? value.points.map(legacyCoordinate) : null,
  status: legacyStatus(value.status),
});

export const normalizeRouteNode = (value: LegacyRouteNode): RouteNode => {
  const type = value.nodeType === "Entrance" ? "entrance" : value.nodeType === "Access Point" ? "access_point" : "junction";
  return {
    id: value.id,
    name: value.name,
    latitude: value.lat,
    longitude: value.lng,
    status: "active",
    type,
    buildingId: type === "entrance" ? value.associatedPlaceId ?? null : null,
  } as RouteNode;
};

export const normalizePathway = (value: LegacyPathway): Pathway => ({
  id: value.id,
  name: value.name,
  sourceNodeId: value.sourceNodeId,
  destinationNodeId: value.destinationNodeId,
  pathSequence: { points: value.pathPoints.map(legacyCoordinate) },
  distanceMeters: parseDistanceMeters(value.distance),
  estimatedTimeSeconds: parseEstimatedTimeSeconds(value.time),
  type: value.type ? normalizePathwayWayType(value.type) : null,
  shade: value.shade === "Unknown" ? null : value.shade,
  direction: value.direction === "Two-way" ? "two_way" : value.direction === "One-way" ? "one_way" : null,
  status: normalizePathwayLifecycleStatus(value.status) === "Active" ? "active" : "closed",
  allowedModes: normalizeAllowedModes(value.type, value.allowedModes),
});

export const validateNetworkSnapshot = (snapshot: NetworkSnapshot): void => {
  const nodeIds = new Set(snapshot.routeNodes.map((node) => node.id));
  const buildingIds = new Set(snapshot.buildings.map((building) => building.id));
  snapshot.routeNodes.forEach((node) => {
    if (!coordinate({ latitude: node.latitude, longitude: node.longitude })) throw new Error(`Invalid coordinates for Route Node ${node.id}.`);
    if (node.type !== "entrance" && node.buildingId !== null) throw new Error(`Only Entrance Route Nodes may reference a Building.`);
    if (node.buildingId !== null && !buildingIds.has(node.buildingId)) throw new Error(`Building ${node.buildingId} was not found.`);
  });
  snapshot.buildings.forEach((building) => building.geometry?.forEach((point) => {
    if (!coordinate(point)) throw new Error(`Invalid geometry for Building ${building.id}.`);
  }));
  const connections = new Set<string>();
  snapshot.pathways.forEach((pathway) => {
    if (!pathway.name.trim()) throw new Error(`Pathway ${pathway.id} must have a name.`);
    if (!pathway.type?.trim()) throw new Error(`Pathway ${pathway.id} must have a type.`);
    if (!pathway.direction) throw new Error(`Pathway ${pathway.id} must have a direction.`);
    if (pathway.status !== "active" && pathway.status !== "closed") throw new Error(`Pathway ${pathway.id} must have an active or closed lifecycle status.`);
    if (!pathway.allowedModes?.length || pathway.allowedModes.some((mode) => mode !== "walking" && mode !== "vehicle")) throw new Error(`Pathway ${pathway.id} must allow at least one valid travel mode.`);
    if (pathway.type === "Walkway" && pathway.allowedModes.includes("vehicle")) throw new Error(`Pathway ${pathway.id} cannot allow Vehicle mode because it is a Walkway.`);
    if (!PATHWAY_WAY_TYPES.includes(pathway.type as typeof PATHWAY_WAY_TYPES[number])) throw new Error(`Pathway ${pathway.id} has an unsupported Way type.`);
    if (!nodeIds.has(pathway.sourceNodeId) || !nodeIds.has(pathway.destinationNodeId)) throw new Error(`Pathway ${pathway.id} references a missing Route Node.`);
    if (pathway.sourceNodeId === pathway.destinationNodeId) throw new Error(`Pathway endpoints must be distinct.`);
    const key = pathwayKey(pathway.sourceNodeId, pathway.destinationNodeId);
    if (connections.has(key)) throw new Error(`Pathway ${pathway.id} duplicates an existing physical connection.`);
    connections.add(key);
    pathway.pathSequence.points.forEach((point) => { if (!coordinate(point)) throw new Error(`Invalid Path Point in Pathway ${pathway.id}.`); });
  });
};

export const emptyNetworkSnapshot = (): NetworkSnapshot => ({ buildings: [], routeNodes: [], pathways: [] });

export type LegacyNetworkData = {
  buildings: LegacyBuilding[];
  nodes: LegacyRouteNode[];
  pathways: LegacyPathway[];
  /** Maps legacy map-building names to the authoritative Location IDs. */
  locationBuildings?: Array<Pick<LegacyBuilding, "id" | "name">>;
};

const NETWORK_KEY = "isucamp_canonical_network";
const copy = <T>(value: T): T => structuredClone(value);
const normalizeAllowedModes = (type: string | null | undefined, modes: readonly string[] | undefined): TravelMode[] => {
  const normalizedModes = (modes ?? ["walking"])
    .map((mode) => mode.toLowerCase() === "vehicle" ? "vehicle" : mode.toLowerCase() === "walking" ? "walking" : null)
    .filter((mode): mode is TravelMode => mode !== null);
  return normalizePathwayWayType(type ?? undefined) === "Walkway" ? ["walking"] : normalizedModes.length ? [...new Set(normalizedModes)] : ["walking"];
};

export const createCanonicalNetworkStore = (seed: LegacyNetworkData, storage: Storage | null) => {
  let snapshot = (() => {
    if (storage) {
      try {
        const saved = JSON.parse(storage.getItem(NETWORK_KEY) ?? "null") as NetworkSnapshot | null;
        if (saved) {
          const normalized: NetworkSnapshot = {
            ...saved,
            pathways: saved.pathways.map((pathway) => ({
              ...pathway,
              type: normalizePathwayWayType(pathway.type ?? undefined) === "Unknown" ? "Walkway" : normalizePathwayWayType(pathway.type ?? undefined),
              status: normalizePathwayLifecycleStatus(pathway.status) === "Active" ? "active" : "closed",
              allowedModes: normalizeAllowedModes(pathway.type, pathway.allowedModes),
            })),
          };
          validateNetworkSnapshot(normalized);
          return normalized;
        }
      } catch { /* A corrupt draft must not prevent the app from loading fixtures. */ }
    }
    const initial: NetworkSnapshot = {
      buildings: seed.buildings.map((building) => normalizeBuilding(
        building,
        seed.locationBuildings?.find((location) => location.name === building.name)?.id,
      )),
      routeNodes: seed.nodes.map(normalizeRouteNode),
      // Legacy fixtures may have omitted managed metadata. Normalize those
      // records at the adapter boundary so the canonical store never carries
      // an unknown direction or blank type.
      pathways: seed.pathways.map(normalizePathway).map((pathway) => ({
        ...pathway,
        type: normalizePathwayWayType(pathway.type ?? undefined) === "Unknown" ? "Walkway" : pathway.type,
        direction: pathway.direction ?? "two_way",
        allowedModes: normalizeAllowedModes(pathway.type, pathway.allowedModes),
      })),
    };
    // Keep the local contract useful when the seed predates explicit entrance
    // associations. These records are deterministic and live only in the
    // canonical store.
    const firstBuilding = initial.buildings[0];
    const entranceNodes = initial.routeNodes.filter((node): node is EntranceRouteNode => node.type === "entrance");
    if (firstBuilding && entranceNodes.length >= 2) {
      entranceNodes[0].buildingId = firstBuilding.id;
      entranceNodes[1].buildingId = firstBuilding.id;
    } else if (firstBuilding && initial.routeNodes.length >= 2) {
      const source = initial.routeNodes[0];
      const destination = initial.routeNodes[1];
      initial.routeNodes.push(
        { id: "fixture-entrance-a", name: "Fixture Main Entrance", type: "entrance", buildingId: firstBuilding.id, status: "active", latitude: source.latitude, longitude: source.longitude },
        { id: "fixture-entrance-b", name: "Fixture Side Entrance", type: "entrance", buildingId: firstBuilding.id, status: "active", latitude: destination.latitude, longitude: destination.longitude },
      );
    }
    const straightPair = initial.routeNodes.flatMap((source, index) =>
      initial.routeNodes.slice(index + 1).map((destination) => [source, destination] as const),
    ).find(([source, destination]) => !initial.pathways.some((pathway) =>
      pathwayKey(pathway.sourceNodeId, pathway.destinationNodeId) === pathwayKey(source.id, destination.id),
    ));
    if (straightPair) {
      initial.pathways.push({
        id: "fixture-straight-pathway",
        name: "Fixture Straight Walk",
        sourceNodeId: straightPair[0].id,
        destinationNodeId: straightPair[1].id,
        pathSequence: { points: [] },
        distanceMeters: null,
        estimatedTimeSeconds: null,
        type: "Walkway",
        shade: null,
        direction: "two_way",
        status: "active",
        allowedModes: ["walking"],
      });
    }
    validateNetworkSnapshot(initial);
    return initial;
  })();

  const persist = () => storage?.setItem(NETWORK_KEY, JSON.stringify(snapshot));
  const read = (): NetworkSnapshot => copy(snapshot);
  const write = (next: NetworkSnapshot): NetworkSnapshot => {
    validateNetworkSnapshot(next);
    snapshot = copy(next);
    persist();
    return read();
  };

  const savePathway = (pathway: PathwayWriteRequest, options?: PathwayValidationOptions): Pathway => {
    const current = read();
    const normalizedType = normalizePathwayWayType(pathway.type ?? undefined);
    const next: Pathway = {
      ...pathway,
      id: pathway.id ?? `pathway-${Date.now()}`,
      type: normalizedType === "Unknown" ? pathway.type : normalizedType,
      allowedModes: normalizeAllowedModes(pathway.type, pathway.allowedModes),
    };
    validatePathway(next, current, { ...options, existingPathwayId: next.id });
    const index = current.pathways.findIndex((candidate) => candidate.id === next.id);
    if (index >= 0) current.pathways[index] = next;
    else current.pathways.push(next);
    return write(current).pathways.find((candidate) => candidate.id === next.id)!;
  };

  const setPathwayStatus = (id: string, status: PathwayStatus): Pathway => {
    const current = read();
    const pathway = current.pathways.find((candidate) => candidate.id === id);
    if (!pathway) throw new Error("Pathway not found.");
    if (status === "active") validatePathway({ ...pathway, status }, current, { existingPathwayId: id });
    pathway.status = status;
    return write(current).pathways.find((candidate) => candidate.id === id)!;
  };

  const removePathway = (id: string, confirmed = false): void => {
    if (!confirmed) throw new Error("Deleting a Pathway requires explicit confirmation.");
    const current = read();
    const index = current.pathways.findIndex((candidate) => candidate.id === id);
    if (index < 0) throw new Error("Pathway not found.");
    current.pathways.splice(index, 1);
    write(current);
  };

  const associateEntrance = (nodeId: string, buildingId: string): RouteNode => {
    const current = read();
    if (!current.buildings.some((building) => building.id === buildingId)) throw new Error("Building not found.");
    const node = current.routeNodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw new Error("Route Node not found.");
    const next: EntranceRouteNode = { ...node, type: "entrance", buildingId } as EntranceRouteNode;
    const index = current.routeNodes.findIndex((candidate) => candidate.id === nodeId);
    current.routeNodes[index] = next;
    return write(current).routeNodes[index];
  };

  const clearEntranceAssociation = (nodeId: string): RouteNode => {
    const current = read();
    const node = current.routeNodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw new Error("Route Node not found.");
    const next: BaseRouteNode = { ...node, type: "access_point", buildingId: null } as BaseRouteNode;
    const index = current.routeNodes.findIndex((candidate) => candidate.id === nodeId);
    current.routeNodes[index] = next;
    return write(current).routeNodes[index];
  };

  return {
    snapshot: read,
    save: write,
    savePathway,
    closePathway: (id: string) => setPathwayStatus(id, "closed"),
    reopenPathway: (id: string) => setPathwayStatus(id, "active"),
    removePathway,
    associateEntrance,
    clearEntranceAssociation,
    buildings: () => read().buildings,
    routeNodes: () => read().routeNodes,
    pathways: () => read().pathways,
  };
};
