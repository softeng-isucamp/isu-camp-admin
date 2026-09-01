import type { LocalFeatureFamily } from "../../services/mapEditorApiClient";
import { EDITABLE_LOCAL_FEATURE_FAMILIES } from "./localFeatures";

interface LocalFeatureFamilyPaletteProps {
  selectedFamily: Exclude<LocalFeatureFamily, "readonly_basemap">;
  onSelectFamily: (family: Exclude<LocalFeatureFamily, "readonly_basemap">) => void;
  featureName: string;
  onFeatureNameChange: (name: string) => void;
  pointCount: number;
  canCreate: boolean;
  onCreate: () => void;
  onClear: () => void;
}

export function LocalFeatureFamilyPalette({
  selectedFamily,
  onSelectFamily,
  featureName,
  onFeatureNameChange,
  pointCount,
  canCreate,
  onCreate,
  onClear,
}: LocalFeatureFamilyPaletteProps) {
  const selectedDefinition = EDITABLE_LOCAL_FEATURE_FAMILIES.find((family) => family.id === selectedFamily)!;
  return (
    <section
      className="absolute left-4 top-32 z-[901] w-72 rounded-2xl border border-[#d8e3dc] bg-white/95 p-4 shadow-xl backdrop-blur"
      aria-label="Local feature creation options"
    >
      <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#527064]">
        Create Local Map Feature
      </p>
      <div className="mt-3 grid gap-2">
        {EDITABLE_LOCAL_FEATURE_FAMILIES.map((family) => {
          const selected = selectedFamily === family.id;
          return (
            <button
              key={family.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelectFamily(family.id)}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left ${
                selected
                  ? "border-[#005931] bg-emerald-50 text-[#004727]"
                  : "border-[#dfe6e1] bg-white text-[#31443a]"
              }`}
            >
              <span
                className="grid h-7 w-7 place-items-center rounded-lg text-xs font-black text-white"
                style={{ backgroundColor: family.style.color }}
                aria-hidden="true"
              >
                {family.icon}
              </span>
              <span>
                <strong className="block text-xs">{family.label}</strong>
                <span className="block text-[10px] text-[#61746a]">{family.geometryType}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] leading-4 text-[#526158]">{selectedDefinition.instruction}</p>
      {selectedFamily !== "building_footprint" && (
        <>
          <label className="mt-3 block text-[10px] font-extrabold uppercase tracking-wide text-[#526158]">
            Feature name
            <input
              aria-label="Local feature name"
              value={featureName}
              onChange={(event) => onFeatureNameChange(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[#cad5ce] px-2.5 py-2 text-xs font-semibold normal-case tracking-normal"
            />
          </label>
          <p className="mt-2 text-[10px] font-bold text-[#61746a]">Points plotted: {pointCount}</p>
        </>
      )}
      <div className="mt-3 flex gap-2">
        {pointCount > 0 && (
          <button type="button" onClick={onClear} className="rounded-lg border border-[#d8e2dc] px-3 py-2 text-[11px] font-bold text-[#526158]">
            Clear
          </button>
        )}
        <button
          type="button"
          disabled={!canCreate}
          onClick={onCreate}
          className="flex-1 rounded-lg bg-[#005931] px-3 py-2 text-[11px] font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {selectedFamily === "building_footprint"
            ? "Continue with Building Polygon"
            : selectedFamily === "campus_boundary"
              ? "Replace Campus Boundary"
              : `Create ${selectedDefinition.label}`}
        </button>
      </div>
    </section>
  );
}
