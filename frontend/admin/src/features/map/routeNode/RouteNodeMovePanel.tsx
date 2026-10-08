import { Spinner } from "../../../components/UI";
import { PointCoordinateInputs } from "../PointMoveLayer";
import type { EditorMode } from "../types";
import type { SaveAction } from "../session/useSavingAction";
import type { useRouteNodePointTool } from "./useRouteNodePointTool";

interface RouteNodeMovePanelProps {
  pointTool: ReturnType<typeof useRouteNodePointTool>;
  mode: EditorMode;
  movingObjectName: string;
  movingOutsideBoundary: boolean;
  moveDistanceMeters: number;
  savingAction: SaveAction | null;
  onCancel: () => void;
  onSave: () => void;
}

export function RouteNodeMovePanel({
  pointTool,
  mode,
  movingObjectName,
  movingOutsideBoundary,
  moveDistanceMeters,
  savingAction,
  onCancel: handleCancelMove,
  onSave: handleSavePosition,
}: RouteNodeMovePanelProps) {
  if (mode !== "move" || !pointTool.position) return null;
  return (
    <section
      className={`point-move-hud${movingOutsideBoundary ? " outside-boundary" : ""}`}
      role="region"
      aria-label={`Move ${movingObjectName}`}
    >
      <div className="point-move-hud-header">
        <div>
          <span>Move Route Node</span>
          <strong>{movingObjectName}</strong>
        </div>
        <div className="point-move-distance" aria-live="polite">
          Δ {moveDistanceMeters.toFixed(1)}m {pointTool.snapped && <em>(Snapped)</em>}
        </div>
      </div>
      <PointCoordinateInputs position={pointTool.position} onChange={pointTool.updateMovePosition} />
      {movingOutsideBoundary && (
        <div className="point-move-warning" role="alert">
          Position is outside the ISU Echague Campus Boundary. Drop and save are blocked.
        </div>
      )}
      {pointTool.dropRejected && (
        <div className="point-move-warning" role="alert">
          Point drop was blocked outside the ISU Echague Campus Boundary. The marker returned to its last valid position.
        </div>
      )}
      <div className="point-move-hud-footer">
        <span>{pointTool.dragging ? "Dragging · release to preview" : "Arrow keys 0.5m · Shift + Arrow 5.0m · Enter save · Esc cancel"}</span>
        <div>
          <button type="button" onClick={handleCancelMove}>Cancel</button>
          <button type="button" className="primary" disabled={movingOutsideBoundary || savingAction === "position"} onClick={handleSavePosition}>{savingAction === "position" && <Spinner size={12} />}{savingAction === "position" ? "Saving Position…" : "Save Position"}</button>
        </div>
      </div>
    </section>
  );
}
