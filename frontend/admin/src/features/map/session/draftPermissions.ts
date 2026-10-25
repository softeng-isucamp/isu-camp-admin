import type { AdminPermissionAction } from "../../../types";
import type { ActiveToolDraft } from "../types";

/** Permission follows the operation, including drafts recovered from older journals. */
export function draftPermission(draft: Pick<ActiveToolDraft, "toolType" | "nestedRecords">): AdminPermissionAction {
  const records = draft.nestedRecords ?? {};
  if (draft.toolType === "point") return records.editorMode === "move" || (records.editorMode === undefined && typeof records.movingId === "string") ? "edit" : "add";
  if (draft.toolType === "polygon") return typeof records.editingBuildingId === "string" ? "edit" : "add";
  return typeof records.editingPathId === "string" && records.editingPathId !== records.provisionalPathwayId ? "edit" : "add";
}
