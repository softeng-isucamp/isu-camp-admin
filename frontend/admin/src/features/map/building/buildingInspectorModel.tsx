import { useState } from "react";
import { Badge } from "../../../components/UI";
import { canContainLocations, isUnclassifiedPlace } from "../../../lib/locationPolicy";
import type { CanPerform } from "../../../lib/permissions";
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
  /** What the signed-in administrator may do; an action they may not do is left out, not disabled. */
  can: CanPerform;
  actions: BuildingInspectorActions;
}

/** Indoor contents are secondary: collapsed behind a count when there are entries, open when there is nothing to hide. */
function BuildingContentSection({ building, contentLocations, onAddIndoorLocation }: {
  building: SelectedBuildingView["building"];
  contentLocations: Location[];
  onAddIndoorLocation?: () => void;
}) {
  const children = contentLocations.filter((location) => location.parentId === building.id || location.building === building.name);
  const [expanded, setExpanded] = useState(children.length === 0);
  const grouped = new Map<string, Location[]>();
  children.forEach((child) => {
    const floor = child.floor || "Unspecified Floor";
    grouped.set(floor, [...(grouped.get(floor) ?? []), child]);
  });
  return (
    <section aria-label="Building content" className="inspector-related-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="inspector-section-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          <span className="inspector-section-title">Building content</span>
          <span className="inspector-section-count">{children.length} {children.length === 1 ? "place" : "places"}</span>
        </button>
        {onAddIndoorLocation && <button type="button" className="inspector-secondary-action" onClick={onAddIndoorLocation}>＋ Add indoor location</button>}
      </div>
      {expanded && (
        <section aria-label="Building room directory">
          <div className="inspector-related-heading">
            <div>
              <h4>Indoor locations by floor</h4>
              <span>{children.length} places</span>
            </div>
          </div>
          {grouped.size ? [...grouped.entries()].map(([floor, rooms]) => (
            <div key={floor} role="region" className="inspector-floor-group" aria-label={`${floor} indoor locations`}>
              <div className="inspector-floor-heading"><strong><span aria-hidden="true">⌄</span>{floor}</strong><span>{rooms.length}</span></div>
              {rooms.map((room) => <div key={room.id} className="inspector-location-row"><span className="inspector-content-icon" aria-hidden="true">{room.type === "Laboratory" ? "L" : "R"}</span><div><strong>{room.name}</strong><span>{room.type} · {room.code}</span></div></div>)}
            </div>
          )) : <p>No Indoor Locations recorded.</p>}
        </section>
      )}
    </section>
  );
}

export function buildingInspectorModel({
  view,
  contentLocations: buildingContentLocations,
  nodes: currentNodes,
  linkingEntrance: linkingBuildingEntrance,
  can,
  actions,
}: BuildingInspectorOptions): InspectorCardModel {
  const {
    building: selectedBuilding,
    location: selectedBuildingLocation,
    entrances: selectedBuildingEntrances,
    routable: selectedBuildingRoutable,
  } = view;
  const classification = selectedBuilding.classification ?? selectedBuildingLocation?.classification;
  const canContain = canContainLocations(classification);
  return {
    id: selectedBuilding.id,
    kind: "building",
    title: selectedBuilding.name,
    domain: "Locations",
    status: selectedBuildingRoutable ? "Routable" : "Not routable",
    // The fix for "Not routable" sits right under it; it needs Add, like creating any Route Node.
    statusAction: !selectedBuildingRoutable && can("add") ? { label: "＋ Add entrance", onSelect: actions.onAddEntrance } : undefined,
    summary: [
      { label: "Code", value: selectedBuilding.code },
      ...(isUnclassifiedPlace({ type: "Place", classification }) ? [{ label: "Classification", value: <Badge tone="grey">Unclassified</Badge> }] : []),
      { label: "Entrances", value: String(selectedBuildingEntrances.length) },
    ],
    details: (
      <>
        <BuildingContentSection
          key={selectedBuilding.id}
          building={selectedBuilding}
          contentLocations={buildingContentLocations}
          onAddIndoorLocation={canContain && can("add") ? actions.onAddIndoorLocation : undefined}
        />
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
          {/* Adding an entrance creates a Route Node (Add); linking an existing one changes it (Edit). */}
          {((can("add") && selectedBuildingRoutable) || can("edit")) && (
            <div className="inspector-inline-actions">
              {/* While the building is not routable, adding an entrance sits under that status at the top instead. */}
              {can("add") && selectedBuildingRoutable && <button type="button" onClick={actions.onAddEntrance}>＋ Add entrance</button>}
              {can("edit") && <button type="button" onClick={actions.onToggleLinkEntrance}>↔ Link existing entrance</button>}
            </div>
          )}
          {linkingBuildingEntrance && can("edit") && (
            <div className="inspector-related-group" aria-label="Existing Entrance Route Nodes">
              <strong>Select an existing Entrance Route Node</strong>
              {currentNodes.filter((node) => node.nodeType === "Entrance").map((node) => <button key={node.id} type="button" onClick={() => actions.onLinkEntrance(node)}>Link {node.name}</button>)}
              {!currentNodes.some((node) => node.nodeType === "Entrance") && <span>No Entrance Route Nodes available.</span>}
            </div>
          )}
        </section>
      </>
    ),
    // Reshaping and Edit Details are edits; indoor locations and entrances are additions (marking one counts as adding);
    // linking an entrance changes an existing node (Edit).
    primaryAction: can("edit") ? {
      label: "▱ Reshape Footprint",
      onSelect: actions.onReshape,
    } : undefined,
    overflowActions: [
      ...(can("edit") ? [{ label: "✎ Edit Details", onSelect: actions.onEditDetails }] : []),
      ...(canContain && can("add") ? [{ label: "＋ Add indoor location", onSelect: actions.onAddIndoorLocation }] : []),
      ...(canContain && (can("add") || can("edit")) ? [{ label: "⌂ Mark indoor location", onSelect: actions.onMarkIndoorLocation }] : []),
      ...(can("add") ? [{ label: "＋ Add entrance", onSelect: actions.onAddEntrance }] : []),
      ...(can("edit") ? [{ label: "↔ Link existing entrance", onSelect: actions.onLinkExistingEntrance }] : []),
      ...(can("delete") ? [{ label: "🗑 Delete Building", tone: "danger" as const, onSelect: actions.onDelete }] : []),
    ],
  } satisfies InspectorCardModel;
}
