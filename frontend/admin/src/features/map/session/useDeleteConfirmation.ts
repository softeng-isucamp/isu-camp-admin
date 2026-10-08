import { useState } from "react";
import { services } from "../../../services/api";
import { usePasswordConfirmation } from "../../auth/PasswordConfirmation";
import type { DeleteConfirmation } from "../DeleteConfirmationModal";
import type { MapOverlay } from "./useMapOverlay";

interface UseDeleteConfirmationOptions {
  overlay: MapOverlay;
  refreshMapData: () => Promise<void>;
  onError: (message: string) => void;
  /** The confirmed record was deleted; the caller clears its selection and reports the outcome. */
  onDeleted: (deleted: DeleteConfirmation) => void;
}

/** Deleting a Building, Route Node or Pathway after confirmation. */
export function useDeleteConfirmation({ overlay, refreshMapData, onError, onDeleted }: UseDeleteConfirmationOptions) {
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const passwordConfirmation = usePasswordConfirmation();

  const confirmDelete = async () => {
    if (!deleteConfirmation || deleting) return;
    // A permanent delete is re-authenticated: the signed-in admin retypes their password.
    if (!await passwordConfirmation.confirm()) return;
    setDeleting(true);
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
      onDeleted(deleteConfirmation);
      setDeleteConfirmation(null);
      passwordConfirmation.reset();
      onError("");
    } catch (cause) {
      if (passwordConfirmation.handleRejection(cause)) return;
      onError(cause instanceof Error ? cause.message : `Failed to delete ${deleteConfirmation.name}. Retry when ready.`);
    } finally {
      setDeleting(false);
    }
  };

  const closeConfirmation = () => {
    if (deleting) return;
    setDeleteConfirmation(null);
    passwordConfirmation.reset();
  };

  return {
    deleteConfirmation,
    setDeleteConfirmation,
    confirmDelete,
    deleting,
    passwordConfirmation,
    closeConfirmation,
  };
}
