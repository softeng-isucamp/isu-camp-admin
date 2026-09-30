import { campusCenter } from "../../services/mockData";
import type { Building, Location, Pathway, RouteNode } from "../../types";
import { BuildingToolPanel } from "./building/BuildingToolPanel";
import { SelectedBuildingPanel } from "./building/SelectedBuildingPanel";
import type { SelectedBuildingView } from "./building/selectedBuilding";
import type { useBuildingFootprintEditing } from "./building/useBuildingFootprintEditing";
import { SelectedLocationPanel } from "./location/SelectedLocationPanel";
import { PathwayToolPanel } from "./pathway/PathwayToolPanel";
import { SelectedPathwayPanel } from "./pathway/SelectedPathwayPanel";
import type { usePathwayEditing } from "./pathway/usePathwayEditing";
import { RouteNodePlacePanel } from "./routeNode/RouteNodePlacePanel";
import { SelectedRouteNodePanel } from "./routeNode/SelectedRouteNodePanel";
import type { useRouteNodeFrame } from "./routeNode/useRouteNodeFrame";
import type { useRouteNodePointTool } from "./routeNode/useRouteNodePointTool";
import type { SaveAction } from "./session/useSavingAction";
import type { EditorMode } from "./types";

interface ToolPanelProps {
  mode: EditorMode;
  error: string;
  savingAction: SaveAction | null;
  /** The selected object of each domain, shown when no tool is drawing. */
  selection: {
    building: SelectedBuildingView | null;
    location: Location | undefined;
    node: RouteNode | undefined;
    path: Pathway | undefined;
  };
  editors: {
    buildingEditor: ReturnType<typeof useBuildingFootprintEditing>;
    pointTool: ReturnType<typeof useRouteNodePointTool>;
    pathway: ReturnType<typeof usePathwayEditing>;
    nodeFrame: ReturnType<typeof useRouteNodeFrame>;
  };
  data: {
    nodes: RouteNode[];
    locations: Location[];
    contentLocations: Location[];
    buildingAssociationOptions: Building[];
    directoryPathways: Pathway[];
    overlayPathways: Pathway[];
  };
  actions: {
    onSaveBuilding: () => void;
    onOpenBuildingDetails: (buildingId: string) => void;
    onSavePlacedNode: () => void;
    onCancelTool: () => void;
    onNewPathway: () => void;
    onBrowseNetwork: () => void;
    onSavePathShape: () => void;
    onUpdateBuilding: (building: Building) => void;
    onEditBuildingFootprint: () => void;
    onPlaceEntrance: (view: SelectedBuildingView) => void;
    onUpdateLocation: (location: Location) => void;
    onMoveNode: () => void;
    onReshapePathway: (path: Pathway) => void;
    onClearSelection: () => void;
  };
}

/** The floating side panel: the active tool's panel, or the selected object's panel in select mode. */
export function ToolPanel({ mode, error, savingAction, selection, editors, data, actions }: ToolPanelProps) {
  const { buildingEditor, pointTool, pathway, nodeFrame } = editors;
  return (
    <aside className="map-glass-panel absolute right-4 top-20 z-[901] w-80 max-h-[calc(100%-100px)] overflow-y-auto rounded-[28px] p-5">
      {error && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl" role="alert">
          {error}
        </div>
      )}

      {mode === "area" ? (
        <BuildingToolPanel
          editor={buildingEditor}
          savingAction={savingAction}
          onSave={actions.onSaveBuilding}
          onOpenDetails={actions.onOpenBuildingDetails}
        />
      ) : mode === "place" ? (
        <RouteNodePlacePanel
          pointTool={pointTool}
          buildingAssociationOptions={data.buildingAssociationOptions}
          campusCenter={campusCenter}
          savingAction={savingAction}
          onSave={actions.onSavePlacedNode}
          onCancel={actions.onCancelTool}
        />
      ) : mode === "path" ? (
        <PathwayToolPanel
          pathway={pathway}
          nodes={data.nodes}
          directoryPathways={data.directoryPathways}
          overlayPathways={data.overlayPathways}
          savingAction={savingAction}
          onNewPathway={actions.onNewPathway}
          onBrowseNetwork={actions.onBrowseNetwork}
          onSave={actions.onSavePathShape}
          onCancel={actions.onCancelTool}
        />
      ) : selection.building ? (
        <SelectedBuildingPanel
          view={selection.building}
          contentLocations={data.contentLocations}
          onUpdateBuilding={actions.onUpdateBuilding}
          onEditFootprint={actions.onEditBuildingFootprint}
          onPlaceEntrance={() => actions.onPlaceEntrance(selection.building!)}
          onClearSelection={actions.onClearSelection}
        />
      ) : selection.location ? (
        <SelectedLocationPanel
          location={selection.location}
          onUpdate={actions.onUpdateLocation}
          onClearSelection={actions.onClearSelection}
        />
      ) : selection.node ? (
        <SelectedRouteNodePanel
          node={selection.node}
          frame={nodeFrame}
          locations={data.locations}
          pathways={data.directoryPathways}
          buildingAssociationOptions={data.buildingAssociationOptions}
          onMove={actions.onMoveNode}
          onClearSelection={actions.onClearSelection}
        />
      ) : selection.path ? (
        <SelectedPathwayPanel
          pathway={pathway}
          path={selection.path}
          nodes={data.nodes}
          onUpdate={pathway.update}
          onReshape={actions.onReshapePathway}
          onClearSelection={actions.onClearSelection}
        />
      ) : null}
    </aside>
  );
}
