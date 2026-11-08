import { Badge } from "../../../components/UI";
import { backendLocationType, isPlace, isUnclassifiedPlace } from "../../../lib/locationPolicy";
import type { CanPerform } from "../../../lib/permissions";
import type { Building, Location } from "../../../types";
import type { InspectorCardModel } from "../InspectorCardHUD";
import { isIndoorLocation } from "../indoorLocation/indoorLocations";

interface LocationInspectorOptions {
  location: Location;
  buildings: Building[];
  locations: Location[];
  can: CanPerform;
  onEditDetails: () => void;
}

export function locationInspectorModel({
  location: selectedLocation,
  buildings: currentBuildings,
  locations: currentLocations,
  can,
  onEditDetails,
}: LocationInspectorOptions) {
  const isFootprintOwner = isPlace(selectedLocation);
  const isIndoor = isIndoorLocation(selectedLocation);
  // The parent is a Place: a Building record, or a Place Location; never a bare-id match against another Location type.
  const parentPlace = selectedLocation.parentId
    ? currentBuildings.find((building) => building.id === selectedLocation.parentId)
      ?? currentLocations.find((location) => location.id === selectedLocation.parentId && isPlace(location))
    : null;
  const placed = selectedLocation.lat !== null && selectedLocation.lng !== null;
  const typeLabel = isUnclassifiedPlace(selectedLocation) ? <Badge tone="grey">Unclassified</Badge> : backendLocationType(selectedLocation);
  const locationSummary: InspectorCardModel["summary"] = [
    ...(!isFootprintOwner ? [
      { label: "Parent building", value: parentPlace?.name || selectedLocation.building || "—" },
      { label: "Floor", value: selectedLocation.floor || "—" },
    ] : []),
    ...(isIndoor ? [{ label: "Map marker", value: placed ? "Placed" : "Not placed" }] : []),
    ...(selectedLocation.function ? [{ label: "Function", value: selectedLocation.function }] : []),
    ...(selectedLocation.keywords ? [{ label: "Keywords", value: selectedLocation.keywords }] : []),
    ...(placed ? [{ label: "Coordinates", value: `${selectedLocation.lat!.toFixed(6)}, ${selectedLocation.lng!.toFixed(6)}` }] : []),
    ...(isFootprintOwner || !isIndoor
      ? [{ label: "Spatial source", value: isFootprintOwner ? "Linked Building Footprint" : "Inherited from parent Building" }]
      : []),
  ];
  return {
    id: selectedLocation.id,
    kind: isFootprintOwner ? "building" : "campus_location",
    title: selectedLocation.name,
    domain: "Locations",
    // An indoor location is labelled as such with its type below; any other card is labelled by its own type.
    objectLabel: isIndoor ? "Indoor location" : isUnclassifiedPlace(selectedLocation) ? "Place" : backendLocationType(selectedLocation) ?? "Location",
    subtitle: (
      <>
        {(isIndoor || isUnclassifiedPlace(selectedLocation)) && <><span>{typeLabel}</span>{" · "}</>}
        <span>{selectedLocation.code}</span>{" · "}<span>{selectedLocation.status}</span>
      </>
    ),
    viewOnly: !can("edit"),
    summary: locationSummary,
    overflowActions: [
      ...(can("edit") ? [{ label: "✎ Edit Details", onSelect: onEditDetails }] : []),
    ],
  } satisfies InspectorCardModel;
}
