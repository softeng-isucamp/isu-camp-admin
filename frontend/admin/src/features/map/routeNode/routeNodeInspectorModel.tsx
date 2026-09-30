import type { Building, Location, Pathway, RouteNode } from "../../../types";
import type { InspectorCardModel } from "../InspectorCardHUD";
import { validateRouteNodeDraft } from "../mapEditing";
import type { MapPoint } from "../campusBoundary";
import type { SaveAction } from "../session/useSavingAction";
import { calculateDeleteImpact, type DeleteImpact } from "./routeNodeLifecycle";
import type { RouteNodeWorkflow } from "./RouteNodeWorkflow";
import type { useRouteNodeFrame } from "./useRouteNodeFrame";

interface RouteNodeInspectorOptions {
  node: RouteNode;
  frame: ReturnType<typeof useRouteNodeFrame>;
  workflow: RouteNodeWorkflow;
  nodes: RouteNode[];
  pathways: Pathway[];
  buildings: Building[];
  locations: Location[];
  campusBoundary: MapPoint[];
  buildingAssociationOptions: Building[];
  savingAction: SaveAction | null;
  onError: (message: string) => void;
  /** Stores a confirmed Route Node in the Working Session overlay. */
  onNodeUpdated: (node: RouteNode) => void;
  onMove: () => void;
  onDelete: (confirmation: { kind: "route_node"; id: string; name: string; impact: DeleteImpact }) => void;
}

export function routeNodeInspectorModel({
  node,
  frame: nodeFrame,
  workflow,
  nodes: currentNodes,
  pathways: currentPathways,
  buildings: currentBuildings,
  locations: currentLocations,
  campusBoundary,
  buildingAssociationOptions,
  savingAction,
  onError: setError,
  onNodeUpdated: updateNode,
  onMove,
  onDelete,
}: RouteNodeInspectorOptions): InspectorCardModel {
  const stageRouteNodeEdit = (updated: RouteNode) => {
    nodeFrame.stage(updated);
  };
  const connectedPathways = currentPathways.filter((pathway) => pathway.sourceNodeId === node.id || pathway.destinationNodeId === node.id);
  const connectedPaths = connectedPathways.length;
  const nodeFindings = validateRouteNodeDraft(node, {
    buildings: currentBuildings,
    locations: currentLocations,
    campusBoundary,
  });
  const associatedBuilding = node.associatedPlaceId
    ? currentBuildings.find((building) => building.id === node.associatedPlaceId)
      ?? currentLocations.find((location) => location.id === node.associatedPlaceId && (location.type === "Building" || location.type === "Facility"))
    : null;
  return {
    id: node.id,
    kind: node.nodeType === "Entrance" ? "entrance_route_node" : "route_node",
    title: node.name,
    domain: "Walking Network",
    status: node.nodeType === "Entrance" ? "Entrance Route Node" : `${node.nodeType} Route Node`,
    summary: [
      { label: "Node Type", value: node.nodeType },
      { label: "Lifecycle", value: node.status ?? "Active" },
      { label: "Associated Building", value: associatedBuilding?.name ?? (node.associatedPlaceId ? "Missing" : "None") },
      { label: "Connected Pathways", value: String(connectedPaths) },
      { label: "Network Findings", value: nodeFindings.length ? nodeFindings[0].message : "No blocking findings" },
      { label: "Latitude", value: node.lat.toFixed(6) },
      { label: "Longitude", value: node.lng.toFixed(6) },
    ],
    details: (
      <section className="inspector-related-section" aria-label="Edit Route Node metadata">
        <h3>Route Node metadata</h3>
        <div className="inspector-edit-fields">
          <label> Name
            <input aria-label="Route Node name" value={nodeFrame.frame?.name ?? node.name} onChange={(event) => {
              const name = event.target.value;
              stageRouteNodeEdit({ ...(nodeFrame.frame ?? node), name });
            }} />
          </label>
          <label> Node type
            <select aria-label="Route Node type" value={nodeFrame.frame?.nodeType ?? node.nodeType} onChange={(event) => {
              const nodeType = event.target.value as RouteNode["nodeType"];
              stageRouteNodeEdit({ ...(nodeFrame.frame ?? node), nodeType, associatedPlaceId: nodeType === "Entrance" ? nodeFrame.frame?.associatedPlaceId ?? null : null });
            }}>
              <option>Entrance</option><option>Junction</option><option>Access Point</option>
            </select>
          </label>
          {(nodeFrame.frame?.nodeType ?? node.nodeType) === "Entrance" && (
            <label> Building association
              <select aria-label="Route Node association" value={nodeFrame.frame?.associatedPlaceId ?? ""} onChange={(event) => {
                const associatedPlaceId = event.target.value || null;
                stageRouteNodeEdit({ ...(nodeFrame.frame ?? node), associatedPlaceId });
              }}>
                <option value="">No Building association</option>
                {buildingAssociationOptions.map((building) => <option key={building.id} value={building.id}>{building.name} ({building.code})</option>)}
              </select>
              <span className="mt-1 block text-[10px] text-[#526359]">Saved with the Route Node Update action.</span>
            </label>
          )}
        </div>
        <div className="inspector-inline-actions">
          <button type="button" onClick={nodeFrame.cancel} disabled={!nodeFrame.dirty}>Cancel</button>
          <button type="button" onClick={nodeFrame.apply} disabled={!nodeFrame.dirty || savingAction === "route-node-metadata"}>{savingAction === "route-node-metadata" ? "Updating Route Node…" : "Update Route Node"}</button>
        </div>
      </section>
    ),
    primaryAction: { label: node.nodeType === "Entrance" ? "✥ Move Entrance" : "✥ Move Route Node", onSelect: onMove },
    overflowActions: [
      ...(node.nodeType === "Entrance" ? [{
        label: "⎋ Convert to Standard Node",
        tone: "danger" as const,
        onSelect: () => {
          const updated = { ...node, nodeType: "Junction" as const, associatedPlaceId: null };
          void workflow.finalize({
            kind: "update",
            before: node,
            after: updated,
            context: { buildings: currentBuildings, locations: currentLocations, campusBoundary },
            description: `Convert ${node.name} to a standard Route Node`,
          }).then((result) => {
            if (!result.ok) {
              setError(result.message);
              return;
            }
            const confirmed = result.node;
            updateNode(confirmed);
            nodeFrame.load(confirmed);
            setError("");
          });
        },
      }] : []),
      {
        label: "🗑 Delete Route Node",
        tone: "danger" as const,
        onSelect: () => {
          onDelete({ kind: "route_node", id: node.id, name: node.name, impact: calculateDeleteImpact({ object: node, pathways: currentPathways, nodes: currentNodes, buildings: currentBuildings }) });
        },
      },
    ],
  } satisfies InspectorCardModel;
}
