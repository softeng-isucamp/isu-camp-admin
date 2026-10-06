import { joinPathwayWayTypes, pathwayHasWayType, splitPathwayWayTypes, PATHWAY_WAY_TYPES, type AllowedMode, type PathwayType } from "../../../types";

type WayTypeChoiceProps = {
  /** Names the group for assistive tech and for scoped test queries. */
  ariaLabel: string;
  value: string;
  allowedModes: readonly AllowedMode[] | undefined;
  onChange: (change: { type: string; allowedModes: AllowedMode[] }) => void;
  className?: string;
  legendClassName?: string;
  itemsClassName?: string;
};

/**
 * Way type is a set, not a single choice: a road with a sidewalk is both a Road
 * and a Walkway, so the admin may tick both and both are persisted. Vehicle mode
 * only survives while a Road Way type remains selected.
 */
export function WayTypeChoice({
  ariaLabel,
  value,
  allowedModes,
  onChange,
  className = "rounded-xl border border-[#dbe0e2] p-2.5",
  legendClassName = "px-1 text-xs font-semibold text-[#3f4941]",
  itemsClassName = "grid grid-cols-2 gap-2 text-xs",
}: WayTypeChoiceProps) {
  const selected = splitPathwayWayTypes(value);
  const toggle = (wayType: PathwayType, checked: boolean) => {
    const next = joinPathwayWayTypes(checked ? [...selected, wayType] : selected.filter((item) => item !== wayType));
    onChange({
      type: next,
      allowedModes: pathwayHasWayType(next, "Road") ? [...(allowedModes ?? ["Walking"])] : ["Walking"],
    });
  };
  return <fieldset aria-label={ariaLabel} className={className}>
    <legend className={legendClassName}>Way type</legend>
    <div className={itemsClassName}>
      {PATHWAY_WAY_TYPES.map((wayType) => (
        <label key={wayType} className="flex items-center gap-2 font-semibold">
          <input type="checkbox" checked={selected.includes(wayType)} onChange={(event) => toggle(wayType, event.target.checked)} />
          {wayType}
        </label>
      ))}
    </div>
  </fieldset>;
}
