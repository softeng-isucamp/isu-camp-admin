import { useId, useState, type ReactNode } from "react";
import { Badge } from "../../../components/UI";
import { backendLocationType, canContainLocations, isUnclassifiedPlace } from "../../../lib/locationPolicy";
import type { CanPerform } from "../../../lib/permissions";
import type { Location, RouteNode } from "../../../types";
import { LocationTypeIcon } from "../../locations/LocationTypeIcon";
import type { InspectorCardModel } from "../InspectorCardHUD";
import { isUsableEntrance, unroutableReasonFor, type SelectedBuildingView, type UnroutableReason } from "./selectedBuilding";

interface BuildingInspectorActions {
  onReshape: () => void;
  onEditDetails: () => void;
  onAddIndoorLocation: () => void;
  onMarkIndoorLocation: () => void;
  onAddEntrance: () => void;
  onToggleLinkEntrance: () => void;
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

const unroutableExplanation: Record<UnroutableReason, string> = {
  no_footprint: "The building has no footprint geometry, so routes cannot reach it.",
  inactive: "The building is inactive, so routes do not reach it.",
  no_entrance: "No active entrance is linked to this building, so routes cannot reach it.",
  entrances_unusable: "The linked entrances are inactive or have no valid coordinates, so routes cannot reach this building.",
};

/** Why the Building is or is not routable, from the same checks that decide routability. */
function accessExplanation({ building, location, entrances, routable }: SelectedBuildingView): string {
  const reason = routable ? null : unroutableReasonFor(building, location, entrances) ?? "no_entrance";
  if (reason) return unroutableExplanation[reason];
  const usable = entrances.filter(isUsableEntrance).length;
  return `Routes can reach this building through ${usable} active ${usable === 1 ? "entrance" : "entrances"}.`;
}

/** The campus code when the building has one, otherwise a labelled OSM reference. */
function identifierLine({ building }: SelectedBuildingView): string | null {
  const code = building.code?.trim();
  if (code) return /^OSM\b/i.test(code) ? code : `Code ${code}`;
  const source = building.source;
  if (source && /osm|openstreetmap/i.test(source.provider)) return `OSM ${source.sourceType || "way"} ${source.sourceId}`;
  return null;
}

/** A disclosure: a real button controlling the region it reveals. */
function Disclosure({ title, count, defaultOpen, children, className }: {
  title: string;
  count?: ReactNode;
  defaultOpen: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <div className={className}>
      <button type="button" className="inspector-disclosure" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((current) => !current)}>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="inspector-disclosure-title">{title}</span>
        {count !== undefined && <span className="inspector-disclosure-count">{count}</span>}
      </button>
      <div id={bodyId} hidden={!open}>{open && children}</div>
    </div>
  );
}

/** Indoor locations: one heading with the count, collapsed when populated; the indoor actions live here. */
/** The indoor Locations inside one building: the same rule for the section and for the menu. */
const indoorLocationsIn = (building: { id: string; name: string }, locations: Location[]) =>
  locations.filter((location) => location.parentId === building.id || location.building === building.name);

function IndoorLocationsSection({ view, contentLocations, canContain, canAdd, canMark, canEdit, actions }: {
  view: SelectedBuildingView;
  contentLocations: Location[];
  canContain: boolean;
  canAdd: boolean;
  canMark: boolean;
  canEdit: boolean;
  actions: Pick<BuildingInspectorActions, "onAddIndoorLocation" | "onMarkIndoorLocation" | "onEditDetails">;
}) {
  const { building } = view;
  const children = indoorLocationsIn(building, contentLocations);
  const grouped = new Map<string, Location[]>();
  children.forEach((child) => {
    const floor = child.floor || "Unspecified Floor";
    grouped.set(floor, [...(grouped.get(floor) ?? []), child]);
  });
  const unclassified = isUnclassifiedPlace({ type: "Place", classification: building.classification ?? view.location?.classification });
  const indoorActions = canContain && (canAdd || canMark) && (
    <div className="inspector-compact-actions">
      {canAdd && <button type="button" onClick={actions.onAddIndoorLocation}>＋ Add indoor location</button>}
      {canMark && <button type="button" onClick={actions.onMarkIndoorLocation}>⌂ Mark indoor location</button>}
    </div>
  );
  return (
    <section aria-label="Indoor locations" className="inspector-section">
      <Disclosure title="Indoor locations" count={`· ${children.length}`} defaultOpen={children.length === 0}>
        {children.length > 0 ? [...grouped.entries()].map(([floor, rooms]) => (
          <FloorGroup key={floor} floor={floor} rooms={rooms} />
        )) : canContain ? (
          <p className="inspector-empty">No indoor locations have been added to this building yet.</p>
        ) : (
          <div>
            <p className="inspector-empty">
              {unclassified ? "This building has no classification." : "This building's classification cannot hold indoor locations."}
              {" "}The classification must allow indoor locations (College or Campus Services) first.
            </p>
            {canEdit && <div className="inspector-compact-actions"><button type="button" onClick={actions.onEditDetails}>✎ Edit Details</button></div>}
          </div>
        )}
      </Disclosure>
      {indoorActions}
    </section>
  );
}

function FloorGroup({ floor, rooms }: { floor: string; rooms: Location[] }) {
  return (
    <div role="region" className="inspector-floor-group" aria-label={`${floor} indoor locations`}>
      <Disclosure title={floor} count={rooms.length} defaultOpen className="inspector-floor-disclosure">
        {rooms.map((room) => (
          <div key={room.id} className="inspector-location-row">
            <span className="inspector-content-icon"><LocationTypeIcon type={room.type} classification={room.classification} size={16} /></span>
            <div><strong>{room.name}</strong><span>{backendLocationType(room) ?? room.type} · {room.code}</span></div>
          </div>
        ))}
      </Disclosure>
    </div>
  );
}

/** Entrance coordinates and source metadata, collapsed by default. */
function BuildingDetails({ view }: { view: SelectedBuildingView }) {
  const { building, entrances } = view;
  const source = building.source;
  return (
    <section aria-label="Building details" className="inspector-section">
      <Disclosure title="Details" defaultOpen={false}>
        <dl className="inspector-details-list">
          {entrances.map((node) => (
            <div key={node.id}><dt>{node.name}</dt><dd>{node.lat.toFixed(5)}, {node.lng.toFixed(5)}</dd></div>
          ))}
          {source && (
            <>
              <div><dt>Source</dt><dd>{source.provider} {source.sourceType}</dd></div>
              <div><dt>Source ID</dt><dd>{source.sourceId}</dd></div>
              {source.rawId && <div><dt>Raw ID</dt><dd>{source.rawId}</dd></div>}
              {source.url && <div><dt>URL</dt><dd>{source.url}</dd></div>}
            </>
          )}
          <div><dt>Status</dt><dd>{view.location?.status ?? building.status ?? "Active"}</dd></div>
        </dl>
        {entrances.length === 0 && !source && <p className="inspector-empty">No entrance coordinates or source metadata recorded.</p>}
      </Disclosure>
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
  const editDetailsInIndoorSection = !canContain && indoorLocationsIn(selectedBuilding, buildingContentLocations).length === 0;
  const unclassified = isUnclassifiedPlace({ type: "Place", classification });
  const identifier = identifierLine(view);
  // Adding an entrance creates a Route Node (Add); linking an existing one changes it (Edit); marking an indoor location counts as either.
  const canAddEntrance = can("add");
  const canLinkEntrance = can("edit");
  const repairIsPrimary = !selectedBuildingRoutable && canAddEntrance;
  const viewOnly = !can("add") && !can("edit") && !can("delete");
  const activeEntrances = selectedBuildingEntrances.filter(isUsableEntrance).length;
  return {
    id: selectedBuilding.id,
    kind: "building",
    title: selectedBuilding.name,
    domain: "Locations",
    objectLabel: "Building",
    subtitle: (
      <>
        {identifier && <span>{identifier}</span>}
        {identifier && " · "}
        {unclassified ? <Badge tone="grey">Unclassified</Badge> : <span>{classification}</span>}
      </>
    ),
    summary: [],
    details: (
      <>
        <section aria-label="Walking access" className="inspector-section">
          <div className="inspector-access-heading">
            <h3>Walking access</h3>
            {viewOnly && <span className="inspector-view-only">View only</span>}
          </div>
          <p className="inspector-access-status"><strong>{selectedBuildingRoutable ? "Routable" : "Not routable"}</strong></p>
          <p className="inspector-access-explanation">{accessExplanation(view)}</p>
          <p className="inspector-entrance-summary">
            {selectedBuildingEntrances.length} linked {selectedBuildingEntrances.length === 1 ? "entrance" : "entrances"}
            {selectedBuildingEntrances.length > 0 && ` · ${activeEntrances} active`}
          </p>
          {selectedBuildingEntrances.length > 0 && (
            <ul className="inspector-entrance-list" aria-label="Building entrances">
              {selectedBuildingEntrances.map((node) => (
                <li key={node.id}><span>{node.name}</span><em>{node.status === "Inactive" ? "Inactive" : "Active"}</em></li>
              ))}
            </ul>
          )}
          {(canAddEntrance || canLinkEntrance) && (
            <div className="inspector-compact-actions">
              {canAddEntrance && (
                <button type="button" className={repairIsPrimary ? "inspector-primary-action" : undefined} onClick={actions.onAddEntrance}>＋ Add entrance</button>
              )}
              {canLinkEntrance && (
                <button type="button" aria-expanded={linkingBuildingEntrance} onClick={actions.onToggleLinkEntrance}>↔ Link existing entrance</button>
              )}
            </div>
          )}
          {linkingBuildingEntrance && canLinkEntrance && (
            <div className="inspector-related-group" aria-label="Existing Entrance Route Nodes">
              <strong>Select an existing Entrance Route Node</strong>
              {currentNodes.filter((node) => node.nodeType === "Entrance").map((node) => <button key={node.id} type="button" onClick={() => actions.onLinkEntrance(node)}>Link {node.name}</button>)}
              {!currentNodes.some((node) => node.nodeType === "Entrance") && <span>No Entrance Route Nodes available.</span>}
            </div>
          )}
        </section>
        <IndoorLocationsSection
          key={selectedBuilding.id}
          view={view}
          contentLocations={buildingContentLocations}
          canContain={canContain}
          canAdd={can("add")}
          canMark={can("add") || can("edit")}
          canEdit={can("edit")}
          actions={actions}
        />
        <BuildingDetails key={`details-${selectedBuilding.id}`} view={view} />
      </>
    ),
    // Building-level actions only: entrance actions live in the access block and indoor actions in the indoor section.
    // There is no sticky footer; Reshape Footprint is an edit like Edit Details, and Delete is set apart.
    overflowActions: [
      // While the indoor section offers Edit Details to fix the classification, the menu doesn't repeat it.
      ...(can("edit") && !editDetailsInIndoorSection ? [{ label: "✎ Edit Details", onSelect: actions.onEditDetails }] : []),
      ...(can("edit") ? [{ label: "▱ Reshape Footprint", onSelect: actions.onReshape }] : []),
      ...(can("delete") ? [{ label: "🗑 Delete Building", tone: "danger" as const, separatorBefore: true, onSelect: actions.onDelete }] : []),
    ],
  } satisfies InspectorCardModel;
}
