import { Button, Modal } from "../../components/UI";
import { PasswordConfirmationField, type PasswordConfirmation } from "../auth/PasswordConfirmation";
import type { DeleteImpact } from "./routeNode/routeNodeLifecycle";

export interface DeleteConfirmation {
  kind: "building" | "route_node" | "pathway";
  id: string;
  name: string;
  impact?: DeleteImpact;
}

interface DeleteConfirmationModalProps {
  confirmation: DeleteConfirmation;
  error: string;
  /** The delete is in flight: the confirm button reports progress and the dialog stays open. */
  deleting?: boolean;
  /** Re-authentication state for the password this delete requires. */
  passwordConfirmation: PasswordConfirmation;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteConfirmationModal({
  confirmation: deleteConfirmation,
  error,
  deleting = false,
  passwordConfirmation,
  onConfirm: confirmDelete,
  onClose,
}: DeleteConfirmationModalProps) {
  const busy = deleting || passwordConfirmation.confirming;
  const recordLabel = deleteConfirmation.kind === "building"
    ? "Building"
    : deleteConfirmation.kind === "route_node" ? "Route Node" : "Pathway";
  return (
    <Modal
      title={`Delete ${deleteConfirmation.kind === "building" ? "Building" : deleteConfirmation.kind === "route_node" ? "Route Node" : "Pathway"}?`}
      subtitle="This is a permanent hard delete and cannot be undone."
      size="sm"
      variant="danger"
      onClose={() => onClose()}
    >
      <div className="space-y-2 text-xs text-[#3f4941]" role="document">
        <p><strong>{deleteConfirmation.name}</strong> will be permanently removed.</p>
        {deleteConfirmation.kind === "building" && <p className="text-red-700">The Building record and all associated Indoor Locations are permanently removed.</p>}
        {deleteConfirmation.kind === "route_node" && <><p><strong>Connected Pathways:</strong> {deleteConfirmation.impact?.connectedPathways.length ? deleteConfirmation.impact.connectedPathways.map((pathway) => pathway.name).join(", ") : "None"}</p><p className="text-red-700">Connected Pathways and their Path Points are removed by the existing delete cascade in the same transaction.</p></>}
        {deleteConfirmation.kind === "pathway" && <p className="text-red-700">This Pathway and its {deleteConfirmation.impact?.connectedPathways[0]?.pathPoints.length ?? 0} Path Point(s) are permanently removed.</p>}
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-2 text-red-700">{error}</div>}
      </div>
      <PasswordConfirmationField
        confirmation={passwordConfirmation}
        disabled={deleting}
        onSubmit={confirmDelete}
      />
      <div className="modal-actions">
        <Button variant="subtle" disabled={busy} onClick={() => onClose()}>Cancel</Button>
        <Button
          variant="danger"
          loading={busy}
          onClick={confirmDelete}
        >
          {deleting ? "Deleting\u2026" : passwordConfirmation.confirming ? "Confirming\u2026" : `Delete ${recordLabel}`}
        </Button>
      </div>
    </Modal>
  );
}
