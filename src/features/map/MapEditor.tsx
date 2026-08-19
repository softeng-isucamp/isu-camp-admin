import { useMemo, useState } from "react";
import {
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { services } from "../../services/api";
import { campusCenter } from "../../services/mockData";
import { Button, Card, Field, Modal } from "../../components/UI";
import "leaflet/dist/leaflet.css";

const icon = (color: string) =>
  L.divIcon({
    className: "custom-marker",
    html: `<span style="background:${color}"></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
function ClickCapture({
  onPoint,
}: {
  onPoint: (point: [number, number]) => void;
}) {
  useMapEvents({
    click: (event) => onPoint([event.latlng.lat, event.latlng.lng]),
  });
  return null;
}

export function MapEditor() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["map"],
    queryFn: async () => ({
      buildings: await services.map.buildings(),
      locations: await services.map.locations(),
      nodes: await services.map.nodes(),
      pathways: await services.map.pathways(),
    }),
  });
  const [mode, setMode] = useState<"select" | "place" | "path" | "area">(
    "select",
  );
  const [selected, setSelected] = useState<{ type: string; id: string } | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [points, setPoints] = useState<[number, number][]>([]);
  const [pathPoints, setPathPoints] = useState<[number, number][]>([]);
  const [place, setPlace] = useState<[number, number] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState<"save" | "discard" | null>(null);
  const [error, setError] = useState("");
  const [basemap, setBasemap] = useState<"street" | "light" | "satellite">(
    "street",
  );
  const [showBuildings, setShowBuildings] = useState(true);
  const [showPathways, setShowPathways] = useState(true);
  const selectedLocation = data?.locations.find(
    (item) => item.id === selected?.id,
  );
  const selectedNode = data?.nodes.find((item) => item.id === selected?.id);
  const selectedPath = data?.pathways.find((item) => item.id === selected?.id);
  const results = useMemo(() => {
    if (!data || !search.trim()) return [];
    return [
      ...data.locations.map((item) => ({ ...item, kind: "Location" })),
      ...data.nodes.map((item) => ({ ...item, kind: "Route Node" })),
      ...data.pathways.map((item) => ({ ...item, kind: "Pathway" })),
    ]
      .filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
      .slice(0, 6);
  }, [data, search]);
  const onPoint = (point: [number, number]) => {
    if (mode === "area") setPoints((current) => [...current, point]);
    else if (mode === "place") setPlace(point);
    else if (mode === "path" && selectedPath)
      setPathPoints((current) => [...current, point]);
    else return;
    setDirty(true);
  };
  const resetDraft = () => {
    setDirty(false);
    setPlace(null);
    setPoints([]);
    setPathPoints([]);
    setConfirm(null);
    setError("");
  };
  const commit = async () => {
    if (confirm === "discard") {
      resetDraft();
      return;
    }
    try {
      await services.map.save({
        selected: selected ?? undefined,
        place,
        pathPoints,
      });
      await queryClient.invalidateQueries({ queryKey: ["map"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["logs"] });
      resetDraft();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save map changes.",
      );
    }
  };
  return (
    <div className="map-editor-page">
      <div className="map-toolbar">
        <div className="map-search">
          <span>⌕</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search campus places..."
          />
          {results.length > 0 && (
            <div className="search-results">
              {results.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setSelected({ type: item.kind, id: item.id });
                    setSearch("");
                  }}
                >
                  <span>{item.name}</span>
                  <small>{item.kind}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="icon-btn">♧</button>
        <div className="avatar small">AJ</div>
      </div>
      <div className="map-workspace">
        <MapContainer
          center={campusCenter}
          zoom={18}
          zoomControl={false}
          className="leaflet-map"
        >
          <TileLayer
            attribution={
              basemap === "satellite"
                ? "© Esri"
                : basemap === "street"
                  ? "© OpenStreetMap"
                  : "© CARTO"
            }
            url={
              basemap === "street"
                ? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                : basemap === "light"
                  ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                  : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            }
          />
          <ClickCapture onPoint={onPoint} />
          {showBuildings &&
            data?.buildings.map((building) => (
              <Polygon
                key={building.id}
                positions={building.points}
                pathOptions={{
                  color: "#278b70",
                  fillColor: "#8fd1bd",
                  fillOpacity: 0.25,
                }}
              />
            ))}
          {showPathways &&
            data?.pathways.map((path) => {
              const source = data.nodes.find(
                (node) => node.id === path.sourceNodeId,
              );
              const destination = data.nodes.find(
                (node) => node.id === path.destinationNodeId,
              );
              return source && destination ? (
                <Polyline
                  key={path.id}
                  positions={[
                    [source.lat, source.lng],
                    ...(path.id === selected?.id && pathPoints.length
                      ? pathPoints
                      : path.pathPoints),
                    [destination.lat, destination.lng],
                  ]}
                  pathOptions={{
                    color: path.id === selected?.id ? "#e67e22" : "#005931",
                    weight: path.id === selected?.id ? 6 : 4,
                    dashArray: "7 6",
                  }}
                  eventHandlers={{
                    click: () => {
                      setSelected({ type: "pathway", id: path.id });
                      setPathPoints(path.pathPoints);
                    },
                  }}
                />
              ) : null;
            })}
          {data?.locations
            .filter((item) => item.positioned)
            .map((location) => (
              <Marker
                key={location.id}
                position={[location.lat, location.lng]}
                icon={icon(
                  location.id === selected?.id ? "#e67e22" : "#005931",
                )}
                eventHandlers={{
                  click: () =>
                    setSelected({ type: "location", id: location.id }),
                }}
              >
                <Popup>{location.name}</Popup>
              </Marker>
            ))}
          {data?.nodes.map((node) => (
            <Marker
              key={node.id}
              position={[node.lat, node.lng]}
              icon={icon(node.id === selected?.id ? "#e67e22" : "#2563eb")}
              eventHandlers={{
                click: () => setSelected({ type: "node", id: node.id }),
              }}
            />
          ))}
          {points.length > 1 && (
            <Polygon
              positions={points}
              pathOptions={{ color: "#005931", fillOpacity: 0.22 }}
            />
          )}
          {place && <Marker position={place} icon={icon("#e67e22")} />}
          {mode === "path" &&
            selectedPath &&
            pathPoints.map((point, index) => (
              <Marker
                key={`path-point-${index}`}
                position={point}
                icon={icon("#e67e22")}
                draggable
                eventHandlers={{
                  dragend: (event) => {
                    const marker = event.target as L.Marker;
                    const next = marker.getLatLng();
                    setPathPoints((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? [next.lat, next.lng] : item,
                      ),
                    );
                    setDirty(true);
                  },
                }}
              />
            ))}
        </MapContainer>
        <Card className="map-panel">
          <div className="mode-tabs">
            {(["select", "place", "path", "area"] as const).map((item) => (
              <button
                key={item}
                className={mode === item ? "active" : ""}
                onClick={() => setMode(item)}
              >
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          <div className="map-layer-controls">
            <p className="eyebrow">MAP LAYERS</p>
            <div className="inline-fields">
              <Button
                variant={basemap === "street" ? "primary" : "subtle"}
                onClick={() => setBasemap("street")}
              >
                Street
              </Button>
              <Button
                variant={basemap === "light" ? "primary" : "subtle"}
                onClick={() => setBasemap("light")}
              >
                Light
              </Button>
              <Button
                variant={basemap === "satellite" ? "primary" : "subtle"}
                onClick={() => setBasemap("satellite")}
              >
                Satellite
              </Button>
            </div>
            <label>
              <input
                type="checkbox"
                checked={showBuildings}
                onChange={(event) => setShowBuildings(event.target.checked)}
              />{" "}
              Buildings
            </label>
            <label>
              <input
                type="checkbox"
                checked={showPathways}
                onChange={(event) => setShowPathways(event.target.checked)}
              />{" "}
              Pathways
            </label>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {mode === "area" ? (
            <>
              <p className="eyebrow">ZONE POLYGON</p>
              <h2>Draw Campus Zone</h2>
              <p className="muted">
                Click at least 3 points on the map to form an area boundary.
              </p>
              <strong>Points plotted: {points.length}</strong>
              <div className="inline-fields">
                <Button
                  variant="subtle"
                  onClick={() => setPoints((current) => current.slice(0, -1))}
                  disabled={!points.length}
                >
                  Remove Last Point
                </Button>
                <Button
                  variant="subtle"
                  onClick={() => setPoints([])}
                  disabled={!points.length}
                >
                  Clear Area
                </Button>
              </div>
            </>
          ) : selectedLocation ? (
            <>
              <p className="eyebrow">SELECTED LOCATION</p>
              <h2>{selectedLocation.name}</h2>
              <p className="muted">
                {selectedLocation.type} · {selectedLocation.code}
              </p>
              <hr />
              <Button variant="subtle" onClick={() => setMode("place")}>
                Move Marker
              </Button>
            </>
          ) : selectedNode ? (
            <>
              <p className="eyebrow">SELECTED ROUTE NODE</p>
              <h2>{selectedNode.name}</h2>
              <p className="muted">{selectedNode.nodeType}</p>
              <Button variant="subtle" onClick={() => setMode("place")}>
                Move Node
              </Button>
            </>
          ) : selectedPath ? (
            <>
              <p className="eyebrow">SELECTED CONNECTION</p>
              <h2>{selectedPath.name}</h2>
              <p className="muted">
                {selectedPath.shade} · {selectedPath.status}
              </p>
              <hr />
              <Button
                variant="subtle"
                onClick={() => {
                  setPathPoints(selectedPath.pathPoints);
                  setMode("path");
                }}
              >
                Edit Path Points
              </Button>
              {mode === "path" && (
                <>
                  <p className="muted">
                    Click the map to add path points or drag an existing point
                    to move it. {pathPoints.length} points plotted.
                  </p>
                  <Button
                    variant="subtle"
                    onClick={() =>
                      setPathPoints((current) => current.slice(0, -1))
                    }
                    disabled={!pathPoints.length}
                  >
                    Remove Last Point
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              <p className="eyebrow">MAP EDITOR</p>
              <h2>Select a campus object</h2>
              <p className="muted">
                Choose a marker, route node, or pathway to inspect and edit it.
              </p>
            </>
          )}
          {mode === "place" && (
            <>
              <Field
                label="OBJECT TYPE"
                value={selectedNode ? "Route Node" : "Location Marker"}
                readOnly
              />
              <p className="muted">
                {place
                  ? `Preview position: ${place[0].toFixed(5)}, ${place[1].toFixed(5)}`
                  : "Click the map to preview a new position."}
              </p>
            </>
          )}
          {(dirty || mode === "area") && (
            <div className="map-actions">
              <Button variant="subtle" onClick={() => setConfirm("discard")}>
                Discard
              </Button>
              <Button onClick={() => setConfirm("save")}>Save Changes</Button>
            </div>
          )}
        </Card>
        {confirm && (
          <Modal
            title={
              confirm === "save" ? "Save map changes?" : "Discard changes?"
            }
            onClose={() => setConfirm(null)}
          >
            <p className="muted">
              {confirm === "save"
                ? "This will save marker, node, and pathway geometry changes."
                : "Unsaved marker, node, and pathway edits will be lost."}
            </p>
            <div className="modal-actions">
              <Button variant="subtle" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant={confirm === "save" ? "primary" : "danger"}
                onClick={commit}
              >
                {confirm === "save" ? "Save Changes" : "Discard"}
              </Button>
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
}
