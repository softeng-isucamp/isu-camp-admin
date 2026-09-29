import type { Building, Location } from "../../../types";

/**
 * The Location the details modal edits: the selected Location, or the
 * Location record derived from the selected Building.
 */
export function locationDetailsEntity(
  selectedLocation: Location | undefined,
  selectedBuilding: Building | undefined,
  selectedBuildingLocation: Location | undefined,
): Location | null {
  if (selectedLocation) return selectedLocation;
  if (!selectedBuilding) return null;
  return {
    id: selectedBuildingLocation?.id ?? selectedBuilding.id,
    name: selectedBuilding.name,
    code: selectedBuilding.code,
    type: selectedBuilding.type ?? selectedBuildingLocation?.type ?? "Building",
    parentId: null,
    function: selectedBuildingLocation?.function ?? "Campus Building",
    keywords: selectedBuildingLocation?.keywords ?? "",
    status: selectedBuildingLocation?.status ?? selectedBuilding.status ?? "Active",
    lat: selectedBuildingLocation?.lat ?? null,
    lng: selectedBuildingLocation?.lng ?? null,
    positioned: selectedBuildingLocation?.positioned ?? (selectedBuildingLocation?.lat != null && selectedBuildingLocation?.lng != null),
    hasPhoto: selectedBuildingLocation?.hasPhoto,
    photo: selectedBuildingLocation?.photo,
  };
}
