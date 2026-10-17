import { backendLocationType } from "../../../lib/locationPolicy";
import { useMemo, useRef, useState } from "react";
import type { Building, Location, Pathway, RouteNode } from "../../../types";
import { geometryOnCampus, pointOnCampus, type MapPoint } from "../campusBoundary";
import { isPositionedLocation } from "../indoorLocation/indoorLocations";
import { polygonFeatureAnchor } from "../mapEditing";
import type { PathwayCrossing } from "../pathway/pathwayTopology";
import { selectedBuildingViewFor } from "../building/selectedBuilding";
import { locationSelection, type MapSelection } from "../selection/useMapSelection";
import type { EditorMode } from "../types";

export type MapIssueKind = "pathway-crossing" | "no-entrance" | "outside-boundary";

/** The tray's groups, in display order: alerts first, then informational notes. */
export const MAP_ISSUE_GROUPS: readonly {
  kind: MapIssueKind;
  severity: "alert" | "info";
  label: string;
  /** One short line shown once under the group header instead of on every row. */
  note: string;
}[] = [
  { kind: "pathway-crossing", severity: "alert", label: "Crossing without junction", note: "Routes cannot turn here until a Junction is created." },
  { kind: "no-entrance", severity: "alert", label: "No entrance", note: "Routes cannot reach these buildings." },
  { kind: "outside-boundary", severity: "info", label: "Outside campus boundary", note: "Legacy data is kept; move it inside the boundary before saving changes." },
];

export interface MapIssueAction {
  /** Accessible name of the fix button. */
  label: string;
  /** Compact visible text for the one-line row; defaults to `label`. */
  shortLabel?: string;
  onClick: () => void;
}

/**
 * One affected map object (or crossing point). Focusing it never changes data. Only a crossing
 * has an action, because it has no inspector; an object's fixes live in its inspector.
 */
export interface MapIssue {
  id: string;
  kind: MapIssueKind;
  /** The affected object, e.g. "CAS Building" or "Main Road × Gym Walkway". */
  title: string;
  /** A few words adding a fact the group header does not, e.g. "0 entrance nodes". */
  detail: string;
  /** Where the map flies to. */
  point: MapPoint;
  /** The object to select on focus; a crossing has none. */
  selection: MapSelection | null;
  action?: MapIssueAction;
}

export interface MapIssueSources {
  buildings: Building[];
  locations: Location[];
  nodes: RouteNode[];
  pathways: Pathway[];
  pathwayCrossings: PathwayCrossing[];
}

const groupOrder = (kind: MapIssueKind) => MAP_ISSUE_GROUPS.findIndex((group) => group.kind === kind);

/**
 * Every pathway crossing, every Building without an active Entrance, and every
 * object outside the campus boundary, from the current (session-overlaid) data.
 * Alerts come first, then by group, keeping data order within a group.
 */
export function deriveMapIssues(
  { buildings, locations, nodes, pathways, pathwayCrossings }: MapIssueSources,
  campusBoundary: MapPoint[],
  fixCrossing: (crossing: PathwayCrossing) => void,
): MapIssue[] {
  const issues: MapIssue[] = [];
  const pathwayName = (id: string) => {
    const found = pathways.find((item) => item.id === id);
    return found?.name || found?.id || id;
  };

  pathwayCrossings.forEach((crossing) => {
    const { latitude, longitude } = crossing.point;
    const title = `${pathwayName(crossing.pathwayAId)} × ${pathwayName(crossing.pathwayBId)}`;
    issues.push({
      id: `crossing:${crossing.pathwayAId}:${crossing.pathwayBId}:${latitude.toFixed(7)},${longitude.toFixed(7)}`,
      kind: "pathway-crossing",
      title,
      detail: "Not routable",
      point: [latitude, longitude],
      selection: null,
      action: {
        label: `Create Junction & Split Pathway: ${title}`,
        shortLabel: "Create Junction",
        onClick: () => fixCrossing(crossing),
      },
    });
  });

  buildings
    .filter((building) => building.status !== "Inactive" && building.points.length >= 3)
    .filter((building) => !(selectedBuildingViewFor(building, locations, nodes)?.entrances ?? [])
      .some((node) => node.status !== "Inactive"))
    .forEach((building) => {
      issues.push({
        id: `no-entrance:${building.id}`,
        kind: "no-entrance",
        title: building.name,
        detail: "0 entrance nodes",
        point: polygonFeatureAnchor(building.points),
        selection: { type: "building", id: building.id },
      });
    });

  const addOutside = (id: string, title: string, detail: string, point: MapPoint, selection: MapSelection) => {
    issues.push({ id: `outside-boundary:${id}`, kind: "outside-boundary", title, detail, point, selection });
  };
  locations
    .filter((item) => isPositionedLocation(item) && !pointOnCampus([item.lat, item.lng], campusBoundary))
    .forEach((item) => addOutside(`location:${item.type}:${item.id}`, item.name, backendLocationType(item),
      [item.lat as number, item.lng as number], locationSelection(item)));
  nodes
    .filter((item) => !pointOnCampus([item.lat, item.lng], campusBoundary))
    .forEach((item) => addOutside(`node:${item.id}`, item.name, "Route Node",
      [item.lat, item.lng], { type: "node", id: item.id }));
  pathways.forEach((item) => {
    const source = nodes.find((node) => node.id === item.sourceNodeId);
    const destination = nodes.find((node) => node.id === item.destinationNodeId);
    const coordinates: MapPoint[] = [
      ...(source ? [[source.lat, source.lng] as MapPoint] : []),
      ...item.pathPoints,
      ...(destination ? [[destination.lat, destination.lng] as MapPoint] : []),
    ];
    if (geometryOnCampus(coordinates, campusBoundary)) return;
    const point = coordinates.find((coordinate) => !pointOnCampus(coordinate, campusBoundary)) ?? coordinates[0];
    if (point) addOutside(`pathway:${item.id}`, item.name || item.id, "Pathway", point, { type: "pathway", id: item.id });
  });
  buildings
    .filter((item) => item.points.length > 0 && !geometryOnCampus(item.points, campusBoundary))
    .forEach((item) => addOutside(`building:${item.id}`, item.name, "Building",
      polygonFeatureAnchor(item.points), { type: "building", id: item.id }));

  return issues.sort((a, b) => groupOrder(a.kind) - groupOrder(b.kind));
}

export interface MapIssueFocus {
  mode: EditorMode;
  /** An in-progress tool draft: focusing only flies, so the draft is never disturbed. */
  hasActiveDraft: boolean;
  setMode: (mode: EditorMode) => void;
  selectObject: (selection: MapSelection) => void;
  flyTo: (point: MapPoint, zoom?: number) => void;
  /** Reveals the inspector before selecting, e.g. by closing the Walking Network browser. */
  showInspector: () => void;
}

/** The derived issues plus focusing one: fly to it and, when it has an object, select it. */
export function useMapIssues(
  sources: MapIssueSources,
  campusBoundary: MapPoint[],
  fixCrossing: (crossing: PathwayCrossing) => void,
  focus: MapIssueFocus,
) {
  const { buildings, locations, nodes, pathways, pathwayCrossings } = sources;
  // The editor recreates its handler every render; the ref keeps the derived issues memoized.
  const latestFixCrossing = useRef(fixCrossing);
  latestFixCrossing.current = fixCrossing;
  const issues = useMemo(
    () => deriveMapIssues(
      { buildings, locations, nodes, pathways, pathwayCrossings },
      campusBoundary,
      (crossing) => latestFixCrossing.current(crossing),
    ),
    [buildings, locations, nodes, pathways, pathwayCrossings, campusBoundary],
  );
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);

  const focusIssue = (issue: MapIssue) => {
    if (issue.selection && !focus.hasActiveDraft) {
      focus.showInspector();
      if (focus.mode !== "select") focus.setMode("select");
      focus.selectObject(issue.selection);
    }
    // A fresh array each time so focusing the same issue again still flies.
    focus.flyTo([issue.point[0], issue.point[1]], 20);
    setActiveIssueId(issue.id);
  };

  return { issues, activeIssueId, focusIssue };
}
