import { Fragment } from "react";
import { Marker, Polygon, Tooltip } from "react-leaflet";
import type { Building } from "../../../types";
import type { FeatureLinkEntity, LocalMapFeatureEntity } from "../../../services/mapLayers";
import { geometryOnCampus, pointOnCampus, type MapPoint } from "../campusBoundary";
import type { EditorMode } from "../types";
import type L from "leaflet";
import { createLocationPinIcon, createSplitIcon, createVertexIcon } from "../mapIcons";
import { polygonFeatureAnchor } from "../mapEditing";
import type { useBuildingFootprintEditing } from "./useBuildingFootprintEditing";

interface BuildingFootprintLayerProps {
  buildings: Building[];
  selectedBuildingId: string | null;
  mode: EditorMode;
  editingBuildingId: string | null;
  featureLinks: FeatureLinkEntity[];
  localFeatures: LocalMapFeatureEntity[];
  campusBoundary: MapPoint[];
  isOverviewZoom: boolean;
  onSelectBuilding: (buildingId: string, anchor: MapPoint) => void;
  onSelectLocalFeature: (featureId: string) => void;
}

/** The committed Building footprints (with their pins), one Polygon per Building. */
export function BuildingFootprintLayer({
  buildings: filteredBuildings,
  selectedBuildingId,
  mode,
  editingBuildingId,
  featureLinks: currentFeatureLinks,
  localFeatures: currentLocalFeatures,
  campusBoundary,
  isOverviewZoom,
  onSelectBuilding,
  onSelectLocalFeature,
}: BuildingFootprintLayerProps) {
  return (
    <>
      {filteredBuildings.map((building) => {
        const isSelected = selectedBuildingId === building.id;
        const footprintLink = currentFeatureLinks.find((link) =>
          link.targetDomain === "Locations"
          && link.targetEntityId === building.id
          && link.linkType === "building_footprint",
        );
        const footprint = currentLocalFeatures.find((feature) =>
          feature.id === footprintLink?.featureId
          || (feature.family === "building_footprint"
            && (feature.linkedBuildingId === building.id || feature.id === `feat-poly-${building.id}`)),
        );
        const footprintRetired = footprint?.status === "retired";
        const buildingFillOpacity =
          footprintRetired ? 0.1 : mode === "path" ? 0.08 : isSelected ? 0.35 : 0.22;

        return (
          <Fragment key={`building:${building.id}`}>
          <Polygon
            key={`building-polygon:${building.id}`}
            positions={building.points}
            pathOptions={{
              color: footprintRetired
                ? "#7c8780"
                : !geometryOnCampus(building.points, campusBoundary)
                ? "#b42318"
                : isSelected
                  ? "#e67e22"
                  : "#278b70",
              fillColor: footprintRetired ? "#cbd2ce" : isSelected ? "#f97316" : "#8fd1bd",
              fillOpacity: buildingFillOpacity,
              weight: isSelected ? 3 : 2,
              opacity: footprintRetired ? 0.48 : 1,
              dashArray: footprintRetired ? "7 6" : undefined,
            }}
            eventHandlers={{
              click: (event) => {
                if (footprintRetired && footprint) onSelectLocalFeature(footprint.id);
                else onSelectBuilding(building.id, event.latlng
                  ? [event.latlng.lat, event.latlng.lng]
              : polygonFeatureAnchor(building.points));
              },
            }}
          >
            {!isOverviewZoom && <Tooltip sticky direction="top" className="map-label">
              <div className="font-bold text-xs">{building.name}</div>
              {building.code && <div className="text-[10px] text-gray-500 font-normal">{building.code}</div>}
              {!geometryOnCampus(building.points, campusBoundary) && (
                <div className="text-[10px] text-red-600 font-semibold mt-0.5">Outside campus boundary</div>
              )}
              {footprintRetired && <div className="text-[10px] font-semibold text-amber-700">Retired · restore available</div>}
            </Tooltip>}
          </Polygon>
          {mode === "select" && editingBuildingId === null && (!isOverviewZoom || isSelected) && (
            <Marker
              position={polygonFeatureAnchor(building.points)}
              icon={createLocationPinIcon(isSelected)}
              eventHandlers={{ click: () => onSelectBuilding(building.id, polygonFeatureAnchor(building.points)) }}
            />
          )}
          </Fragment>
        );
      })}
    </>
  );
}

interface BuildingDraftLayerProps {
  editor: ReturnType<typeof useBuildingFootprintEditing>;
  mode: EditorMode;
  campusBoundary: MapPoint[];
  isOverviewZoom: boolean;
  onError: (message: string) => void;
}

/** The polygon tool's in-progress footprint: outline, anchor pin, vertex handles, and reshape/move handles. */
export function BuildingDraftLayer({ editor, mode, campusBoundary, isOverviewZoom, onError: setError }: BuildingDraftLayerProps) {
  const { points, polygonInvalid, polygonInteraction, updatePolygonVertex, insertPolygonVertex, movePolygon } = editor;
  return (
    <>
      {points.length > 1 && (
        <Polygon
          positions={points}
          pathOptions={{
            color: polygonInvalid ? "#b42318" : "#005931",
            fillColor: "#8fd1bd",
            fillOpacity: 0.25,
            weight: 2,
          }}
        />
      )}

      {/* Center marker for the polygon currently being drawn/reshaped, so it's visible
          before the building is committed (fixes #32 — previously only rendered post-commit
          when mode === "select", so nothing showed while mode === "area"). Recomputed from
          `points` on every render, same as the committed-building marker below. */}
      {!isOverviewZoom && mode === "area" && points.length >= 3 && (
        <Marker
          position={polygonFeatureAnchor(points)}
          icon={createLocationPinIcon(false)}
        />
      )}

      {!isOverviewZoom && mode === "area" &&
        points.map((pt, i) => (
          <Marker
            key={`area-pt-${i}`}
            position={pt}
            icon={createVertexIcon(i)}
            draggable={polygonInteraction === "reshape"}
            eventHandlers={{
              drag: (event) => {
                const next = (event.target as L.Marker).getLatLng();
                updatePolygonVertex(i, [next.lat, next.lng]);
              },
              dragend: (event) => {
                const next = (event.target as L.Marker).getLatLng();
                if (pointOnCampus([next.lat, next.lng], campusBoundary)) {
                  updatePolygonVertex(i, [next.lat, next.lng]);
                  setError("");
                } else {
                  setError("The building footprint must stay inside the ISU Echague campus boundary.");
                }
              },
            }}
          />
        ))}

      {!isOverviewZoom && mode === "area" && polygonInteraction === "reshape" && points.length >= 3 && points.map((point, index) => {
        const next = points[(index + 1) % points.length];
        return (
          <Marker
            key={`split-${index}`}
            position={[(point[0] + next[0]) / 2, (point[1] + next[1]) / 2]}
            icon={createSplitIcon()}
            eventHandlers={{ click: () => insertPolygonVertex(index) }}
          />
        );
      })}

      {!isOverviewZoom && mode === "area" && polygonInteraction === "move" && points.length >= 3 && (
        <Marker
          position={polygonFeatureAnchor(points)}
          icon={createLocationPinIcon(true)}
          draggable
          eventHandlers={{
            drag: (event) => {
              const next = (event.target as L.Marker).getLatLng();
              movePolygon([next.lat, next.lng]);
            },
            dragend: (event) => {
              const next = (event.target as L.Marker).getLatLng();
              movePolygon([next.lat, next.lng]);
            },
          }}
        />
      )}
    </>
  );
}
