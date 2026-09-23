import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MapContainer, Polygon, Polyline, TileLayer, ZoomControl } from "react-leaflet";
import { campusCenter } from "../../services/mockData";
import { services } from "../../services/api";
import type { Building, Pathway, RouteNode } from "../../types";
import "leaflet/dist/leaflet.css";

type DashboardMapData = {
  buildings: Building[];
  pathways: Pathway[];
  nodes: RouteNode[];
};

const mapBounds: [[number, number], [number, number]] = [
  [16.712, 121.679],
  [16.732, 121.704],
];

async function loadDashboardMap(): Promise<DashboardMapData> {
  const [buildings, pathways, nodes] = await Promise.all([
    services.map.buildings(),
    services.map.pathways(),
    services.map.nodes(),
  ]);
  return { buildings, pathways, nodes };
}

export function DashboardMapPreview() {
  const [basemap, setBasemap] = useState<"map" | "satellite">("satellite");
  const { data, error, isLoading } = useQuery({
    queryKey: ["dashboard-map-preview"],
    queryFn: loadDashboardMap,
    staleTime: 30_000,
  });

  return (
    <div className="map-preview dashboard-map-preview">
      {isLoading ? (
        <div className="dashboard-map-state" role="status">Loading campus map…</div>
      ) : error || !data ? (
        <div className="dashboard-map-state" role="status">Campus map preview is unavailable.</div>
      ) : (
        <MapContainer
          center={campusCenter}
          zoom={16}
          minZoom={15}
          maxZoom={19}
          maxBounds={mapBounds}
          maxBoundsViscosity={0.7}
          scrollWheelZoom={false}
          zoomControl={false}
          className="dashboard-leaflet-map"
        >
          {basemap === "satellite" ? (
            <TileLayer
              key="satellite"
              attribution="© Esri"
              maxNativeZoom={18}
              maxZoom={19}
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          ) : (
            <TileLayer
              key="map"
              attribution="© OpenStreetMap contributors"
              maxNativeZoom={19}
              maxZoom={19}
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          )}
          <ZoomControl position="topright" />
          {data.buildings.filter((building) => building.points.length >= 3).map((building) => (
            <Polygon
              key={building.id}
              positions={building.points}
              pathOptions={{
                color: "#278b70",
                fillColor: "#8fd1bd",
                fillOpacity: 0.42,
                weight: 1.5,
              }}
            />
          ))}
          {data.pathways.map((pathway) => {
            const source = data.nodes.find((node) => node.id === pathway.sourceNodeId);
            const destination = data.nodes.find((node) => node.id === pathway.destinationNodeId);
            if (!source || !destination) return null;
            return (
              <Polyline
                key={pathway.id}
                positions={[
                  [source.lat, source.lng],
                  ...pathway.pathPoints,
                  [destination.lat, destination.lng],
                ]}
                pathOptions={{ color: "#005931", weight: 3, opacity: 0.8 }}
              />
            );
          })}
        </MapContainer>
      )}
      <div className="dashboard-basemap-toggle" role="group" aria-label="Basemap">
        <button type="button" className={basemap === "map" ? "active" : ""} aria-pressed={basemap === "map"} onClick={() => setBasemap("map")}>Map</button>
        <button type="button" className={basemap === "satellite" ? "active" : ""} aria-pressed={basemap === "satellite"} onClick={() => setBasemap("satellite")}>Satellite</button>
      </div>
      <div className="legend">
        <b>MAP LAYERS</b>
        <span><i className="dot green" />Buildings</span>
        <span><i className="dot blue" />Indoor Locations</span>
        <span><i className="dot orange" />Walking Network</span>
      </div>
    </div>
  );
}
