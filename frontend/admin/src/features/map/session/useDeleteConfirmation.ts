import { useEffect, useRef, useState } from "react";
import { usePermissions } from "../../auth/usePermissions";
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
  const { can } = usePermissions();
  const canDelete = can("delete");
  const allowed = useRef(canDelete);
  allowed.current = canDelete;
  const [deleteConfirmation, setConfirmation] = useState<DeleteConfirmation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const passwordConfirmation = usePasswordConfirmation();
  const currentDialog = useRef<DeleteConfirmation | null>(null);
  const dialogVersion = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    allowed.current = canDelete;
    return () => {
      dialogVersion.current += 1;
      currentDialog.current = null;
      allowed.current = false;
    };
  }, []);


  const setDeleteConfirmation = (confirmation: DeleteConfirmation | null) => {
    if (confirmation && !allowed.current) return;
    dialogVersion.current += 1;
    currentDialog.current = confirmation;
    setConfirmation(confirmation);
    passwordConfirmation.reset();
  };

  useEffect(() => {
    if (!canDelete) setDeleteConfirmation(null);
  }, [canDelete]);

  const confirmDelete = async () => {
    const requested = currentDialog.current;
    if (!allowed.current || !requested || busy.current) return;
    const version = dialogVersion.current;
    busy.current = true;
    try {
      // Confirmation can outlive the dialog or the permission that opened it.
      if (!await passwordConfirmation.confirm()) return;
      if (!allowed.current || dialogVersion.current !== version || currentDialog.current !== requested) return;
      setDeleting(true);
      if (requested.kind === "building") {
        await services.map.removeBuilding(requested.id);
        overlay.removeBuilding(requested.id);
        overlay.removeLocation(requested.id);
      } else if (requested.kind === "route_node") {
        await services.map.deleteRouteNode(requested.id);
        overlay.removeNode(requested.id);
      } else {
        await services.map.deletePathway(requested.id);
        overlay.deletePathway(requested.id);
      }
      await refreshMapData();
      onDeleted(requested);
      if (dialogVersion.current === version) setDeleteConfirmation(null);
      onError("");
    } catch (cause) {
      if (!allowed.current || dialogVersion.current !== version) return;
      if (passwordConfirmation.handleRejection(cause)) return;
      onError(cause instanceof Error ? cause.message : `Failed to delete ${requested.name}. Retry when ready.`);
    } finally {
      busy.current = false;
      setDeleting(false);
    }
  };

  const closeConfirmation = () => {
    if (deleting) return;
    setDeleteConfirmation(null);
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
