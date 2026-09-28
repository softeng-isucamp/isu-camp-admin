import type { Pathway, RouteNode } from "../../../types";

export const routeNodePoint = (nodes: RouteNode[], id: string): [number, number] => {
  const node = nodes.find((candidate) => candidate.id === id);
  return node ? [node.lat, node.lng] : [NaN, NaN];
};

export const isPathwayDraft = (value: unknown): value is Pathway => {
  if (!value || typeof value !== "object") return false;
  const pathway = value as Partial<Pathway>;
  return typeof pathway.id === "string"
    && typeof pathway.name === "string"
    && typeof pathway.sourceNodeId === "string"
    && typeof pathway.destinationNodeId === "string"
    && typeof pathway.distance === "string"
    && typeof pathway.time === "string"
    && typeof pathway.shade === "string"
    && typeof pathway.type === "string"
    && typeof pathway.direction === "string"
    && typeof pathway.status === "string"
    && Array.isArray(pathway.pathPoints);
};
