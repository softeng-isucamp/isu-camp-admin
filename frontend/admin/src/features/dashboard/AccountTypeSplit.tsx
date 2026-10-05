import { accountTypes } from "../../lib/accountType";
import type { UserAccountType } from "../../types";

const RADIUS = 46;
const STROKE = 16;
const GAP = 3;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const percent = (count: number, total: number) => (total ? Math.round((count / total) * 100) : 0);

type Props = {
  total: number | null;
  counts: Record<UserAccountType, number> | null;
  onSelect: (type: UserAccountType) => void;
};

/** Donut and legend of all-time accounts by type. `counts` is null when the backend omits the split. */
export function AccountTypeSplit({ total, counts, onSelect }: Props) {
  const sum = counts ? counts.student + counts.teacher + counts.visitor : 0;
  let offset = 0;
  return (
    <div className="account-type-split">
      <svg width={120} height={120} viewBox="0 0 120 120" role="img" aria-label="Registered users by account type">
        <circle cx={60} cy={60} r={RADIUS} fill="none" stroke="#eef2f0" strokeWidth={STROKE} />
        {counts && sum > 0 && (
          <g transform="rotate(-90 60 60)">
            {accountTypes.map((type) => {
              const length = (counts[type.key] / sum) * CIRCUMFERENCE;
              const start = offset;
              offset += length;
              if (counts[type.key] === 0) return null;
              return (
                <circle
                  key={type.key}
                  className="account-type-slice"
                  cx={60}
                  cy={60}
                  r={RADIUS}
                  fill="none"
                  stroke={type.color}
                  strokeWidth={STROKE}
                  strokeDasharray={`${Math.max(length - GAP, 0.5)} ${CIRCUMFERENCE}`}
                  strokeDashoffset={-start}
                  onClick={() => onSelect(type.key)}
                >
                  <title>{`${type.label}: ${counts[type.key]} (${percent(counts[type.key], sum)}%)`}</title>
                </circle>
              );
            })}
          </g>
        )}
        <text x={60} y={58} textAnchor="middle" fontSize={24} fontWeight={700} fill="#151a17">{total?.toLocaleString() ?? "—"}</text>
        <text x={60} y={76} textAnchor="middle" fontSize={11} fill="#64716a">users</text>
      </svg>
      <ul className="account-type-legend">
        {accountTypes.map((type) => (
          <li key={type.key}>
            <button type="button" onClick={() => onSelect(type.key)} aria-label={`View ${type.label} accounts`}>
              <i style={{ background: type.color }} aria-hidden="true" />
              <span>{type.label}</span>
              <b>{counts ? `${percent(counts[type.key], sum)}%` : "—"}</b>
              <small>{counts ? counts[type.key].toLocaleString() : "—"}</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
