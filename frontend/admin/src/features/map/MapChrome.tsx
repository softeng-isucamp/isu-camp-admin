import { PageIcon } from "../../components/PageIcon";
import { TileLayer } from "react-leaflet";

/** The Map Editor page header. */
export function MapPageHeader() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 bg-white px-5 py-3 rounded-[24px] border border-[#e1e3e4] shadow-sm shrink-0">
      <div className="flex items-center gap-3">
        <PageIcon name="map" size="sm" />
        <div>
          <h1 className="text-sm font-extrabold text-[#191c1d] leading-tight">Interactive Map Editor</h1>
          <p className="text-[11px] text-[#3f4941]">Plot locations, calibrate route nodes, and adjust pathway curve vertices</p>
        </div>
      </div>

    </div>
  );
}

interface BasemapToggleProps {
  basemap: "street" | "satellite";
  onChange: (basemap: "street" | "satellite") => void;
}

/** The Map / Satellite basemap switch. */
export function BasemapToggle({ basemap, onChange }: BasemapToggleProps) {
  return (
    <div className="map-glass-panel absolute left-4 top-4 z-[900] flex items-center gap-1 rounded-full p-1.5">
      <button
        type="button"
        className={`tool flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition ${basemap === "street" ? "active bg-[#005931] text-white shadow-sm" : "text-[#3f4941] hover:bg-emerald-50"}`}
        onClick={() => onChange("street")}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
        <span>Map</span>
      </button>
      <button
        type="button"
        className={`tool flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition ${basemap === "satellite" ? "active bg-[#005931] text-white shadow-sm" : "text-[#3f4941] hover:bg-emerald-50"}`}
        onClick={() => onChange("satellite")}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>Satellite</span>
      </button>
    </div>
  );
}

/** Shown in geometry tools when the map is zoomed out too far to edit. */
export function OverviewZoomNotice() {
  return (
    <div role="status" className="pointer-events-none absolute bottom-5 left-1/2 z-[1000] -translate-x-1/2 rounded-full bg-white/95 px-4 py-2 text-xs font-semibold text-[#234333] shadow-lg">
      Zoom in to edit geometry
    </div>
  );
}

interface BasemapTileLayerProps {
  basemap: "street" | "satellite";
  displaysOsmOverlays: boolean;
}

/** The street or satellite tiles, with attribution for any displayed OpenStreetMap overlays. */
export function BasemapTileLayer({ basemap, displaysOsmOverlays }: BasemapTileLayerProps) {
  return (
    <TileLayer
      key={basemap}
      maxNativeZoom={basemap === "satellite" ? 18 : 19}
      maxZoom={22}
      attribution={
        basemap === "satellite"
          ? `© Esri${displaysOsmOverlays ? " · © OpenStreetMap contributors" : ""}`
          : "© OpenStreetMap contributors"
      }
      url={
        basemap === "satellite"
          ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      }
    />
  );
}
