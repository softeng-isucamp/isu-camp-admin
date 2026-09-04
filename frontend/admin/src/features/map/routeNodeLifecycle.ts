import type { Building, Pathway, RouteNode } from "../../types";
import type { WorkingOperation } from "./types";

export type LifecycleAction = "close_pathway" | "reopen_pathway" | "deactivate_node" | "reactivate_node";
export interface LifecycleFinding { severity: "blocking" | "advisory"; objectId: string; message: string; correctiveAction: string; }
export interface LifecycleImpact { action: LifecycleAction; object: Pathway | RouteNode; connectedPathways: Pathway[]; affectedEntrances: RouteNode[]; affectedBuildings: Building[]; buildingsLosingRoutability: Building[]; buildingsRegainingRoutability: Building[]; findings: LifecycleFinding[]; }
export interface LifecycleChange { action: LifecycleAction; record: Pathway | RouteNode; operation: WorkingOperation; }

const active = (record: { status?: string }) => record.status !== "Inactive" && record.status !== "Closed";
const openPathway = (pathway: Pathway) => pathway.status === "Open";
const buildingFor = (node: RouteNode, buildings: readonly Building[]) => node.associatedPlaceId ? buildings.find((building) => building.id === node.associatedPlaceId) : undefined;
const routable = (building: Building, nodes: readonly RouteNode[], pathways: readonly Pathway[]) => nodes.some((node) => node.nodeType === "Entrance" && node.associatedPlaceId === building.id && active(node) && pathways.some((pathway) => openPathway(pathway) && (pathway.sourceNodeId === node.id || pathway.destinationNodeId === node.id)));

export function calculateLifecycleImpact(input: { action: LifecycleAction; object: Pathway | RouteNode; pathways: readonly Pathway[]; nodes: readonly RouteNode[]; buildings: readonly Building[] }): LifecycleImpact {
  const { action, object, pathways, nodes, buildings } = input;
  const isPathway = action === "close_pathway" || action === "reopen_pathway";
  const expectedStatus = action === "close_pathway" ? "Open" : action === "reopen_pathway" ? "Closed" : action === "deactivate_node" ? "Active" : "Inactive";
  const currentStatus = object.status ?? "Active";
  const connectedPathways = isPathway ? [object as Pathway] : pathways.filter((pathway) => pathway.sourceNodeId === object.id || pathway.destinationNodeId === object.id);
  const affectedEntrances = nodes.filter((node) => node.nodeType === "Entrance" && (
    (!isPathway && node.id === object.id)
    || connectedPathways.some((pathway) => pathway.sourceNodeId === node.id || pathway.destinationNodeId === node.id)
  ));
  const affectedBuildings = affectedEntrances.map((node) => buildingFor(node, buildings)).filter((building): building is Building => Boolean(building));
  const nextNodes: RouteNode[] = nodes.map((node) => node.id === object.id && !isPathway
    ? { ...node, status: (action === "deactivate_node" ? "Inactive" : "Active") as RouteNode["status"] }
    : node);
  const nextPathways: Pathway[] = pathways.map((pathway) => pathway.id === object.id && isPathway
    ? { ...pathway, status: (action === "close_pathway" ? "Closed" : "Open") as Pathway["status"] }
    : pathway);
  const losing = action === "close_pathway" || action === "deactivate_node" ? affectedBuildings.filter((building) => routable(building, nodes, pathways) && !routable(building, nextNodes, nextPathways)) : [];
  const regaining = action === "reopen_pathway" || action === "reactivate_node" ? affectedBuildings.filter((building) => !routable(building, nodes, pathways) && routable(building, nextNodes, nextPathways)) : [];
  const findings: LifecycleFinding[] = currentStatus !== expectedStatus ? [{
    severity: "blocking",
    objectId: object.id,
    message: `${object.name} cannot be transitioned because it is currently ${currentStatus}.`,
    correctiveAction: `Refresh the record and choose the lifecycle action for its current status (${currentStatus}).`,
  }] : [];
  findings.push(...losing.map((building): LifecycleFinding => ({
    severity: "advisory",
    objectId: object.id,
    message: `${building.name} would lose routability if ${lifecycleActionLabel(action)} is confirmed.`,
    correctiveAction: "Add another active Entrance Route Node or keep this network object active.",
  })));
  return { action, object, connectedPathways, affectedEntrances, affectedBuildings, buildingsLosingRoutability: losing, buildingsRegainingRoutability: regaining, findings };
}

export function buildLifecycleChange(action: LifecycleAction, record: Pathway | RouteNode): LifecycleChange {
  const status = action === "close_pathway" ? "Closed" : action === "deactivate_node" ? "Inactive" : action === "reopen_pathway" ? "Open" : "Active";
  const updated = { ...record, status } as Pathway | RouteNode;
  return { action, record: updated, operation: { id: `${action}-${record.id}`, type: action === "reopen_pathway" || action === "reactivate_node" ? "restore_entity" : "retire_entity", domain: "Walking Network", entityId: record.id, before: record as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, description: `${lifecycleActionLabel(action)} ${record.name}` } };
}

export function lifecycleActionLabel(action: LifecycleAction): string {
  return action === "close_pathway" ? "Close Pathway" : action === "reopen_pathway" ? "Reopen Pathway" : action === "deactivate_node" ? "Deactivate Route Node" : "Reactivate Route Node";
}

/** Builds the atomic graph change required when a Route Node is deactivated. */
export const deactivateRouteNode = (node: RouteNode, _connectedPathways: Pathway[] = []) => buildLifecycleChange("deactivate_node", node);
