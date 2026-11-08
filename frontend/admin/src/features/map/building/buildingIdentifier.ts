import type { SourceProvenance } from "../../../types";

/**
 * What tells two same-named Buildings apart: the code when there is one, otherwise the OSM
 * source the record was imported from. Null when the record carries neither.
 */
export function buildingIdentifier(record: { code?: string | null; source?: SourceProvenance }): string | null {
  const code = record.code?.trim();
  if (code) return code;
  return record.source ? `OSM ${record.source.sourceType} ${record.source.sourceId}` : null;
}
