import type { Building, Location } from "../../../types";
import type { InspectorCardModel } from "../InspectorCardHUD";
import { isIndoorLocation } from "../indoorLocation/indoorLocations";

interface LocationInspectorOptions {
  location: Location;
  buildings: Building[];
  locations: Location[];
  onEditDetails: () => void;
}

export function locationInspectorModel({
  location: selectedLocation,
  buildings: currentBuildings,
  locations: currentLocations,
  onEditDetails,
}: LocationInspectorOptions) {
  const isFootprintOwner = selectedLocation.type === "Building" || selectedLocation.type === "Facility";
  const parentBuilding = selectedLocation.parentId
    ? currentBuildings.find((building) => building.id === selectedLocation.parentId)
      ?? currentLocations.find((location) => location.id === selectedLocation.parentId)
    : null;
  const locationSummary: InspectorCardModel["summary"] = [
    { label: "Code", value: selectedLocation.code },
    { label: "Type", value: selectedLocation.type },
    ...(!isFootprintOwner && !isIndoorLocation(selectedLocation) ? [{ label: "Parent building", value: selectedLocation.building || parentBuilding?.name || "—" }] : []),
    ...(!isFootprintOwner ? [{ label: "Floor", value: selectedLocation.floor || "—" }] : []),
    ...(selectedLocation.function ? [{ label: "Function", value: selectedLocation.function }] : []),
    ...(selectedLocation.keywords ? [{ label: "Keywords", value: selectedLocation.keywords }] : []),
    ...(selectedLocation.lat !== null && selectedLocation.lng !== null
      ? [{ label: "Coordinates", value: `${selectedLocation.lat.toFixed(6)}, ${selectedLocation.lng.toFixed(6)}` }]
      : []),
    { label: "Lifecycle", value: selectedLocation.status },
    ...(isFootprintOwner || !isIndoorLocation(selectedLocation)
      ? [{ label: "Spatial source", value: isFootprintOwner ? "Linked Building Footprint" : "Inherited from parent Building" }]
      : []),
  ];
  return {
    id: selectedLocation.id,
    kind: isFootprintOwner ? "building" : "campus_location",
    title: selectedLocation.name,
    domain: "Locations",
    status: isFootprintOwner
      ? "Campus Location · footprint geometry managed in Map Editor"
      : "Campus Location",
    summary: locationSummary,
    overflowActions: [
      { label: "✎ Edit Details", onSelect: onEditDetails },
    ],
  } satisfies InspectorCardModel;
}
