import type { Location } from "../../types";
import { BuildingPicker } from "./BuildingPicker";

interface ParentBuildingFieldProps {
  buildings: Location[];
  /** The selected Building ID, or null for None / Standalone. */
  value: string | null;
  disabled?: boolean;
  error?: string;
  onChange: (building: Location | null) => void;
}

/** Picking the parent Building of an indoor Location: the shared Building picker with the required parent wording. */
export function ParentBuildingField(props: ParentBuildingFieldProps) {
  return (
    <BuildingPicker
      {...props}
      label="PARENT BUILDING"
      required
      noneLabel="None / Standalone"
      clearLabel="Clear parent building"
    />
  );
}
