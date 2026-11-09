import { useId, useState, type ReactNode } from "react";
import type { ChartCopy } from "./copy";

type Props = { copy: ChartCopy; wide?: boolean; aside?: ReactNode; children: ReactNode };

/** One graph inside a section panel: title, the chart, and an (i) button that opens the reading guide. */
export function GraphBlock({ copy, wide = false, aside, children }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className={`graph${wide ? " graph-wide" : ""}`}>
      <div className="graph-head">
        <div className="graph-title">
          <h3>{copy.title}</h3>
        </div>
        <div className="graph-aside">
          {aside}
          <button
            type="button"
            className={`graph-info${open ? " open" : ""}`}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`How to read ${copy.title}`}
            title="How to read this"
            onClick={() => setOpen((value) => !value)}
          >
            i
          </button>
        </div>
      </div>
      {open && (
        <div className="graph-help" id={panelId}>
          <p>{copy.what}</p>
          <ul>
            {copy.read.map((row) => (
              <li key={row.see}>
                <strong>{row.see}:</strong> {row.means}
                {row.action && <span className="graph-do"> {row.action}</span>}
              </li>
            ))}
          </ul>
          <p className="graph-data">Data: {copy.data}</p>
        </div>
      )}
      <div className="graph-plot">{children}</div>
    </div>
  );
}
