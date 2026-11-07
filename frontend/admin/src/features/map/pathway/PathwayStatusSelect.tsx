import { normalizePathwayLifecycleStatus, type Pathway } from "../../../types";

interface PathwayStatusSelectProps {
  /** The Pathway's status as drafted or saved; historical "Open" values read as Active. */
  value: Pathway["status"] | undefined;
  onChange: (status: Pathway["status"]) => void;
}

/**
 * The Pathway lifecycle control shared by the Pathway card and the Path Point card: Active or Closed,
 * with Unknown listed only for a record that really has no status, so the shown value is never a guess.
 */
export function PathwayStatusSelect({ value, onChange }: PathwayStatusSelectProps) {
  const status = normalizePathwayLifecycleStatus(value ?? "Active");
  return (
    <label>Status
      <select aria-label="Pathway status" value={status} onChange={(event) => onChange(event.target.value as Pathway["status"])}>
        <option>Active</option>
        <option>Closed</option>
        {status === "Unknown" && <option>Unknown</option>}
      </select>
    </label>
  );
}
