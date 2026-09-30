import type { Building, Location, RouteNode } from "../../types";
import { BuildingDraftLayer, BuildingFootprintLayer } from "./building/BuildingMapLayers";
import type { useBuildingFootprintEditing } from "./building/useBuildingFootprintEditing";
import type { MapPoint } from "./campusBoundary";
import { IndoorLocationMapLayers } from "./indoorLocation/IndoorLocationMapLayers";
import type { useIndoorLocationPlacement } from "./indoorLocation/useIndoorLocationPlacement";
import { LocationMapLayer } from "./location/LocationMapLayer";
import { PathwayDraftLayer, PathwaysLayer } from "./pathway/PathwayMapLayers";
import type { usePathwayEditing } from "./pathway/usePathwayEditing";
import { RouteNodeMarkersLayer, RouteNodeMoveLayer, RouteNodePlacementMarker } from "./routeNode/RouteNodeMapLayers";
import type { useRouteNodePointTool } from "./routeNode/useRouteNodePointTool";
import type { CanvasSelectionType } from "./selectionCandidates";
import type { MapSelection, MapSelectionType } from "./selection/useMapSelection";
import type { useVisibleMapObjects } from "./selection/useVisibleMapObjects";
import type { PointSnapTarget } from "./pointInteractions";
import type { EditorMode } from "./types";

interface MapLayersProps {
  view: {
    mode: EditorMode;
    selected: MapSelection | null;
    isOverviewZoom: boolean;
    campusBoundary: MapPoint[];
  };
  visible: ReturnType<typeof useVisibleMapObjects>;
  current: {
    buildings: Building[];
    nodes: RouteNode[];
    contentLocations: Location[];
    visibleIndoorLocations: Location[];
  };
  editors: {
    pathway: ReturnType<typeof usePathwayEditing>;
    buildingEditor: ReturnType<typeof useBuildingFootprintEditing>;
    pointTool: ReturnType<typeof useRouteNodePointTool>;
    indoor: ReturnType<typeof useIndoorLocationPlacement>;
  };
  /** How the moved Route Node sits relative to the campus and its origin. */
  move: {
    snapTargets: PointSnapTarget[];
    outsideBoundary: boolean;
    distanceMeters: number;
  };
  actions: {
    onSelectCanvasObject: (type: CanvasSelectionType, id: string, anchor: MapPoint) => void;
    onSelectObject: (type: MapSelectionType, id: string) => void;
    onSelectIndoorLocation: (locationId: string) => void;
    onClickNode: (node: RouteNode) => void;
    onSelect: (selection: MapSelection | null) => void;
    onError: (message: string) => void;
  };
}

/** The editable map layers drawn inside the map container. */
export function MapLayers({ view, visible, current, editors, move, actions }: MapLayersProps) {
  const { mode, selected, isOverviewZoom, campusBoundary } = view;
  const { pathway, buildingEditor, pointTool, indoor } = editors;
  return (
    <>
      <BuildingFootprintLayer
        buildings={visible.buildings}
        selectedBuildingId={selected?.type === "building" ? selected.id : null}
        mode={mode}
        editingBuildingId={buildingEditor.editingBuildingId}
        campusBoundary={campusBoundary}
        isOverviewZoom={isOverviewZoom}
        onSelectBuilding={(buildingId, anchor) => actions.onSelectCanvasObject("building", buildingId, anchor)}
      />

      <PathwaysLayer
        pathway={pathway}
        pathways={visible.pathways}
        nodes={current.nodes}
        mode={mode}
        selectedPathId={selected?.type === "pathway" ? selected.id : null}
        campusBoundary={campusBoundary}
        isOverviewZoom={isOverviewZoom}
        onSelectPathway={(pathwayId, anchor) => actions.onSelectCanvasObject("pathway", pathwayId, anchor)}
      />

      <LocationMapLayer
        locations={visible.locations}
        selectedLocationId={selected?.type === "location" ? selected.id : null}
        campusBoundary={campusBoundary}
        isOverviewZoom={isOverviewZoom}
        onSelectLocation={(locationId, anchor) => actions.onSelectCanvasObject("location", locationId, anchor)}
      />

      <IndoorLocationMapLayers
        indoor={indoor}
        visibleLocations={current.visibleIndoorLocations}
        contentLocations={current.contentLocations}
        buildings={current.buildings}
        selectedLocationId={selected?.type === "location" ? selected.id : null}
        onSelectLocation={actions.onSelectIndoorLocation}
      />

      <RouteNodeMarkersLayer
        nodes={visible.nodes}
        mode={mode}
        movingId={pointTool.movingId}
        selectedNodeId={selected?.type === "node" ? selected.id : null}
        campusBoundary={campusBoundary}
        isOverviewZoom={isOverviewZoom}
        onClickNode={actions.onClickNode}
      />

      <PathwayDraftLayer
        pathway={pathway}
        nodes={current.nodes}
        mode={mode}
        campusBoundary={campusBoundary}
        isOverviewZoom={isOverviewZoom}
        onSelect={actions.onSelect}
        onError={actions.onError}
      />

      <BuildingDraftLayer
        editor={buildingEditor}
        mode={mode}
        campusBoundary={campusBoundary}
        isOverviewZoom={isOverviewZoom}
        onError={actions.onError}
      />

      <RouteNodeMoveLayer
        pointTool={pointTool}
        mode={mode}
        snapTargets={move.snapTargets}
        campusBoundary={campusBoundary}
        outsideBoundary={move.outsideBoundary}
        distanceMeters={move.distanceMeters}
        isOverviewZoom={isOverviewZoom}
      />

      <RouteNodePlacementMarker
        pointTool={pointTool}
        mode={mode}
        campusBoundary={campusBoundary}
        isOverviewZoom={isOverviewZoom}
        onError={actions.onError}
      />
    </>
  );
}
