import { campusCenter } from "../../services/mockData";
import type { Building, Pathway, RouteNode } from "../../types";
import { BuildingToolPanel } from "./building/BuildingToolPanel";
import type { useBuildingFootprintEditing } from "./building/useBuildingFootprintEditing";
import { PathwayToolPanel } from "./pathway/PathwayToolPanel";
import type { usePathwayEditing } from "./pathway/usePathwayEditing";
import { RouteNodePlacePanel } from "./routeNode/RouteNodePlacePanel";
import type { useRouteNodePointTool } from "./routeNode/useRouteNodePointTool";
import type { SaveAction } from "./session/useSavingAction";
import type { EditorMode } from "./types";

interface ToolPanelProps {
  mode: EditorMode;
  error: string;
  savingAction: SaveAction | null;
  editors: {
    buildingEditor: ReturnType<typeof useBuildingFootprintEditing>;
    pointTool: ReturnType<typeof useRouteNodePointTool>;
    pathway: ReturnType<typeof usePathwayEditing>;
  };
  data: {
    nodes: RouteNode[];
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
  };
}

/** The floating side panel for the active drawing tool. */
export function ToolPanel({ mode, error, savingAction, editors, data, actions }: ToolPanelProps) {
  const { buildingEditor, pointTool, pathway } = editors;
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
      ) : null}
    </aside>
  );
}
