import { Link } from "react-router-dom";
import type { DashboardAnalytics } from "../../../types";
import { ChartCard } from "./ChartCard";
import { formatNumber } from "./format";
import { SERIES } from "./palette";

const RADIUS = 52;
const STROKE = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** C1: How complete the active Buildings and indoor Locations are. Each bar opens the Locations directory. */
export function DirectoryCompleteness({ data }: { data: DashboardAnalytics | undefined }) {
  return (
    <ChartCard
      title="Directory completeness"
      subtitle="Active Buildings and indoor Locations that have a photo, description, keywords, and a map pin."
      data={data}
      isEmpty={(d) => d.completenessTotal === 0}
      emptyMessage="No active locations to check yet."
      className="analytics-wide"
    >
      {(d) => {
        const complete = d.completeness.reduce((sum, check) => sum + check.complete, 0);
        const possible = d.completeness.reduce((sum, check) => sum + check.total, 0);
        const overall = possible ? complete / possible : 0;
        return (
          <div className="completeness">
            <div className="completeness-ring">
              <svg width={144} height={144} viewBox="0 0 144 144" role="img" aria-label={`Overall directory completeness ${Math.round(overall * 100)}%`}>
                <circle cx={72} cy={72} r={RADIUS} fill="none" stroke="#eef2f0" strokeWidth={STROKE} />
                <circle
                  cx={72}
                  cy={72}
                  r={RADIUS}
                  fill="none"
                  stroke={SERIES.blue}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  strokeDasharray={`${overall * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
                  transform="rotate(-90 72 72)"
                />
                <text x={72} y={74} textAnchor="middle" fontSize={28} fontWeight={700} fill="#151a17">{Math.round(overall * 100)}%</text>
                <text x={72} y={94} textAnchor="middle" fontSize={11} fill="#64716a">{formatNumber(d.completenessTotal)} active locations</text>
              </svg>
            </div>
            <ul className="completeness-bars">
              {d.completeness.map((check) => {
                const ratio = check.total ? check.complete / check.total : 0;
                return (
                  <li key={check.key}>
                    <Link to="/locations" title={`Review ${check.label.toLowerCase()} in the Locations directory`}>
                      <span>{check.label}</span>
                      <div className="completeness-track" aria-hidden="true"><i style={{ width: `${ratio * 100}%` }} /></div>
                      <b>{Math.round(ratio * 100)}%</b>
                      <small>{formatNumber(check.complete)} / {formatNumber(check.total)}</small>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      }}
    </ChartCard>
  );
}
