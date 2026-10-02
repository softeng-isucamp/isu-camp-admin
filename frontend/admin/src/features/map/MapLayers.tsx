import type { Building, Location, RouteNode } from "../../types";
import { BuildingDraftLayer, BuildingFootprintLayer } from "./building/BuildingMapLayers";
import type { useBuildingFootprintEditing } from "./building/useBuildingFootprintEditing";
import type { MapPoint } from "./campusBoundary";
import { IndoorLocationMapLayers } from "./indoorLocation/IndoorLocationMapLayers";
import type { useIndoorLocationPlacement } from "./indoorLocation/useIndoorLocationPlacement";
import { LocationMapLayer } from "./location/LocationMapLayer";
import { PathwayDraftLayer, PathwaysLayer } from "./pathway/PathwayMapLayers";
import type { usePathwayEditing } from "./pathway/usePathwayEditing";
import { RouteNodeMarkersLayer, RouteNodePlacementMarker } from "./routeNode/RouteNodeMapLayers";
import type { useRouteNodePointTool } from "./routeNode/useRouteNodePointTool";
import type { MapSelection } from "./selection/useMapSelection";
import type { useVisibleMapObjects } from "./selection/useVisibleMapObjects";
import { PointMoveLayer } from "./PointMoveLayer";
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
    onSelectCanvasObject: (selection: MapSelection, anchor: MapPoint) => void;
    onSelectObject: (selection: MapSelection) => void;
    onSelectIndoorLocation: (location: Location) => void;
    onClickNode: (node: RouteNode) => void;
    onSelect: (selection: MapSelection | null) => void;
    onError: (message: string) => void;
  };
}

/** The editable map layers drawn inside the map container. */
export function MapLayers({ view, visible, current, editors, move, actions }: MapLayersProps) {
  const { mode, selected, isOverviewZoom, campusBoundary } = view;
  const { pathway, buildingEditor, pointTool, indoor } = editors;
  const selectedLocation = selected?.type === "location"
    ? { id: selected.id, type: selected.locationType }
    : null;
  return (
    <>
      <BuildingFootprintLayer
        buildings={visible.buildings}
        selectedBuildingId={selected?.type === "building" ? selected.id : null}
        mode={mode}
        editingBuildingId={buildingEditor.editingBuildingId}
        campusBoundary={campusBoundary}
        isOverviewZoom={isOverviewZoom}
        onSelectBuilding={(buildingId, anchor) => actions.onSelectCanvasObject({ type: "building", id: buildingId }, anchor)}
      />

      <PathwaysLayer
        pathway={pathway}
        pathways={visible.pathways}
        nodes={current.nodes}
        mode={mode}
        selectedPathId={selected?.type === "pathway" ? selected.id : null}
        campusBoundary={campusBoundary}
        isOverviewZoom={isOverviewZoom}
        onSelectPathway={(pathwayId, anchor) => actions.onSelectCanvasObject({ type: "pathway", id: pathwayId }, anchor)}
      />

      <LocationMapLayer
        locations={visible.locations}
        selectedLocation={selectedLocation}
        campusBoundary={campusBoundary}
        isOverviewZoom={isOverviewZoom}
        onSelectLocation={(location, anchor) => actions.onSelectCanvasObject({ type: "location", id: location.id, locationType: location.type }, anchor)}
      />

      <IndoorLocationMapLayers
        indoor={indoor}
        visibleLocations={current.visibleIndoorLocations}
        contentLocations={current.contentLocations}
        buildings={current.buildings}
        selectedLocation={selectedLocation}
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

      {!isOverviewZoom && mode === "move" && pointTool.moveOrigin && pointTool.position && (
        <PointMoveLayer
          origin={pointTool.moveOrigin}
          position={pointTool.position}
          snapTargets={move.snapTargets}
          campusBoundary={campusBoundary}
          outsideBoundary={move.outsideBoundary}
          distanceMeters={move.distanceMeters}
          snapped={pointTool.snapped}
          onPositionChange={pointTool.updateMovePosition}
          onDropRejected={pointTool.rejectDrop}
          onDraggingChange={pointTool.setDragging}
        />
      )}

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
