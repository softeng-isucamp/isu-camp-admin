import type { Building, Location, RouteNode } from "../../types";
import { LocationDetailsModal } from "../locations/LocationDetailsModal";
import { BuildingDetailsModal } from "./building/BuildingDetailsModal";
import type { useBuildingFootprintEditing } from "./building/useBuildingFootprintEditing";
import type { PasswordConfirmation } from "../auth/PasswordConfirmation";
import { DeleteConfirmationModal, type DeleteConfirmation } from "./DeleteConfirmationModal";
import { IndoorLocationChooserModal } from "./indoorLocation/IndoorLocationChooserModal";
import { isIndoorLocation } from "./indoorLocation/indoorLocations";
import type { useIndoorLocationPlacement } from "./indoorLocation/useIndoorLocationPlacement";
import { locationDetailsEntity } from "./location/locationDetailsEntity";
import { PathPointConversionModal } from "./pathway/PathPointConversionModal";
import type { usePathwayEditing } from "./pathway/usePathwayEditing";
import type { SaveAction } from "./session/useSavingAction";

export type OwnerModal = "location" | null;

interface MapModalsProps {
  ownerModal: OwnerModal;
  error: string;
  savingAction: SaveAction | null;
  /** The selected object of each domain, whose details the owner modals edit. */
  selection: {
    building: Building | undefined;
    buildingLocation: Location | undefined;
    location: Location | undefined;
  };
  editors: {
    buildingEditor: ReturnType<typeof useBuildingFootprintEditing>;
    pathway: ReturnType<typeof usePathwayEditing>;
    indoor: ReturnType<typeof useIndoorLocationPlacement>;
  };
  data: {
    locations: Location[];
    contentLocations: Location[];
    nodes: RouteNode[];
    buildingAssociationOptions: Building[];
  };
  deletion: {
    confirmation: DeleteConfirmation | null;
    deleting: boolean;
    passwordConfirmation: PasswordConfirmation;
    onConfirm: () => void;
    onClose: () => void;
  };
  actions: {
    onCloseOwnerModal: () => void;
    onSubmitLocationDetails: (updated: Location, photos: Parameters<Parameters<typeof LocationDetailsModal>[0]["onSubmit"]>[1]) => Promise<void>;
    onPickIndoorLocationOnMap: (location: Location) => void;
    onBeginIndoorPlacement: (building: Building, location: Location) => void;
    onSavePathPointConversion: () => void;
  };
}

/** Every modal the Map Editor can open over the map. */
export function MapModals({ ownerModal, error, savingAction, selection, editors, data, deletion, actions }: MapModalsProps) {
  const { buildingEditor, pathway, indoor } = editors;
  const { building: selectedBuilding, location: selectedLocation } = selection;
  const { conversionDraft, setConversionDraft } = pathway;
  const locationModalEntity = locationDetailsEntity(selectedLocation, selectedBuilding, selection.buildingLocation);
  return (
    <>
      {buildingEditor.buildingDetailsModalOpen && buildingEditor.polygonClosed
        && !buildingEditor.editingBuildingId && (
        <BuildingDetailsModal
          draft={buildingEditor.buildingForm}
          classification={buildingEditor.buildingClassification}
          error={error}
          onChange={buildingEditor.setBuildingForm}
          onClassificationChange={buildingEditor.setBuildingClassification}
          onClose={buildingEditor.closeDetailsModal}
          onSubmit={buildingEditor.createBuilding}
          submitting={savingAction === "building"}
        />
      )}

      {ownerModal === "location" && locationModalEntity && (
        <LocationDetailsModal
          location={locationModalEntity}
          directory={data.locations}
          allowedTypes={selectedBuilding ? ["Building", "Facility"] : undefined}
          onClose={actions.onCloseOwnerModal}
          onPickIndoorLocationOnMap={selectedLocation && isIndoorLocation(selectedLocation)
            ? () => actions.onPickIndoorLocationOnMap(selectedLocation)
            : undefined}
          onSubmit={actions.onSubmitLocationDetails}
        />
      )}

      {conversionDraft && <PathPointConversionModal
        draft={conversionDraft}
        parentName={pathway.activePathway?.name ?? conversionDraft.pathwayId}
        nodes={data.nodes}
        buildings={data.buildingAssociationOptions}
        error={error}
        saving={savingAction === "path-point-conversion"}
        onClose={() => { if (savingAction !== "path-point-conversion") setConversionDraft(null); }}
        onNodeChange={(change) => setConversionDraft((draft) => draft ? { ...draft, node: { ...draft.node, ...change } } : draft)}
        onPathwayChange={pathway.updateConversionPathway}
        onSave={actions.onSavePathPointConversion}
      />}

      {indoor.chooserOpen && selectedBuilding && (
        <IndoorLocationChooserModal
          indoor={indoor}
          building={selectedBuilding}
          contentLocations={data.contentLocations}
          error={error}
          onBeginPlacement={actions.onBeginIndoorPlacement}
        />
      )}

      {deletion.confirmation && (
        <DeleteConfirmationModal
          confirmation={deletion.confirmation}
          error={error}
          deleting={deletion.deleting}
          passwordConfirmation={deletion.passwordConfirmation}
          onConfirm={deletion.onConfirm}
          onClose={deletion.onClose}
        />
      )}
    </>
  );
}
