import { useEffect, useMemo, useRef, useState } from "react";
import { MAP_ISSUE_GROUPS, type MapIssue } from "./session/mapIssues";

interface MapIssuesTrayProps {
  issues: MapIssue[];
  /** The issue the map was last focused on; its row is highlighted and scrolled into view. */
  activeIssueId: string | null;
  /** Flies the map to the issue and selects its object. Never changes data. */
  onFocusIssue: (issue: MapIssue) => void;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3.5l4.5 4.5L6 12.5" />
    </svg>
  );
}

function LocateIcon() {
  return (
    <span role="img" aria-label="Locate" className="flex shrink-0 items-center text-[#005931]">
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="8" cy="8" r="2.2" />
        <path d="M8 1.5v2.3M8 12.2v2.3M1.5 8h2.3M12.2 8h2.3" />
      </svg>
    </span>
  );
}

/**
 * Bottom-left "N issues" pill that, only when clicked, opens a tray listing one row per
 * affected object under collapsible groups. A row focuses the object; a fix is a separate button.
 *
 * Renders into the editor's bottom-left grid: the tray fills row 1 above the legend, and the pill
 * sits in row 2 beside the legend (column 2).
 */
export function MapIssuesTray({ issues, activeIssueId, onFocusIssue }: MapIssuesTrayProps) {
  const [open, setOpen] = useState(false);
  // Explicit user toggles; groups without an entry start open for alerts and closed for info.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const activeRow = useRef<HTMLLIElement | null>(null);

  const groups = useMemo(() => MAP_ISSUE_GROUPS
    .map((group) => ({ ...group, issues: issues.filter((issue) => issue.kind === group.kind) }))
    .filter((group) => group.issues.length > 0), [issues]);
  const activeKind = issues.find((issue) => issue.id === activeIssueId)?.kind;
  const isExpanded = (group: (typeof groups)[number]) => toggled[group.kind] ?? (group.severity === "alert" || group.kind === activeKind);

  useEffect(() => {
    if (open && activeIssueId) activeRow.current?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIssueId, toggled]);

  if (issues.length === 0) return null;
  const hasAlert = groups.some((group) => group.severity === "alert");

  return (
    <>
      {open && (
        <section
          aria-label="Map issues"
          className="map-glass-panel pointer-events-auto col-span-3 row-start-1 flex max-h-full min-h-0 flex-col self-end overflow-hidden rounded-2xl text-xs"
        >
          <header className="flex items-center justify-between border-b border-[#dfe8e2] px-4 py-2.5">
            <h2 className="font-extrabold text-[#191c1d]">Map issues</h2>
            <button
              type="button"
              aria-label="Close issues tray"
              onClick={() => setOpen(false)}
              className="grid h-6 w-6 place-items-center rounded-full text-base leading-none text-[#3f4941] hover:bg-[#edf3ef]"
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {groups.map((group) => {
              const expanded = isExpanded(group);
              const alert = group.severity === "alert";
              return (
                <div key={group.kind} className="mb-1 last:mb-0">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setToggled((current) => ({ ...current, [group.kind]: !expanded }))}
                    className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left font-extrabold text-[#191c1d] hover:bg-[#edf3ef]"
                  >
                    <span className={alert ? "text-amber-700" : "text-[#526359]"}><Chevron open={expanded} /></span>
                    <span className="flex-1">{group.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] tabular-nums ${alert ? "bg-amber-100 text-amber-900" : "bg-[#edf3ef] text-[#3f4941]"}`}>
                      {group.issues.length}
                    </span>
                  </button>
                  {expanded && (
                    <>
                      <p className="px-2 pb-0.5 pl-9 text-[11px] font-medium text-[#526359]">{group.note}</p>
                      <ul className="mt-1 flex flex-col gap-1 pl-2">
                        {group.issues.map((issue) => {
                          const active = issue.id === activeIssueId;
                          return (
                            <li
                              key={issue.id}
                              ref={active ? activeRow : undefined}
                              className={`flex items-center gap-1 rounded-xl border transition-colors ${
                                active
                                  ? "border-[#005931] bg-[#005931]/10 ring-1 ring-[#005931]"
                                  : alert
                                    ? "border-amber-200 bg-amber-50/80 hover:bg-amber-100/80"
                                    : "border-[#dfe8e2] bg-white/70 hover:bg-[#edf3ef]"
                              }`}
                            >
                              <button
                                type="button"
                                aria-current={active ? "true" : undefined}
                                aria-label={`${issue.title}, ${issue.detail}`}
                                onClick={() => onFocusIssue(issue)}
                                title={`${issue.title} — ${issue.detail}`}
                                className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2 text-left"
                              >
                                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                                  <strong className="min-w-0 truncate text-[#191c1d]">{issue.title}</strong>
                                  <span className="shrink-0 text-[11px] font-semibold text-[#526359]">{issue.detail}</span>
                                </span>
                                {!issue.action && <LocateIcon />}
                              </button>
                              {issue.action && (
                                <button
                                  type="button"
                                  aria-label={issue.action.label}
                                  title={issue.action.label}
                                  onClick={issue.action.onClick}
                                  className="mr-2 shrink-0 rounded-full bg-[#005931] px-2.5 py-1 text-[10px] font-bold text-white shadow hover:bg-[#00472a]"
                                >
                                  {issue.action.shortLabel ?? issue.action.label}
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
      <button
        type="button"
        aria-label={`Show map issues (${issues.length})`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="pointer-events-auto col-start-2 row-start-2 flex items-center gap-2 self-end rounded-[24px] border border-amber-300 bg-amber-50/95 px-4 py-3 text-xs font-bold text-amber-950 shadow-lg"
      >
        {hasAlert && (
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-600" />
          </span>
        )}
        <span aria-hidden="true">⚠ {issues.length} issue{issues.length === 1 ? "" : "s"}</span>
      </button>
    </>
  );
}
