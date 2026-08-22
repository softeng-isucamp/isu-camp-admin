import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { services, setMockFailure } from "../../services/api";
import { campusCenter } from "../../services/mockData";
import { Button, Modal } from "../../components/UI";
import type { Building, Location, Pathway, RouteNode } from "../../types";
import { reviewMapDraft, type MapObjectReference } from "./mapEditing";
import "leaflet/dist/leaflet.css";

const createLocationPinIcon = (selected = false) =>
  L.divIcon({
    className: `location-marker-icon ${selected ? "selected" : ""}`,
    html: `<div class="location-icon ${selected ? "selected" : ""}"><span class="location-pin"></span></div>`,
    iconSize: [26, 32],
    iconAnchor: [13, 30],
  });

const createNodeIcon = (selected = false) =>
  L.divIcon({
    className: `route-node-icon ${selected ? "selected" : ""}`,
    html: `<div class="route-icon ${selected ? "selected" : ""}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

const createPointIcon = (selected = false) =>
  L.divIcon({
    className: `path-point-icon ${selected ? "selected" : ""}`,
    html: `<div class="point-icon ${selected ? "selected" : ""}"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });

const createTempIcon = () =>
  L.divIcon({
    className: "temp-marker-icon",
    html: `<div class="temp-icon"></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

interface MapControllerProps {
  onMapClick: (latlng: [number, number]) => void;
  flyTarget: [number, number] | null;
}

const overlayChanges = <T extends { id: string }>(original: T[], changed: T[]) => {
  const changes = new Map(changed.map((item) => [item.id, item]));
  return original.map((item) => changes.get(item.id) ?? item).concat(changed.filter((item) => !original.some((candidate) => candidate.id === item.id)));
};

function MapController({ onMapClick, flyTarget }: MapControllerProps) {
  const map = useMap();

  useMapEvents({
    click: (e) => {
      onMapClick([e.latlng.lat, e.latlng.lng]);
    },
  });

  useEffect(() => {
    if (flyTarget) {
      map.flyTo(flyTarget, 19, { duration: 0.8 });
    }
  }, [flyTarget, map]);

  return null;
}

export function MapEditor() {
  const queryClient = useQueryClient();
  const routeLocation = useLocation();

  useEffect(() => {
    const failure = new URLSearchParams(window.location.search).get(
      "mockFailure",
    );
    if (failure === "mapSave") {
      setMockFailure("mapSave", true);
      return () => setMockFailure("mapSave", false);
    }
    return undefined;
  }, []);

  const { data } = useQuery({
    queryKey: ["map"],
    queryFn: async () => ({
      buildings: await services.map.buildings(),
      locations: await services.map.locations(),
      nodes: await services.map.nodes(),
      pathways: await services.map.pathways(),
    }),
  });

  const [localLocations, setLocalLocations] = useState<Location[]>([]);
  const [localNodes, setLocalNodes] = useState<RouteNode[]>([]);
  const [localPathways, setLocalPathways] = useState<Pathway[]>([]);
  const [localBuildings, setLocalBuildings] = useState<Building[]>([]);

  const [mode, setMode] = useState<"select" | "place" | "path" | "area" | "move">(
    "select",
  );
  const [selected, setSelected] = useState<{
    type: "location" | "node" | "pathway" | "building" | "area";
    id: string;
  } | null>(null);

  const [search, setSearch] = useState("");
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [temporary, setTemporary] = useState<[number, number] | null>(null);
  const [pathPoints, setPathPoints] = useState<[number, number][]>([]);
  const [selectedPathPointIndex, setSelectedPathPointIndex] = useState<number | null>(null);
  const [manualPathPointDrag, setManualPathPointDrag] = useState(false);
  const [points, setPoints] = useState<[number, number][]>([]);
  const [buildingName, setBuildingName] = useState("");
  const [buildingCode, setBuildingCode] = useState("");
  const [movingType, setMovingType] = useState<"location" | "node">("location");
  const [movingId, setMovingId] = useState<string | null>(null);
  const [placingObjectType, setPlacingObjectType] = useState<"location" | "node">(
    "location",
  );
  const [placingId, setPlacingId] = useState<string>("");
  const [placingNodeType, setPlacingNodeType] = useState<
    "Entrance" | "Junction" | "Access Point"
  >("Entrance");
  const [placingNodeName, setPlacingNodeName] = useState("");
  const [placingAssociatedPlaceId, setPlacingAssociatedPlaceId] = useState<
    string | null
  >(null);

  const [editingPathId, setEditingPathId] = useState<string | null>(null);
  const distinctBuildingPointCount = new Set(points.map((point) => point.join(","))).size;
  const canSaveBuilding = points.length >= 3 && distinctBuildingPointCount >= 3 && Boolean(buildingName.trim()) && Boolean(buildingCode.trim());
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState<"save" | "discard" | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState("");
  const [basemap, setBasemap] = useState<"street" | "satellite">("street");

  const directoryLocations = data?.locations || [];
  const directoryNodes = data?.nodes || [];
  const directoryPathways = data?.pathways || [];
  const directoryBuildings = (data?.buildings || []).filter((building) => building.points.length >= 3);
  const currentLocations = useMemo(() => overlayChanges(directoryLocations, localLocations), [directoryLocations, localLocations]);
  const currentNodes = useMemo(() => overlayChanges(directoryNodes, localNodes), [directoryNodes, localNodes]);
  const currentPathways = useMemo(() => {
    const merged = overlayChanges(directoryPathways, localPathways);
    return mode === "path" && editingPathId ? merged.map((item) => item.id === editingPathId ? { ...item, pathPoints } : item) : merged;
  }, [directoryPathways, editingPathId, localPathways, mode, pathPoints]);
  const currentBuildings = useMemo(() => {
    const merged = overlayChanges(directoryBuildings, localBuildings);
    return mode === "area" && points.length > 0 ? [...merged, { id: "pending-building", name: buildingName, code: buildingCode, points }] : merged;
  }, [buildingCode, buildingName, directoryBuildings, localBuildings, mode, points]);
  const draftReview = useMemo(() => reviewMapDraft({
    original: { locations: directoryLocations, nodes: directoryNodes, pathways: directoryPathways, buildings: directoryBuildings },
    current: { locations: currentLocations, nodes: currentNodes, pathways: currentPathways, buildings: currentBuildings },
    deleted: [],
  }), [currentBuildings, currentLocations, currentNodes, currentPathways, directoryBuildings, directoryLocations, directoryNodes, directoryPathways]);

  const selectedLocation =
    currentLocations.find((item) => item.id === selected?.id);
  const selectedNode =
    currentNodes.find((item) => item.id === selected?.id);
  const selectedPath =
    currentPathways.find((item) => item.id === selected?.id);
  const selectedBuilding =
    currentBuildings.find((item) => item.id === selected?.id);

  useEffect(() => {
    const locationId = new URLSearchParams(routeLocation.search).get(
      "location",
    );
    if (locationId && directoryLocations.some((item) => item.id === locationId)) {
      const loc = directoryLocations.find((item) => item.id === locationId);
      setSelected({ type: "location", id: locationId });
      if (loc && loc.positioned) {
        setFlyTarget([loc.lat, loc.lng]);
      }
    }
  }, [directoryLocations, routeLocation.search]);

  useEffect(() => {
    if (directoryLocations.length > 0 && !placingId) {
      setPlacingId(directoryLocations[0].id);
    }
  }, [directoryLocations, placingId]);

  const results = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toLowerCase();
    const allLocs = directoryLocations.length ? directoryLocations : localLocations;
    const allNodes = directoryNodes.length ? directoryNodes : localNodes;
    const allPaths = directoryPathways.length ? directoryPathways : localPathways;

    const matchedLocs = allLocs
      .filter((l) => l.name.toLowerCase().includes(q) || l.type.toLowerCase().includes(q))
      .map((item) => ({ ...item, kind: "Location" as const }));
    const matchedNodes = allNodes
      .filter((n) => n.name.toLowerCase().includes(q) || n.nodeType.toLowerCase().includes(q))
      .map((item) => ({ ...item, kind: "Route Node" as const }));
    const matchedPaths = allPaths
      .filter((p) => p.name.toLowerCase().includes(q) || p.shade.toLowerCase().includes(q))
      .map((item) => ({ ...item, kind: "Pathway" as const }));
    return [...matchedLocs, ...matchedNodes, ...matchedPaths].slice(0, 8);
  }, [directoryLocations, directoryNodes, directoryPathways, localLocations, localNodes, localPathways, search]);

  const selectObject = useCallback(
    (type: "location" | "node" | "pathway" | "building" | "area", id: string) => {
      setSelected({ type, id });
      if (type === "pathway") {
        const path = localPathways.find((p) => p.id === id) || directoryPathways.find((p) => p.id === id);
        if (path) {
          setEditingPathId(path.id);
          setPathPoints(path.pathPoints || []);
        }
      }
      setTemporary(null);
    },
    [directoryPathways, localPathways],
  );

  const handleSearchResultClick = (item: {
    id: string;
    kind: "Location" | "Route Node" | "Pathway";
    lat?: number;
    lng?: number;
  }) => {
    if (item.kind === "Location") {
      selectObject("location", item.id);
      const loc = directoryLocations.find((l) => l.id === item.id) || localLocations.find((l) => l.id === item.id);
      if (loc && loc.positioned) setFlyTarget([loc.lat, loc.lng]);
    } else if (item.kind === "Route Node") {
      selectObject("node", item.id);
      const n = directoryNodes.find((node) => node.id === item.id) || localNodes.find((node) => node.id === item.id);
      if (n) setFlyTarget([n.lat, n.lng]);
    } else if (item.kind === "Pathway") {
      selectObject("pathway", item.id);
      const p = directoryPathways.find((path) => path.id === item.id) || localPathways.find((path) => path.id === item.id);
      if (p) {
        const src = directoryNodes.find((n) => n.id === p.sourceNodeId) || localNodes.find((n) => n.id === p.sourceNodeId);
        if (src) setFlyTarget([src.lat, src.lng]);
      }
    }
    setSearch("");
  };

  const onMapClick = (point: [number, number]) => {
    if (mode === "area") {
      setPoints((current) => [...current, point]);
      setDirty(true);
    } else if (mode === "place" || mode === "move") {
      setTemporary(point);
      setDirty(true);
    } else if (mode === "path" && editingPathId && !manualPathPointDrag) {
      setPathPoints((current) => [...current, point]);
      setDirty(true);
    }
  };

  const handleStartMoveMarker = () => {
    if (!selectedLocation) return;
    setMovingType("location");
    setMovingId(selectedLocation.id);
    setTemporary([selectedLocation.lat, selectedLocation.lng]);
    setMode("move");
  };

  const handleStartMoveNode = () => {
    if (!selectedNode) return;
    setMovingType("node");
    setMovingId(selectedNode.id);
    setTemporary([selectedNode.lat, selectedNode.lng]);
    setMode("move");
  };

  const handleSavePosition = () => {
    if (!temporary) return;
    if (movingType === "location" && movingId) {
      const existing = currentLocations.find((location) => location.id === movingId);
      const updated = existing ? { ...existing, lat: temporary[0], lng: temporary[1], positioned: true } : null;
      if (updated) {
        setLocalLocations((current) => {
          const filtered = current.filter((l) => l.id !== movingId);
          return [...filtered, updated];
        });
      }
      setDirty(true);
      setMode("select");
      setSelected({ type: "location", id: movingId });
    } else if (movingType === "node" && movingId) {
      const existing = currentNodes.find((node) => node.id === movingId);
      const updated = existing ? { ...existing, lat: temporary[0], lng: temporary[1] } : null;
      if (updated) {
        setLocalNodes((current) => {
          const filtered = current.filter((n) => n.id !== movingId);
          return [...filtered, updated];
        });
      }
      setDirty(true);
      setMode("select");
      setSelected({ type: "node", id: movingId });
    }
  };

  const handleSavePlacedMarker = () => {
    if (!temporary || !placingId) return;
    const target = directoryLocations.find((l) => l.id === placingId);
    if (target) {
      const updatedLoc: Location = {
        ...target,
        lat: temporary[0],
        lng: temporary[1],
        positioned: true,
      };
      setLocalLocations((current) => {
        const filtered = current.filter((l) => l.id !== placingId);
        return [...filtered, updatedLoc];
      });
      setDirty(true);
      setMode("select");
      setSelected({ type: "location", id: placingId });
    }
  };

  const handleSavePlacedNode = () => {
    if (!temporary || !placingNodeName.trim()) return;
    const newNodeId = `node-${Date.now()}`;
    const newNode: RouteNode = {
      id: newNodeId,
      name: placingNodeName.trim(),
      nodeType: placingNodeType,
      associatedPlaceId: placingAssociatedPlaceId || null,
      lat: temporary[0],
      lng: temporary[1],
    };
    setLocalNodes((current) => [...current, newNode]);
    setDirty(true);
    setPlacingNodeName("");
    setMode("select");
    setSelected({ type: "node", id: newNodeId });
  };

  const handleSavePathShape = () => {
    if (!editingPathId) return;
    const target = localPathways.find((pathway) => pathway.id === editingPathId) || directoryPathways.find((pathway) => pathway.id === editingPathId);
    if (target) {
      const updatedPath: Pathway = {
        ...target,
        pathPoints: [...pathPoints],
      };
      setLocalPathways((current) => {
        const filtered = current.filter((p) => p.id !== editingPathId);
        return [...filtered, updatedPath];
      });
      const src = directoryNodes.find((n) => n.id === target.sourceNodeId);
      const dst = directoryNodes.find((n) => n.id === target.destinationNodeId);
      if (src && !localNodes.some((n) => n.id === src.id)) setLocalNodes((c) => [...c, src]);
      if (dst && !localNodes.some((n) => n.id === dst.id)) setLocalNodes((c) => [...c, dst]);
    }
    setDirty(true);
    setMode("select");
  };

  const handleSaveBuilding = () => {
    if (!canSaveBuilding) return;
    const building: Building = {
      id: `building-${Date.now()}`,
      name: buildingName.trim(),
      code: buildingCode.trim(),
      points: [...points],
    };
    setLocalBuildings((current) => [...current, building]);
    setDirty(true);
    setPoints([]);
    setBuildingName("");
    setBuildingCode("");
    setMode("select");
    setSelected({ type: "building", id: building.id });
  };

  const resetDraft = () => {
    setLocalLocations([]);
    setLocalNodes([]);
    setLocalPathways([]);
    setLocalBuildings([]);
    setDirty(false);
    setTemporary(null);
    setPoints([]);
    setPathPoints([]);
    setEditingPathId(null);
    setConfirm(null);
    setPreviewOpen(false);
    setError("");
    setMode("select");
    setSelected(null);
  };

  const updateLocation = (updated: Location) => { setLocalLocations((items) => [...items.filter((item) => item.id !== updated.id), updated]); setDirty(true); };
  const updateNode = (updated: RouteNode) => { setLocalNodes((items) => [...items.filter((item) => item.id !== updated.id), updated]); setDirty(true); };
  const updatePathway = (updated: Pathway) => { setLocalPathways((items) => [...items.filter((item) => item.id !== updated.id), updated]); setDirty(true); };
  const updateBuilding = (updated: Building) => { setLocalBuildings((items) => [...items.filter((item) => item.id !== updated.id), updated]); setDirty(true); };
  const focusObject = (object: MapObjectReference, fieldLabel?: string) => {
    setPreviewOpen(false);
    setSelected({ type: object.type, id: object.id });
    if (fieldLabel) {
      window.setTimeout(() => document.querySelector<HTMLElement>(`[aria-label="${fieldLabel}"]`)?.focus());
    }
    if (object.type === "pathway") {
      const pathway = currentPathways.find((item) => item.id === object.id);
      if (pathway) {
        setEditingPathId(pathway.id);
        setPathPoints(pathway.pathPoints);
      }
    }
    const positioned = [...currentLocations, ...currentNodes].find((item) => item.id === object.id);
    if (positioned) setFlyTarget([positioned.lat, positioned.lng]);
    if (object.type === "pathway") {
      const pathway = currentPathways.find((item) => item.id === object.id);
      const source = pathway && currentNodes.find((item) => item.id === pathway.sourceNodeId);
      if (source) setFlyTarget([source.lat, source.lng]);
    }
    if (object.type === "building") {
      const building = currentBuildings.find((item) => item.id === object.id);
      if (building?.points[0]) setFlyTarget(building.points[0]);
    }
  };

  const openSaveReview = () => {
    if (!draftReview.valid) {
      setPreviewOpen(true);
      return;
    }
    setConfirm("save");
  };

  const commit = async () => {
    if (confirm === "discard") {
      resetDraft();
      return;
    }
    try {
      await services.map.save({
        selected: selected ?? undefined,
        pathPoints: pathPoints.length ? pathPoints : undefined,
        areaPoints: points.length >= 3 ? points : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["map"] });
      setDirty(false);
      setConfirm(null);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save map changes.",
      );
    }
  };

  const activePathway = directoryPathways.find((p) => p.id === editingPathId) || localPathways.find((p) => p.id === editingPathId);

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-100px)] min-h-[580px] p-2">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white px-5 py-3 rounded-[24px] border border-[#e1e3e4] shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-[#005931] text-white flex items-center justify-center font-bold text-sm">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-extrabold text-[#191c1d] leading-tight">Interactive Map Editor</h1>
            <p className="text-[11px] text-[#3f4941]">Plot locations, calibrate route nodes, and adjust pathway curve vertices</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="px-4 py-2 border border-[#005931] rounded-full text-xs font-bold text-[#005931] hover:bg-emerald-50 transition cursor-pointer"
          >
            Preview Map
          </button>
          <button
            type="button"
            disabled={!dirty && mode !== "area" && points.length === 0}
            onClick={() => setConfirm("discard")}
            className="px-4 py-2 border border-[#dbe0e2] rounded-full text-xs font-bold text-[#3f4941] hover:bg-[#e1e3e4] disabled:opacity-40 transition cursor-pointer"
          >
            Discard
          </button>
          <button
            type="button"
            disabled={!dirty && mode !== "area" && points.length === 0}
            onClick={openSaveReview}
            className="px-5 py-2 bg-[#005931] hover:bg-[#004727] rounded-full text-xs font-bold text-white shadow disabled:opacity-40 transition flex items-center gap-1.5 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            <span>Save Changes</span>
          </button>
        </div>
      </div>

      <div className="relative flex-1 rounded-[28px] overflow-hidden border border-[#e1e3e4] shadow-sm bg-[#dce8e2] min-h-[500px]">
        <MapContainer
          center={campusCenter}
          zoom={18}
          zoomControl={false}
          className="w-full h-full"
        >
          <TileLayer
            attribution={
              basemap === "satellite"
                ? "© Esri"
                : "© OpenStreetMap"
            }
            url={
              basemap === "satellite"
                ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            }
          />
          <MapController onMapClick={onMapClick} flyTarget={flyTarget} />

          {currentBuildings.map((building) => (
            <Polygon
              key={building.id}
              positions={building.points}
              pathOptions={{
                color: selected?.id === building.id ? "#e67e22" : "#278b70",
                fillColor: "#8fd1bd",
                fillOpacity: selected?.id === building.id ? 0.35 : 0.22,
                weight: selected?.id === building.id ? 3 : 2,
              }}
              eventHandlers={{
                click: () => selectObject("building", building.id),
              }}
            >
              <Tooltip direction="center" permanent className="map-label">
                {building.name}
              </Tooltip>
            </Polygon>
          ))}

          {currentPathways.map((path) => {
            const source = currentNodes.find((node) => node.id === path.sourceNodeId);
            const destination = currentNodes.find((node) => node.id === path.destinationNodeId);
            const isEditingThisPath = editingPathId === path.id && mode === "path";
            const currentPoints = isEditingThisPath ? pathPoints : path.pathPoints;
            const isSelected = selected?.id === path.id || isEditingThisPath;

            return source && destination ? (
              <Polyline
                key={path.id}
                positions={[
                  [source.lat, source.lng],
                  ...currentPoints,
                  [destination.lat, destination.lng],
                ]}
                pathOptions={{
                  color: isSelected ? "#e67e22" : "#005931",
                  weight: isSelected ? 6 : 4,
                  dashArray: isSelected ? undefined : "7 6",
                  opacity: isSelected ? 0.95 : 0.8,
                }}
                eventHandlers={{
                  click: () => selectObject("pathway", path.id),
                }}
              />
            ) : null;
          })}

          {currentLocations
            .filter((item) => item.positioned)
            .map((loc) => {
              const isSelected = selected?.type === "location" && selected?.id === loc.id;
              return (
                <Marker
                  key={loc.id}
                  position={[loc.lat, loc.lng]}
                  icon={createLocationPinIcon(isSelected)}
                  eventHandlers={{
                    click: () => selectObject("location", loc.id),
                  }}
                >
                  <Tooltip direction="top" offset={[0, -28]}>
                    {loc.name}
                  </Tooltip>
                  <Popup>
                    <strong>{loc.name}</strong>
                    <br />
                    <small>{loc.type} · {loc.code}</small>
                  </Popup>
                </Marker>
              );
            })}

          {currentNodes.map((node) => {
            const isSelected = selected?.type === "node" && selected?.id === node.id;
            return (
              <Marker
                key={node.id}
                position={[node.lat, node.lng]}
                icon={createNodeIcon(isSelected)}
                eventHandlers={{
                  click: () => selectObject("node", node.id),
                }}
              >
                <Tooltip direction="top" offset={[0, -10]}>
                  {node.name}
                </Tooltip>
              </Marker>
            );
          })}

          {mode === "path" &&
            pathPoints.map((point, index) => (
              <Marker
                key={`path-point-${index}`}
                position={point}
                icon={createPointIcon(true)}
                draggable={manualPathPointDrag && selectedPathPointIndex === index}
                eventHandlers={{
                  click: () => setSelectedPathPointIndex(index),
                  dragend: (event) => {
                    const marker = event.target as L.Marker;
                    const next = marker.getLatLng();
                    setPathPoints((current) =>
                      current.map((item, i) =>
                        i === index ? [next.lat, next.lng] : item,
                      ),
                    );
                    setSelectedPathPointIndex(index);
                    setDirty(true);
                  },
                }}
              />
            ))}

          {points.length > 1 && (
            <Polygon
              positions={points}
              pathOptions={{
                color: "#005931",
                fillColor: "#8fd1bd",
                fillOpacity: 0.25,
                weight: 2,
              }}
            />
          )}

          {mode === "area" &&
            points.map((pt, i) => (
              <Marker
                key={`area-pt-${i}`}
                position={pt}
                icon={createPointIcon(true)}
              />
            ))}

          {temporary && (
            <Marker position={temporary} icon={createTempIcon()} />
          )}
        </MapContainer>

        <div className="absolute top-4 left-4 z-[900] bg-white/95 backdrop-blur-md p-1.5 rounded-full shadow-lg border border-[#e1e3e4] flex items-center gap-1">
          <button
            type="button"
            className={`tool flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition ${basemap === "street" ? "active bg-[#005931] text-white shadow-sm" : "text-[#3f4941] hover:bg-emerald-50"}`}
            onClick={() => setBasemap("street")}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            <span>Map</span>
          </button>
          <button
            type="button"
            className={`tool flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition ${basemap === "satellite" ? "active bg-[#005931] text-white shadow-sm" : "text-[#3f4941] hover:bg-emerald-50"}`}
            onClick={() => setBasemap("satellite")}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Satellite</span>
          </button>
          
          <div className="w-px h-5 bg-[#e1e3e4] mx-1" />

          <button
            type="button"
            className={`tool flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition ${mode === "select" ? "active bg-[#005931] text-white shadow-sm" : "text-[#3f4941] hover:bg-emerald-50"}`}
            onClick={() => {
              setMode("select");
              setTemporary(null);
            }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
            </svg>
            <span>Select</span>
          </button>
          <button
            type="button"
            className={`tool flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition ${mode === "place" || mode === "move" ? "active bg-[#005931] text-white shadow-sm" : "text-[#3f4941] hover:bg-emerald-50"}`}
            onClick={() => {
              setMode("place");
              setSelected(null);
            }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>Place</span>
          </button>
          <button
            type="button"
            className={`tool flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition ${mode === "path" ? "active bg-[#005931] text-white shadow-sm" : "text-[#3f4941] hover:bg-emerald-50"}`}
            onClick={() => {
              setMode("path");
              if (!editingPathId && (directoryPathways.length || localPathways.length)) {
                const first = localPathways[0] || directoryPathways[0];
                if (first) {
                  setEditingPathId(first.id);
                  setPathPoints(first.pathPoints || []);
                }
              }
            }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            <span>Path</span>
          </button>
          <button
            type="button"
            className={`tool flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition ${mode === "area" ? "active bg-[#005931] text-white shadow-sm" : "text-[#3f4941] hover:bg-emerald-50"}`}
            onClick={() => setMode("area")}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
            <span>Area</span>
          </button>
        </div>

        <div className="absolute top-4 right-4 z-[900] w-72 bg-white/95 backdrop-blur-md p-2 rounded-[20px] shadow-lg border border-[#e1e3e4]">
          <div className="relative flex items-center">
            <svg className="w-4 h-4 absolute left-3 text-[#3f4941]/60 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search campus places..."
              className="w-full bg-[#f8f9fa] text-xs font-semibold py-2 pl-9 pr-7 rounded-xl outline-none focus:ring-2 focus:ring-[#005931]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 text-xs font-bold text-[#005931]"
              >
                ×
              </button>
            )}
          </div>
          {results.length > 0 && (
            <div className="mt-2 pt-2 border-t border-[#e1e3e4] max-h-56 overflow-y-auto text-xs">
              {results.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="w-full text-left p-2 hover:bg-[#f8f9fa] rounded-lg flex items-center justify-between transition"
                  onClick={() => handleSearchResultClick(item)}
                >
                  <span className="font-semibold text-[#191c1d]">{item.name}</span>
                  <span className="text-[10px] text-[#3f4941] bg-[#e1e3e4] px-2 py-0.5 rounded-full">{item.kind}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {(selected || mode === "place" || mode === "move" || mode === "path" || mode === "area") && (
          <aside className="absolute top-20 right-4 z-[901] w-80 max-h-[calc(100%-100px)] overflow-y-auto bg-white/98 backdrop-blur-md p-5 rounded-[28px] shadow-2xl border border-[#e1e3e4]">
            {error && (
              <div className="mb-3 p-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl" role="alert">
                {error}
              </div>
            )}

            {mode === "move" ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Positioning</div>
                <h2 className="text-base font-extrabold text-[#191c1d] mt-1">
                  {movingType === "location" ? "Move Location Marker" : "Move Route Node"}
                </h2>
                <div className="text-xs text-[#3f4941]">
                  {movingType === "location" ? selectedLocation?.name ?? "Location" : selectedNode?.name ?? "Route Node"}
                </div>
                <div className="my-3 text-xs text-[#3f4941]">
                  {temporary
                    ? `Preview position: ${temporary[0].toFixed(5)}, ${temporary[1].toFixed(5)}`
                    : "Click the map to preview a new position."}
                </div>
                <div className="flex items-center gap-2 mt-4">
                  <button
                    type="button"
                    className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
                    onClick={() => setMode("select")}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!temporary}
                    onClick={handleSavePosition}
                    className="px-5 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow disabled:opacity-40 transition cursor-pointer"
                  >
                    Save Position
                  </button>
                </div>
              </div>
            ) : mode === "area" ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Building Footprint</div>
                <h2 className="text-base font-extrabold text-[#191c1d] mt-1">Draw Building Footprint</h2>
                <p className="text-xs text-[#3f4941] mt-1">Enter the Building identity and click at least 3 distinct points on the map to form its footprint.</p>
                <label className="mt-3 block text-xs font-semibold text-[#3f4941]">Building name
                  <input aria-label="Building name" value={buildingName} onChange={(event) => setBuildingName(event.target.value)} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm" />
                </label>
                <label className="mt-2 block text-xs font-semibold text-[#3f4941]">Building code
                  <input aria-label="Building code" value={buildingCode} onChange={(event) => setBuildingCode(event.target.value)} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm" />
                </label>
                <div className="text-xs font-bold text-[#191c1d] my-3">Points plotted: {points.length}</div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    type="button"
                    disabled={!points.length}
                    onClick={() => setPoints((c) => c.slice(0, -1))}
                    className="px-3 py-1.5 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] disabled:opacity-40 transition cursor-pointer"
                  >
                    Remove Last Point
                  </button>
                  <button
                    type="button"
                    disabled={!points.length}
                    onClick={() => setPoints([])}
                    className="px-3 py-1.5 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] disabled:opacity-40 transition cursor-pointer"
                  >
                    Clear Area
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[#e1e3e4]">
                  <button
                    type="button"
                    className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
                    onClick={() => setMode("select")}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!canSaveBuilding}
                    onClick={handleSaveBuilding}
                    className="px-5 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow disabled:opacity-40 transition cursor-pointer"
                  >
                    Save Building
                  </button>
                </div>
              </div>
            ) : mode === "place" ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Place on Map</div>
                <h2 className="text-base font-extrabold text-[#191c1d] mt-1">
                  {placingObjectType === "location" ? "Place Location Marker" : "Place Route Node"}
                </h2>
                <div className="flex flex-col gap-1.5 my-3">
                  <label className="text-xs font-semibold text-[#3f4941]">Object Type</label>
                  <select
                    value={placingObjectType === "location" ? "Location Marker" : "Route Node"}
                    onChange={(e) => {
                      const val = e.target.value === "Route Node" ? "node" : "location";
                      setPlacingObjectType(val);
                      setTemporary(null);
                    }}
                    className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
                  >
                    <option>Location Marker</option>
                    <option>Route Node</option>
                  </select>
                </div>

                {placingObjectType === "location" ? (
                  <>
                    <div className="flex flex-col gap-1.5 my-3">
                      <label className="text-xs font-semibold text-[#3f4941]">Select Existing Record</label>
                      <select
                        value={placingId}
                        onChange={(e) => setPlacingId(e.target.value)}
                        className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
                      >
                        {directoryLocations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name} ({l.type})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="my-2 text-xs text-[#3f4941]">
                      {temporary
                        ? `Preview position: ${temporary[0].toFixed(5)}, ${temporary[1].toFixed(5)}`
                        : "Click the map to preview a new position."}
                    </div>
                    <div className="flex items-center gap-2 mt-4">
                      <button
                        type="button"
                        className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
                        onClick={() => setMode("select")}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={!temporary}
                        onClick={handleSavePlacedMarker}
                        className="px-5 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow disabled:opacity-40 transition cursor-pointer"
                      >
                        Save Position
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col gap-1.5 my-2">
                      <label className="text-xs font-semibold text-[#3f4941]">Node Type</label>
                      <select
                        value={placingNodeType}
                        onChange={(e) => setPlacingNodeType(e.target.value as "Entrance" | "Junction" | "Access Point")}
                        className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
                      >
                        <option>Entrance</option>
                        <option>Junction</option>
                        <option>Access Point</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5 my-2">
                      <label className="text-xs font-semibold text-[#3f4941]">Node Name</label>
                      <input
                        type="text"
                        placeholder="e.g. CAS Entrance"
                        value={placingNodeName}
                        onChange={(e) => setPlacingNodeName(e.target.value)}
                        className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5 my-2">
                      <label className="text-xs font-semibold text-[#3f4941]">Associated Place</label>
                      <select
                        value={placingAssociatedPlaceId ?? ""}
                        onChange={(e) => setPlacingAssociatedPlaceId(e.target.value || null)}
                        className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
                      >
                        <option value="">None</option>
                        {directoryBuildings.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} (Building)
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="my-2 text-xs text-[#3f4941]">
                      {temporary
                        ? `Preview position: ${temporary[0].toFixed(5)}, ${temporary[1].toFixed(5)}`
                        : "Click the map to position this route node."}
                    </div>
                    <div className="flex items-center gap-2 mt-4">
                      <button
                        type="button"
                        className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
                        onClick={() => setMode("select")}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={!temporary || !placingNodeName.trim()}
                        onClick={handleSavePlacedNode}
                        className="px-5 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow disabled:opacity-40 transition cursor-pointer"
                      >
                        Save Node
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : mode === "path" ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Path Shape Points</div>
                <h2 className="text-base font-extrabold text-[#191c1d] mt-1">Calibrate Path Points</h2>
                {activePathway && (
                  <>
                    <div className="flex flex-col gap-1.5 my-3">
                      <label className="text-xs font-semibold text-[#3f4941]">Pathway</label>
                      <select
                        value={editingPathId ?? ""}
                        onChange={(e) => {
                          setEditingPathId(e.target.value);
                          const found = directoryPathways.find((p) => p.id === e.target.value) || localPathways.find((p) => p.id === e.target.value);
                        if (found) setPathPoints(found.pathPoints || []);
                        setSelectedPathPointIndex(null);
                        }}
                        className="bg-[#f8f9fa] border border-[#dbe0e2] text-xs font-semibold rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#005931]"
                      >
                        {directoryPathways.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="text-xs text-[#3f4941] my-2">
                      {manualPathPointDrag ? "Drag the selected Path Point to move it." : "Click the map to add path points or select a Path Point to adjust it."}{" "}
                      <strong>{pathPoints.length} points plotted</strong>.
                    </p>
                    {selectedPathPointIndex !== null && pathPoints[selectedPathPointIndex] && (
                      <section aria-label="Selected Path Point" className="my-3 rounded-xl border border-[#dbe0e2] p-3">
                        <label className="block text-xs font-semibold text-[#3f4941]">Latitude
                          <input aria-label="Path Point latitude" type="number" step="any" value={pathPoints[selectedPathPointIndex][0]} onChange={(event) => setPathPoints((current) => current.map((point, index) => index === selectedPathPointIndex ? [Number(event.target.value), point[1]] : point))} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs" />
                        </label>
                        <label className="mt-2 block text-xs font-semibold text-[#3f4941]">Longitude
                          <input aria-label="Path Point longitude" type="number" step="any" value={pathPoints[selectedPathPointIndex][1]} onChange={(event) => setPathPoints((current) => current.map((point, index) => index === selectedPathPointIndex ? [point[0], Number(event.target.value)] : point))} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs" />
                        </label>
                      </section>
                    )}
                    <div className="flex items-center gap-2 mt-3">
                      <button type="button" aria-pressed={manualPathPointDrag} onClick={() => setManualPathPointDrag((enabled) => !enabled)} className="px-3 py-1.5 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4]">
                        {manualPathPointDrag ? "Stop Dragging" : "Drag Path Point"}
                      </button>
                      <button
                        type="button"
                        disabled={!pathPoints.length}
                        onClick={() => setPathPoints((c) => c.slice(0, -1))}
                        className="px-3 py-1.5 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] disabled:opacity-40 transition cursor-pointer"
                      >
                        Remove Last Point
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[#e1e3e4]">
                      <button
                        type="button"
                        className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
                        onClick={() => setMode("select")}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSavePathShape}
                        className="px-5 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow transition cursor-pointer"
                      >
                        Save Path
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : selectedBuilding ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Selected Building</div>
                <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Building name
                  <input aria-label="Building name" value={selectedBuilding.name} onChange={(event) => updateBuilding({ ...selectedBuilding, name: event.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm font-bold" />
                </label>
                <label className="mt-2 block text-[10px] font-bold text-[#3f4941]">Building code
                  <input aria-label="Building code" value={selectedBuilding.code} onChange={(event) => updateBuilding({ ...selectedBuilding, code: event.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm font-bold" />
                </label>
                <div className="text-xs text-[#3f4941] mt-2">Building footprint</div>
                <dl className="divide-y divide-[#e1e3e4] text-xs my-3">
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Object Type</dt>
                    <dd className="text-[#191c1d] font-bold">Building Area Footprint</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Status</dt>
                    <dd className="text-[#191c1d] font-bold">Positioned</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Code</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedBuilding.code}</dd>
                  </div>
                </dl>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            ) : selectedLocation ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Selected Location</div>
                <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Location name
                  <input aria-label="Location name" value={selectedLocation.name} onChange={(event) => updateLocation({ ...selectedLocation, name: event.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm font-bold" />
                </label>
                <div className="text-xs text-[#3f4941]">{selectedLocation.type} · Positioned</div>
                <dl className="divide-y divide-[#e1e3e4] text-xs my-3">
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Name</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedLocation.name}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Type</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedLocation.type}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Building</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedLocation.building || "CCSICT Building"}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Floor</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedLocation.floor || "1st Floor"}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Latitude</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedLocation.lat.toFixed(6)}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Longitude</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedLocation.lng.toFixed(6)}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2 mt-4">
                  <button
                    type="button"
                    onClick={handleStartMoveMarker}
                    className="px-4 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow transition cursor-pointer"
                  >
                    Move Marker
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            ) : selectedNode ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Selected Route Node</div>
                <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Route Node name
                  <input aria-label="Route Node name" value={selectedNode.name} onChange={(event) => updateNode({ ...selectedNode, name: event.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm font-bold" />
                </label>
                <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Route Node type
                  <select aria-label="Route Node type" value={selectedNode.nodeType} onChange={(event) => updateNode({ ...selectedNode, nodeType: event.target.value as RouteNode["nodeType"] })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs">
                    <option>Entrance</option><option>Junction</option><option>Access Point</option>
                  </select>
                </label>
                <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Associated Location
                  <select aria-label="Associated Location" value={selectedNode.associatedPlaceId ?? ""} onChange={(event) => updateNode({ ...selectedNode, associatedPlaceId: event.target.value || null })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-xs">
                    <option value="">None</option>
                    {selectedNode.associatedPlaceId && !currentLocations.some((location) => location.id === selectedNode.associatedPlaceId) && (
                      <option value={selectedNode.associatedPlaceId}>Missing Location ({selectedNode.associatedPlaceId})</option>
                    )}
                    {currentLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                  </select>
                </label>
                <div className="text-xs text-[#3f4941]">{selectedNode.nodeType}</div>
                <dl className="divide-y divide-[#e1e3e4] text-xs my-3">
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Node Type</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedNode.nodeType}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Latitude</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedNode.lat.toFixed(6)}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Longitude</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedNode.lng.toFixed(6)}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Connected Paths</dt>
                    <dd className="text-[#191c1d] font-bold">
                      {
                        directoryPathways.filter(
                          (p) =>
                            p.sourceNodeId === selectedNode.id ||
                            p.destinationNodeId === selectedNode.id,
                        ).length
                      }
                    </dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2 mt-4">
                  <button
                    type="button"
                    onClick={handleStartMoveNode}
                    className="px-4 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow transition cursor-pointer"
                  >
                    Move Node
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            ) : selectedPath ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#005931]">Selected Connection</div>
                <label className="block text-[10px] font-bold text-[#3f4941] mt-2">Pathway name
                  <input aria-label="Pathway name" value={selectedPath.name} onChange={(event) => updatePathway({ ...selectedPath, name: event.target.value })} className="mt-1 w-full rounded-lg border border-[#dbe0e2] px-2 py-1.5 text-sm font-bold" />
                </label>
                <dl className="divide-y divide-[#e1e3e4] text-xs my-3">
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Source</dt>
                    <dd><select aria-label="Pathway source" value={selectedPath.sourceNodeId} onChange={(event) => updatePathway({ ...selectedPath, sourceNodeId: event.target.value })} className="w-full border rounded px-1 py-1 font-bold">{currentNodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Destination</dt>
                    <dd><select aria-label="Pathway destination" value={selectedPath.destinationNodeId} onChange={(event) => updatePathway({ ...selectedPath, destinationNodeId: event.target.value })} className="w-full border rounded px-1 py-1 font-bold">{currentNodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Distance</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedPath.distance}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Walking Time</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedPath.time}</dd>
                  </div>
                  <div className="grid grid-cols-2 py-1.5 gap-2">
                    <dt className="text-[#3f4941] font-medium">Intermediate Points</dt>
                    <dd className="text-[#191c1d] font-bold">{selectedPath.pathPoints?.length || 0}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingPathId(selectedPath.id);
                      setPathPoints(selectedPath.pathPoints || []);
                      setMode("path");
                    }}
                    className="px-4 py-2 bg-[#005931] hover:bg-[#004727] text-white rounded-full text-xs font-bold shadow transition cursor-pointer"
                  >
                    Edit Path Points
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="px-3 py-2 bg-[#f8f9fa] border border-[#dbe0e2] text-[#3f4941] rounded-full text-xs font-bold hover:bg-[#e1e3e4] transition cursor-pointer"
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            ) : null}
          </aside>
        )}

        <div className="absolute bottom-4 left-4 z-[900] bg-white/95 backdrop-blur-md p-4 rounded-[24px] shadow-lg border border-[#e1e3e4] w-52 pointer-events-auto">
          <div className="flex items-center justify-between text-xs font-extrabold text-[#191c1d] mb-2">
            <span>Map Legend</span>
            <svg className="w-4 h-4 text-[#3f4941]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <div className="flex flex-col gap-2 text-[11px] font-semibold text-[#3f4941]">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#005931] border-2 border-white ring-1 ring-[#005931]"></span>
              <span>Campus Location</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-[#2563eb] border-2 border-white ring-1 ring-[#1d4ed8]"></span>
              <span>Route Node</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-white border-2 border-[#005931]"></span>
              <span>Path Point</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 border-t-2 border-dashed border-amber-600"></span>
              <span>Walking Path</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-2.5 bg-[#8fd1bd]/50 border border-[#278b70]"></span>
              <span>Building Footprint</span>
            </div>
          </div>
        </div>
      </div>

      {confirm && (
        <Modal
          title={
            confirm === "save" ? "Save map changes?" : "Discard changes?"
          }
          subtitle={
            confirm === "save"
              ? "Persist local draft geometry to the central backend."
              : "Discard uncommitted marker and shape drafts."
          }
          size="sm"
          variant={confirm === "save" ? "green" : "danger"}
          onClose={() => setConfirm(null)}
        >
          <p className="text-xs text-[#3f4941] my-2">
            {confirm === "save"
              ? "This will save marker, node, and pathway geometry changes."
              : "Unsaved marker, node, and pathway edits will be lost."}
          </p>
          {error && (
            <div className="p-2 my-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl" role="alert">
              {error}
            </div>
          )}
          <div className="modal-actions">
            <Button
              variant="subtle"
              onClick={() => setConfirm(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={commit}
              variant={confirm === "save" ? "primary" : "danger"}
            >
              {confirm === "save" ? "Save Changes" : "Discard"}
            </Button>
          </div>
        </Modal>
      )}
      {previewOpen && (
        <Modal
          title="Preview Map"
          subtitle="Validate pending map output and review changes before saving."
          size="md"
          variant={draftReview.valid ? "green" : "danger"}
          onClose={() => setPreviewOpen(false)}
        >
          {draftReview.errors.length > 0 ? (
            <div className="space-y-2 my-3">
              <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl">
                Correct {draftReview.errors.length} validation {draftReview.errors.length === 1 ? "error" : "errors"} before saving.
              </div>
              {draftReview.errors.map((validationError, index) => (
                <button
                  key={`${validationError.object.type}-${validationError.object.id}-${index}`}
                  type="button"
                  onClick={() => focusObject(
                    validationError.object,
                    validationError.message === "Associated Location does not exist."
                      ? "Associated Location"
                      : validationError.message === "Building code is required."
                        ? "Building code"
                        : validationError.message === "Building name is required."
                          ? "Building name"
                        : undefined,
                  )}
                  className="w-full text-left p-3 border border-red-100 rounded-xl hover:bg-red-50"
                >
                  <span className="block text-xs font-bold text-[#191c1d]">{validationError.object.label}</span>
                  <span className="block text-xs text-red-700 mt-1">{validationError.message}</span>
                </button>
              ))}
            </div>
          ) : draftReview.groups.length === 0 ? (
            <p className="my-4 text-sm text-[#3f4941]">No pending changes.</p>
          ) : (
            <div className="space-y-3 my-3">
              {draftReview.groups.map((group) => (
                <section key={group.kind}>
                  <h3 className="text-xs font-extrabold uppercase tracking-wide text-[#005931]">{group.kind} ({group.objects.length})</h3>
                  <ul className="mt-1 space-y-1">
                    {group.objects.map((object) => (
                      <li key={`${group.kind}-${object.type}-${object.id}`}>
                        <button type="button" onClick={() => focusObject(object)} className="text-xs text-left text-[#191c1d] hover:underline">
                          {object.label} <span className="text-[#3f4941]">· {object.type}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
          <div className="modal-actions">
            <Button variant="subtle" onClick={() => setPreviewOpen(false)}>Close</Button>
            {draftReview.valid && draftReview.groups.length > 0 && (
              <Button onClick={() => { setPreviewOpen(false); setConfirm("save"); }}>Continue to Save</Button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
