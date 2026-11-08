import { useId, useState, type ReactNode } from "react";
import { Card } from "../../../../components/UI";
import type { ChartCopy } from "./decisionCopy";

type Props = { rank: number; copy: ChartCopy; best: boolean; expandAll?: boolean; children: ReactNode };

/** One decision chart: rank, title, the decision it supports, the chart, and a collapsed "How to read this" panel. */
export function DecisionCard({ rank, copy, best, children }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <Card className={`analytics-card decision-card${best ? " decision-best" : ""}`}>
      <div className="card-heading">
        <div>
          <span className="decision-rank">#{rank}</span>
          <h2>{copy.title}</h2>
          <p className="decision-question"><strong>Decision:</strong> {copy.decision}</p>
        </div>
      </div>
      <div className="decision-chart">{children}</div>
      <button
        type="button"
        className="decision-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span> How to read this
      </button>
      {open && (
        <div className="decision-help" id={panelId}>
          <h3>What it shows</h3>
          <p>{copy.what}</p>
          <h3>How to read it</h3>
          <ul>
            {copy.read.map((row) => (
              <li key={row.see}>
                <strong>{row.see}:</strong> {row.means}
                {row.action && <span className="decision-do"> Do: {row.action}</span>}
              </li>
            ))}
          </ul>
          <div className="decision-pills">
            {copy.pills.map((pill) => <span key={pill.text} className={`decision-pill ${pill.tone}`}>{pill.text}</span>)}
          </div>
          <p className="decision-data">Data: {copy.data}</p>
        </div>
      )}
    </Card>
  );
}
