import type { Location, Pathway, RouteNode } from "../../types";

export interface PlannedRoute {
  nodes: RouteNode[];
  pathways: Pathway[];
  arrivalGuidance?: string;
}

const weight = (path: Pathway) => {
  const match = path.distance.match(/[\d.]+/);
  return match ? Number(match[0]) : path.pathPoints.length || 1;
};

/** Resolve indoor destinations to an associated entrance, then run Dijkstra over the pedestrian network. */
export function planRoute(destination: Location, _locations: Location[], nodes: RouteNode[], pathways: Pathway[]): PlannedRoute | null {
  const buildingId = destination.type === "Building" ? destination.id : destination.parentId;
  const entrance = nodes.find((node) => node.nodeType === "Entrance" && node.associatedPlaceId === buildingId);
  if (!entrance) return null;
  const distances = new Map<string, number>([[entrance.id, 0]]);
  const previous = new Map<string, { nodeId: string; path: Pathway }>();
  const pending = new Set(nodes.map((node) => node.id));
  while (pending.size) {
    const current = [...pending].reduce<string | null>((best, id) => best === null || (distances.get(id) ?? Infinity) < (distances.get(best) ?? Infinity) ? id : best, null);
    if (!current || !Number.isFinite(distances.get(current))) break;
    pending.delete(current);
    pathways.filter((path) => path.status !== "Closed" && (path.sourceNodeId === current || (path.direction !== "One-way" && path.destinationNodeId === current))).forEach((path) => {
      const next = path.sourceNodeId === current ? path.destinationNodeId : path.sourceNodeId;
      const candidate = distances.get(current)! + weight(path);
      if (candidate < (distances.get(next) ?? Infinity)) { distances.set(next, candidate); previous.set(next, { nodeId: current, path }); }
    });
  }
  const target = entrance;
  const pathList: Pathway[] = [];
  const nodeList = [target];
  let cursor = target.id;
  while (previous.has(cursor)) { const step = previous.get(cursor)!; pathList.unshift(step.path); nodeList.unshift(nodes.find((node) => node.id === step.nodeId)!); cursor = step.nodeId; }
  const indoor = destination.type !== "Building";
  return { nodes: nodeList, pathways: pathList, arrivalGuidance: indoor ? `Arrive at ${entrance.name} · Proceed to ${destination.floor || "the destination floor"}, ${destination.code}` : undefined };
}
