import { useState } from "react";
import { services } from "../../../services/api";
import type { DeleteConfirmation } from "../DeleteConfirmationModal";
import type { MapOverlay } from "./useMapOverlay";

interface UseDeleteConfirmationOptions {
  overlay: MapOverlay;
  refreshMapData: () => Promise<void>;
  onError: (message: string) => void;
  /** The confirmed record was deleted; the caller clears its selection. */
  onDeleted: () => void;
}

/** Deleting a Building, Route Node or Pathway after confirmation. */
export function useDeleteConfirmation({ overlay, refreshMapData, onError, onDeleted }: UseDeleteConfirmationOptions) {
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null);

  const confirmDelete = async () => {
    if (!deleteConfirmation) return;
    try {
      if (deleteConfirmation.kind === "building") {
        await services.map.removeBuilding(deleteConfirmation.id);
        overlay.removeBuilding(deleteConfirmation.id);
        overlay.removeLocation(deleteConfirmation.id);
      } else if (deleteConfirmation.kind === "route_node") {
        await services.map.deleteRouteNode(deleteConfirmation.id);
        overlay.removeNode(deleteConfirmation.id);
      } else {
        await services.map.deletePathway(deleteConfirmation.id);
        overlay.deletePathway(deleteConfirmation.id);
      }
      await refreshMapData();
      onDeleted();
      setDeleteConfirmation(null);
      onError("");
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : `Failed to delete ${deleteConfirmation.name}. Retry when ready.`);
    }
  };

  return { deleteConfirmation, setDeleteConfirmation, confirmDelete };
}
