import { useState } from "react";

export interface MapIssue {
  id: string;
  severity: "alert" | "info";
  title: string;
  body: string;
  /** Accessible name for the issue card. */
  ariaLabel?: string;
  action?: { label: string; onClick: () => void };
}

const cardClass: Record<MapIssue["severity"], string> = {
  alert: "border-amber-300 bg-amber-50/95 text-amber-950",
  info: "border-amber-200 bg-amber-50/95 text-amber-900",
};

/** Bottom-right "N issues" pill that, only when clicked, opens a tray listing every map issue. */
export function MapIssuesTray({ issues }: { issues: MapIssue[] }) {
  const [open, setOpen] = useState(false);
  if (issues.length === 0) return null;

  const sorted = [...issues].sort((a, b) => Number(b.severity === "alert") - Number(a.severity === "alert"));
  const hasAlert = sorted[0].severity === "alert";

  return (
    <div className="relative pointer-events-auto">
      {open && (
        <div className="map-glass-panel absolute bottom-full left-0 mb-2 flex max-h-[60vh] w-80 flex-col gap-2 overflow-y-auto rounded-2xl p-3 text-xs">
          <div className="flex items-center justify-between font-extrabold text-[#191c1d]">
            <span>Issues</span>
            <button
              type="button"
              aria-label="Close issues tray"
              onClick={() => setOpen(false)}
              className="grid h-6 w-6 place-items-center rounded-full hover:bg-[#edf3ef]"
            >
              ×
            </button>
          </div>
          {sorted.map((issue) => (
            <div
              key={issue.id}
              role={issue.severity === "alert" ? "alert" : "status"}
              aria-label={issue.ariaLabel}
              className={`rounded-2xl border px-4 py-3 shadow-lg ${cardClass[issue.severity]}`}
            >
              <strong className="block">{issue.title}</strong>
              <p className="mt-1">{issue.body}</p>
              {issue.action && (
                <button type="button" onClick={issue.action.onClick} className="mt-2 rounded-full bg-[#005931] px-3 py-2 font-bold text-white">
                  {issue.action.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        aria-label={`Show map issues (${issues.length})`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-2 rounded-[24px] border border-amber-300 bg-amber-50/95 px-4 py-3 text-xs font-bold text-amber-950 shadow-lg"
      >
        {hasAlert && (
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-600" />
          </span>
        )}
        <span aria-hidden="true">⚠ {issues.length} issue{issues.length === 1 ? "" : "s"}</span>
      </button>
    </div>
  );
}
