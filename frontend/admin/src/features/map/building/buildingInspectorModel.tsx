import type { Location, RouteNode } from "../../../types";
import type { InspectorCardModel } from "../InspectorCardHUD";
import type { SelectedBuildingView } from "./selectedBuilding";

interface BuildingInspectorActions {
  onReshape: () => void;
  onEditDetails: () => void;
  onAddIndoorLocation: () => void;
  onMarkIndoorLocation: () => void;
  onAddEntrance: () => void;
  onToggleLinkEntrance: () => void;
  onLinkExistingEntrance: () => void;
  onLinkEntrance: (node: RouteNode) => void;
  onDelete: () => void;
}

interface BuildingInspectorOptions {
  view: SelectedBuildingView;
  contentLocations: Location[];
  nodes: RouteNode[];
  linkingEntrance: boolean;
  actions: BuildingInspectorActions;
}

export function buildingInspectorModel({
  view,
  contentLocations: buildingContentLocations,
  nodes: currentNodes,
  linkingEntrance: linkingBuildingEntrance,
  actions,
}: BuildingInspectorOptions): InspectorCardModel {
  const {
    building: selectedBuilding,
    location: selectedBuildingLocation,
    entrances: selectedBuildingEntrances,
    hasFootprint: selectedBuildingHasFootprint,
    routable: selectedBuildingRoutable,
  } = view;
  return {
    id: selectedBuilding.id,
    kind: "building",
    title: selectedBuilding.name,
    domain: "Locations",
    status: selectedBuildingRoutable ? "Routable" : "Not routable",
    summary: [
      { label: "Code", value: selectedBuilding.code },
      { label: "Geometry", value: `Building Footprint · ${selectedBuilding.points.length} vertices` },
      { label: "Entrances", value: String(selectedBuildingEntrances.length) },
    ],
    details: (
      <>
        <section aria-label="Building summary" className="inspector-related-section">
          <h3>Building summary</h3>
          <p>{selectedBuilding.code} · {(selectedBuilding.type ?? selectedBuildingLocation?.type ?? "Building")}</p>
          <p>{selectedBuildingHasFootprint ? "Building Footprint" : "Footprint needed"} · {selectedBuildingRoutable ? "Routable" : "Not routable"}</p>
        </section>
        <section aria-label="Building content" className="inspector-related-section">
          <div className="flex items-center justify-between gap-2">
            <h3>Building content</h3>
            {(selectedBuilding.type ?? selectedBuildingLocation?.type ?? "Building") === "Building" && <button type="button" className="inspector-secondary-action" onClick={actions.onAddIndoorLocation}>＋ Add indoor location</button>}
          </div>
          <section aria-label="Building room directory">
            <div className="inspector-related-heading">
              <div>
                <h4>Indoor locations by floor</h4>
                <span>{buildingContentLocations.filter((location) => location.parentId === selectedBuilding.id || location.building === selectedBuilding.name).length} places</span>
              </div>
            </div>
            {(() => {
              const children = buildingContentLocations.filter((location) => location.parentId === selectedBuilding.id || location.building === selectedBuilding.name);
              const grouped = new Map<string, Location[]>();
              children.forEach((child) => {
                const floor = child.floor || "Unspecified Floor";
                grouped.set(floor, [...(grouped.get(floor) ?? []), child]);
              });
              return grouped.size ? [...grouped.entries()].map(([floor, rooms]) => (
                <div key={floor} role="region" className="inspector-floor-group" aria-label={`${floor} indoor locations`}>
                  <div className="inspector-floor-heading"><strong><span aria-hidden="true">⌄</span>{floor}</strong><span>{rooms.length}</span></div>
                  {rooms.map((room) => <div key={room.id} className="inspector-location-row"><span className="inspector-content-icon" aria-hidden="true">{room.type === "Laboratory" ? "L" : "R"}</span><div><strong>{room.name}</strong><span>{room.type} · {room.code}</span></div></div>)}
                </div>
              )) : <p>No Indoor Locations recorded.</p>;
            })()}
          </section>
        </section>
        <section aria-label="Walking access" className="inspector-related-section">
          <div className="inspector-related-heading">
            <div>
              <h3>Walking access</h3>
              <span>{selectedBuildingEntrances.length} linked {selectedBuildingEntrances.length === 1 ? "entrance" : "entrances"}</span>
            </div>
          </div>
          <section aria-label="Building entrances">
            <h4>Entrance route nodes</h4>
            {selectedBuildingEntrances.length
              ? <div className="inspector-node-list">{selectedBuildingEntrances.map((node) => <div key={node.id} className="inspector-node-row"><span className="inspector-node-icon" aria-hidden="true">⌖</span><div><strong>{node.name}</strong><span>{node.lat.toFixed(5)}, {node.lng.toFixed(5)}</span></div><em>{node.status === "Inactive" ? "Inactive" : "Active"}</em></div>)}</div>
              : <p>No active Entrance Route Node.</p>}
          </section>
          <div className="inspector-inline-actions">
            <button type="button" onClick={actions.onAddEntrance}>＋ Add entrance</button>
            <button type="button" onClick={actions.onToggleLinkEntrance}>↔ Link existing entrance</button>
          </div>
          {linkingBuildingEntrance && (
            <div className="inspector-related-group" aria-label="Existing Entrance Route Nodes">
              <strong>Select an existing Entrance Route Node</strong>
              {currentNodes.filter((node) => node.nodeType === "Entrance").map((node) => <button key={node.id} type="button" onClick={() => actions.onLinkEntrance(node)}>Link {node.name}</button>)}
              {!currentNodes.some((node) => node.nodeType === "Entrance") && <span>No Entrance Route Nodes available.</span>}
            </div>
          )}
        </section>
      </>
    ),
    primaryAction: {
      label: "▱ Reshape Footprint",
      onSelect: actions.onReshape,
    },
    overflowActions: [
      { label: "✎ Edit Details", onSelect: actions.onEditDetails },
      ...((selectedBuilding.type ?? selectedBuildingLocation?.type ?? "Building") === "Building" ? [{ label: "＋ Add indoor location", onSelect: actions.onAddIndoorLocation }] : []),
      ...((selectedBuilding.type ?? selectedBuildingLocation?.type ?? "Building") === "Building" ? [{ label: "⌂ Mark indoor location", onSelect: actions.onMarkIndoorLocation }] : []),
      { label: "＋ Add entrance", onSelect: actions.onAddEntrance },
      { label: "↔ Link existing entrance", onSelect: actions.onLinkExistingEntrance },
      { label: "🗑 Delete Building", tone: "danger" as const, onSelect: actions.onDelete },
    ],
  } satisfies InspectorCardModel;
}
