import { Spinner } from "../../../components/UI";
import type { Building, Location } from "../../../types";
import type { useIndoorLocationPlacement } from "./useIndoorLocationPlacement";

interface IndoorLocationPlacementPanelProps {
  indoor: ReturnType<typeof useIndoorLocationPlacement>;
  contentLocations: Location[];
  buildings: Building[];
  zoom: number;
  error: string;
  onSave: () => void;
}

export function IndoorLocationPlacementPanel({
  indoor,
  contentLocations: buildingContentLocations,
  buildings: currentBuildings,
  zoom: currentMapZoom,
  error,
  onSave,
}: IndoorLocationPlacementPanelProps) {
  const indoorPlacement = indoor.placement;
  if (!indoorPlacement) return null;
  return (
    <aside className="absolute right-4 top-4 z-[1000] flex max-h-[calc(100%-2rem)] w-[min(24rem,calc(100%-2rem))] flex-col gap-4 overflow-auto rounded-2xl border border-[#dbe6df] bg-white/95 p-5 text-[#234333] shadow-xl backdrop-blur" aria-label="Indoor location position editor">
      <div>
        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#426257]">INDOOR LOCATION</p>
        <h2 className="mt-1 text-lg font-extrabold text-[#191c1d]">{buildingContentLocations.find((location) => location.id === indoorPlacement.locationId)?.name ?? "Position location"}</h2>
        <p className="mt-1 text-xs text-[#526359]">{currentBuildings.find((building) => building.id === indoorPlacement.buildingId)?.name ?? "Parent Building"}</p>
      </div>
      <p role="status" className="rounded-xl bg-[#eff6f1] px-3 py-2.5 text-xs leading-relaxed">
        {indoorPlacement.position
          ? "Position preview selected. Click another point inside the building to change it."
          : "Click inside the building footprint to choose this location's position."}
        {currentMapZoom < 20 ? " Zoom to level 20 or closer." : ""}
      </p>
      {indoorPlacement.position && <dl className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-[#f7f9f8] p-2"><dt className="font-bold text-[#526359]">Latitude</dt><dd className="mt-1 font-mono">{indoorPlacement.position[0].toFixed(6)}</dd></div>
        <div className="rounded-lg bg-[#f7f9f8] p-2"><dt className="font-bold text-[#526359]">Longitude</dt><dd className="mt-1 font-mono">{indoorPlacement.position[1].toFixed(6)}</dd></div>
      </dl>}
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-[#e6ece8] pt-3">
        <button type="button" className="rounded-full border border-[#dbe0e2] px-4 py-2 text-xs font-bold" disabled={indoor.saving} onClick={indoor.cancel}>Cancel</button>
        <button type="button" className="rounded-full bg-[#005931] px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={!indoorPlacement.position || currentMapZoom < 20 || indoor.saving} onClick={onSave}>{indoor.saving && <Spinner size={12} />}{indoor.saving ? "Saving Position…" : "Save Position"}</button>
      </div>
    </aside>
  );
}
