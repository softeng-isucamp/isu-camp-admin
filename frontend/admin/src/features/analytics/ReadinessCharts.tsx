import { useState } from "react";
import { Link } from "react-router-dom";
import type { DecisionAnalytics, ReadinessGap } from "../../types";
import { formatNumber } from "../dashboard/analytics/format";
import { GAP_MODULE, GAP_SHORT, gapLink, locationLink, logsLink } from "./links";
import { PlaceLinks } from "./PlaceLinks";

/** Headline count of fully ready places beside one independent bar per check; clicking a bar lists the places missing it. */
export function DirectoryReadiness({ data }: { data: DecisionAnalytics }) {
  const { readiness } = data;
  const worst = [...readiness.checks].sort((a, b) => a.complete / (a.total || 1) - b.complete / (b.total || 1))[0];
  const [selected, setSelected] = useState<ReadinessGap>(worst?.key ?? "photo");
  const active = readiness.checks.find((check) => check.key === selected);
  const share = readiness.total ? readiness.fullyReady / readiness.total : 0;
  return (
    <div className="readiness">
      <div className="readiness-headline">
        <strong className={share < 0.5 ? "bad" : undefined}>{formatNumber(readiness.fullyReady)}</strong>
        <span>of {formatNumber(readiness.total)} places are fully ready</span>
        <Link to="/locations" className="readiness-open">Open Locations ↗</Link>
      </div>
      <div className="readiness-bars" role="list">
        {readiness.checks.map((check) => {
          const ratio = check.total ? check.complete / check.total : 0;
          const missing = check.total - check.complete;
          return (
            <button
              key={check.key}
              type="button"
              role="listitem"
              className={`readiness-row${selected === check.key ? " selected" : ""}`}
              aria-pressed={selected === check.key}
              onClick={() => setSelected(check.key)}
              title={`Show the ${missing} places missing ${check.label.toLowerCase()}`}
            >
              <span className="readiness-label">{check.label}</span>
              <span className="readiness-track" aria-hidden="true">
                <i style={{ width: `${ratio * 100}%` }} />
              </span>
              <b>{formatNumber(check.complete)}<small> / {formatNumber(check.total)}</small></b>
              <em className={missing ? "gap" : "ok"}>{missing ? `${missing} missing` : "All done"}</em>
            </button>
          );
        })}
      </div>
      {active && (
        <PlaceLinks
          heading={`Missing ${active.label.toLowerCase()} (${active.missing.length})`}
          places={active.missing}
          href={(place) => gapLink(active.key, place)}
          module={GAP_MODULE[active.key]}
          empty="Every place has this."
        />
      )}
    </div>
  );
}

/** Places with gaps, most searched first: a search bar, then one tag per gap that opens where it gets fixed. */
export function PlacesNeedingAttention({ data, rangeLabel }: { data: DecisionAnalytics; rangeLabel: string }) {
  const rows = data.attention;
  if (rows.length === 0) return <p className="place-links-empty">No searched place has a gap. Nothing to fix.</p>;
  const max = Math.max(...rows.map((row) => row.searches));
  return (
    <div className="attention">
      <div className="attention-head" aria-hidden="true">
        <span>Place</span>
        <span>Searches {rangeLabel}</span>
        <span>What is missing (click to fix)</span>
      </div>
      {rows.map((row, i) => (
        <div className="attention-row" key={row.id}>
          <span className="attention-rank">{i + 1}</span>
          <Link className="attention-name" to={locationLink(row)} title={`Open ${row.name} in Locations`}>{row.name}</Link>
          <span className="attention-bar">
            <i style={{ width: `${(row.searches / max) * 100}%` }} />
            <b>{row.searches}</b>
          </span>
          <span className="attention-gaps">
            {row.gaps.map((gap) => (
              <Link key={gap} className={`gap-tag gap-${gap}`} to={gapLink(gap, row)} title={`Fix in ${GAP_MODULE[gap]}`}>
                {GAP_SHORT[gap]}
              </Link>
            ))}
          </span>
          <Link className="attention-log" to={logsLink(row)} title={`Admin changes to ${row.name} in System Logs`} aria-label={`History of ${row.name}`}>
            History
          </Link>
        </div>
      ))}
    </div>
  );
}
