import { useState } from "react";
import type { ActiveToolDraft, ToolType } from "./types";

type ToolDefinition = {
  id: ToolType;
  label: string;
  icon: string;
  instruction: string;
  detail: string;
};

const toolDefinitions: ToolDefinition[] = [
  {
    id: "select",
    label: "Select",
    icon: "↖",
    instruction: "Select an object to inspect",
    detail: "Click a Campus Location, Route Node, Pathway, or Local Map Feature.",
  },
  {
    id: "point",
    label: "Point Location",
    icon: "●",
    instruction: "Place a point on the campus map",
    detail: "Choose a record, then click the map to preview its position.",
  },
  {
    id: "polygon",
    label: "Building Polygon",
    icon: "▱",
    instruction: "Draw the Building footprint corner by corner",
    detail: "Plot at least three distinct points, then confirm the footprint.",
  },
  {
    id: "pathway",
    label: "Pathway",
    icon: "⌁",
    instruction: "Connect two distinct Route Nodes",
    detail: "Choose the endpoints and add intermediate Path Points where needed.",
  },
  {
    id: "local_feature",
    label: "Local Feature",
    icon: "＋",
    instruction: "Choose a Local Map Feature family",
    detail: "Feature-family drawing and validation are introduced in the Local Features flow.",
  },
];

export function getToolDefinition(toolType: ToolType): ToolDefinition {
  return toolDefinitions.find((tool) => tool.id === toolType) ?? toolDefinitions[0];
}

type ToolRailDockProps = {
  activeTool: ToolType;
  onSelectTool: (toolType: ToolType) => void;
  suspendedDrafts: ActiveToolDraft[];
  onResumeDraft: (draftId: string) => void;
  showGuidance?: boolean;
};

export function ToolRailDock({ activeTool, onSelectTool, suspendedDrafts, onResumeDraft, showGuidance = true }: ToolRailDockProps) {
  const [minimized, setMinimized] = useState(false);
  const [shelfOpen, setShelfOpen] = useState(false);
  const activeDefinition = getToolDefinition(activeTool);

  return (
    <>
      <div className="absolute left-1/2 top-4 z-[902] max-w-[calc(100%-2rem)] -translate-x-1/2">
        {minimized ? (
          <button
            type="button"
            aria-label="Expand map command dock"
            aria-expanded="false"
            onClick={() => setMinimized(false)}
            className="flex items-center gap-2 rounded-full border border-[#e1e3e4] bg-white/95 p-1.5 pr-3 text-[#3f4941] shadow-lg backdrop-blur-md"
          >
            <span className={`grid h-8 w-8 place-items-center rounded-full text-base ${activeTool === "select" ? "bg-[#edf3ef] text-[#005931]" : "bg-[#005931] text-white"}`} aria-hidden="true">
              {activeDefinition.icon}
            </span>
            <span className="text-xs font-extrabold">{activeDefinition.label}</span>
            <span aria-hidden="true">›</span>
          </button>
        ) : (
          <div role="toolbar" aria-label="Map command dock" className="flex items-center gap-1 overflow-x-auto rounded-full border border-[#e1e3e4] bg-white/95 p-1.5 shadow-lg backdrop-blur-md">
            {toolDefinitions.map((tool) => {
              const active = activeTool === tool.id;
              return (
                <button
                  key={tool.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelectTool(tool.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold transition ${active ? "bg-[#005931] text-white shadow-sm" : "text-[#3f4941] hover:bg-emerald-50"}`}
                >
                  <span aria-hidden="true">{tool.icon}</span>
                  <span>{tool.label}</span>
                </button>
              );
            })}
            <span className="mx-1 h-5 w-px shrink-0 bg-[#e1e3e4]" aria-hidden="true" />
            <button
              type="button"
              aria-label="Minimize map command dock"
              aria-expanded="true"
              title="Minimize tools"
              onClick={() => setMinimized(true)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-lg font-bold text-[#3f4941] hover:bg-[#edf3ef]"
            >
              ⚊
            </button>
          </div>
        )}
      </div>

      {activeTool !== "select" && showGuidance && (
        <div
          role="status"
          aria-label={`${activeDefinition.label} guidance`}
          className="absolute left-1/2 top-20 z-[901] flex w-[min(620px,calc(100%-2rem))] -translate-x-1/2 items-center justify-between gap-4 rounded-2xl border border-[#005931]/20 bg-[#083f2d]/95 px-5 py-3 text-white shadow-2xl backdrop-blur"
        >
          <div className="min-w-0">
            <strong className="block text-sm">{activeDefinition.instruction}</strong>
            <span className="block text-[11px] text-white/75">{activeDefinition.detail}</span>
          </div>
          <kbd className="shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-extrabold">Esc · Cancel</kbd>
        </div>
      )}

      {suspendedDrafts.length > 0 && (
        <button
          type="button"
          aria-expanded={shelfOpen}
          onClick={() => setShelfOpen((open) => !open)}
          className="absolute bottom-5 left-5 z-[902] rounded-full border border-amber-300 bg-amber-50/95 px-4 py-2 text-xs font-extrabold text-amber-900 shadow-lg"
        >
          Suspended Drafts ({suspendedDrafts.length})
        </button>
      )}

      {shelfOpen && suspendedDrafts.length > 0 && (
        <aside role="dialog" aria-label="Suspended Drafts" className="absolute bottom-16 left-5 z-[903] w-72 rounded-2xl border border-amber-200 bg-white p-4 shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-extrabold text-[#191c1d]">Suspended Drafts</h2>
            <button type="button" aria-label="Close Suspended Drafts" onClick={() => setShelfOpen(false)} className="text-lg text-[#526158]">×</button>
          </div>
          <div className="mt-3 space-y-2">
            {suspendedDrafts.map((draft) => {
              const definition = getToolDefinition(draft.toolType);
              return (
                <div key={draft.id} className="rounded-xl border border-amber-100 bg-amber-50 p-3">
                  <strong className="block text-xs text-amber-950">{definition.label} draft</strong>
                  <span className="mt-1 block text-[10px] text-amber-800">{draft.provisionalGeometry.points?.length ?? 0} provisional point{draft.provisionalGeometry.points?.length === 1 ? "" : "s"}</span>
                  <button type="button" aria-label={`Resume ${definition.label} draft`} onClick={() => { onResumeDraft(draft.id); setShelfOpen(false); }} className="mt-2 text-xs font-extrabold text-[#005931]">
                    Resume
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
      )}
    </>
  );
}

type ToolInterruptionDialogProps = {
  currentTool: Exclude<ToolType, "select">;
  requestedTool: ToolType;
  onSuspend: () => void;
  onContinue: () => void;
  onDiscard: () => void;
};

export function ToolInterruptionDialog({ currentTool, requestedTool, onSuspend, onContinue, onDiscard }: ToolInterruptionDialogProps) {
  const current = getToolDefinition(currentTool);
  const requested = getToolDefinition(requestedTool);

  return (
    <div className="absolute inset-0 z-[1100] grid place-items-center bg-[#14231b]/40 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="tool-interruption-title">
      <div className="w-full max-w-md rounded-[24px] border border-white/40 bg-white p-6 shadow-2xl">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-amber-700">Incomplete {current.label} draft</p>
        <h2 id="tool-interruption-title" className="mt-1 text-xl font-extrabold text-[#17231d]">Switch to {requested.label}?</h2>
        <p className="mt-2 text-sm leading-6 text-[#526158]">Keep this provisional geometry to resume later, continue editing it now, or discard it before switching tools.</p>
        <div className="mt-5 flex flex-col gap-2">
          <button type="button" onClick={onSuspend} className="rounded-xl bg-[#005931] px-4 py-3 text-sm font-extrabold text-white">Keep Draft for Later (Suspend)</button>
          <button type="button" onClick={onContinue} className="rounded-xl border border-[#cad5ce] px-4 py-3 text-sm font-extrabold text-[#263b30]">Continue Editing</button>
          <button type="button" onClick={onDiscard} className="rounded-xl px-4 py-2.5 text-sm font-bold text-[#a43d35]">Discard Geometry</button>
        </div>
      </div>
    </div>
  );
}
