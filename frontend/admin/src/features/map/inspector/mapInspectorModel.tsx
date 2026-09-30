import type { Building, Location, Pathway, RouteNode } from "../../../types";
import { buildingInspectorModel } from "../building/buildingInspectorModel";
import type { SelectedBuildingView } from "../building/selectedBuilding";
import type { MapPoint } from "../campusBoundary";
import type { DeleteConfirmation } from "../DeleteConfirmationModal";
import type { InspectorCardModel } from "../InspectorCardHUD";
import { locationInspectorModel } from "../location/locationInspectorModel";
import { pathPointInspectorModel, selectedPathwayInspectorModel } from "../pathway/pathwayInspectorModel";
import type { usePathwayEditing } from "../pathway/usePathwayEditing";
import { routeNodeInspectorModel } from "../routeNode/routeNodeInspectorModel";
import type { RouteNodeWorkflow } from "../routeNode/RouteNodeWorkflow";
import type { useRouteNodeFrame } from "../routeNode/useRouteNodeFrame";
import type { MapSelection } from "../selection/useMapSelection";
import type { SaveAction } from "../session/useSavingAction";

interface MapInspectorOptions {
  selected: MapSelection | null;
  /** The selected object of each domain, derived from `selected`. */
  selection: {
    building: SelectedBuildingView | null;
    location: Location | undefined;
    node: RouteNode | undefined;
    path: Pathway | undefined;
  };
  current: {
    buildings: Building[];
    locations: Location[];
    nodes: RouteNode[];
    pathways: Pathway[];
    /** Locations including the full directory, used for Building contents. */
    contentLocations: Location[];
  };
  editors: {
    pathway: ReturnType<typeof usePathwayEditing>;
    nodeFrame: ReturnType<typeof useRouteNodeFrame>;
    routeNodeWorkflow: RouteNodeWorkflow;
  };
  campusBoundary: MapPoint[];
  buildingAssociationOptions: Building[];
  savingAction: SaveAction | null;
  linkingEntrance: boolean;
  actions: {
    /** The Building actions, bound to the selected Building. */
    building: (view: SelectedBuildingView) => Parameters<typeof buildingInspectorModel>[0]["actions"];
    onEditLocationDetails: () => void;
    onError: (message: string) => void;
    onNodeUpdated: (node: RouteNode) => void;
    onMoveNode: () => void;
    onSelect: (selection: MapSelection | null) => void;
    onDelete: (confirmation: DeleteConfirmation) => void;
    onApplyPathway: () => void;
    onCancelPathway: () => void;
    onReshapePathway: (path: Pathway) => void;
    onStartPathPointConversion: () => void;
  };
}

/** The Inspector Card for whatever is selected, built by the owning domain. */
export function mapInspectorModel({
  selected,
  selection,
  current,
  editors,
  campusBoundary,
  buildingAssociationOptions,
  savingAction,
  linkingEntrance,
  actions,
}: MapInspectorOptions): InspectorCardModel | null {
  if (!selected) return null;
  const { pathway, nodeFrame, routeNodeWorkflow } = editors;
  if (selection.building) {
    return buildingInspectorModel({
      view: selection.building,
      contentLocations: current.contentLocations,
      nodes: current.nodes,
      linkingEntrance,
      actions: actions.building(selection.building),
    });
  }
  if (selection.location) {
    return locationInspectorModel({
      location: selection.location,
      buildings: current.buildings,
      locations: current.locations,
      onEditDetails: actions.onEditLocationDetails,
    });
  }
  if (selection.node) {
    return routeNodeInspectorModel({
      node: selection.node,
      frame: nodeFrame,
      workflow: routeNodeWorkflow,
      nodes: current.nodes,
      pathways: current.pathways,
      buildings: current.buildings,
      locations: current.locations,
      campusBoundary,
      buildingAssociationOptions,
      savingAction,
      onError: actions.onError,
      onNodeUpdated: actions.onNodeUpdated,
      onMove: actions.onMoveNode,
      onDelete: actions.onDelete,
    });
  }
  if (selection.path) {
    return selectedPathwayInspectorModel({
      pathway,
      path: selection.path,
      nodes: current.nodes,
      buildings: current.buildings,
      savingAction,
      onSelect: actions.onSelect,
      onApply: actions.onApplyPathway,
      onCancel: actions.onCancelPathway,
      onReshape: actions.onReshapePathway,
      onDelete: actions.onDelete,
    });
  }
  if (selected.type === "path_point") {
    const pathPointModel = pathPointInspectorModel({
      pathway,
      id: selected.id,
      nodes: current.nodes,
      savingAction,
      onSelect: actions.onSelect,
      onApply: actions.onApplyPathway,
      onCancel: actions.onCancelPathway,
      onStartConversion: actions.onStartPathPointConversion,
    });
    if (pathPointModel) return pathPointModel;
  }
  return null;
}
