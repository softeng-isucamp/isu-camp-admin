import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { Empty } from "../../components/UI";
import { accountTypes } from "../../lib/accountType";
import type { DecisionAnalytics, SearchActivityPoint } from "../../types";
import { ChartArea } from "../dashboard/analytics/ChartCard";
import { formatBucket, formatBucketDate, formatNumber } from "../dashboard/analytics/format";
import { AXIS_TICK, INK, MUTED_MARK } from "../dashboard/analytics/palette";
import { plural } from "./ClickTip";
import { useOpenModule } from "./links";

const usersLink = (key: string) => `/users?${new URLSearchParams({ userType: key })}`;

const manilaDay = (date: string) => new Date(`${date}T12:00:00+08:00`);
const yearOf = (date: string) => manilaDay(date).toLocaleDateString("en-US", { year: "numeric", timeZone: "Asia/Manila" });
const dateWithYear = (date: string) => manilaDay(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });

/** All-time history can span several years, so its tooltip always names the year and its axis names it where the year changes. */
export const bucketTooltipLabel = (date: string, range: DecisionAnalytics["range"]) =>
  range === "all" ? `Week of ${dateWithYear(date)}` : formatBucket(date, range);
export const bucketAxisLabel = (date: string, index: number, dates: string[], range: DecisionAnalytics["range"]) =>
  range === "all" && (index === 0 || yearOf(dates[index - 1]) !== yearOf(date)) ? dateWithYear(date) : formatBucketDate(date);

type ActivityRow = SearchActivityPoint & { unattributed: number };
const UNATTRIBUTED = "Unattributed";

/** Search activity's tooltip: the bucket, each account type's searches, and the searches no account type claims. */
function ActivityTip({ point, range }: { point: ActivityRow; range: DecisionAnalytics["range"] }) {
  const { unattributed } = point;
  return (
    <div className="decision-tooltip">
      <strong>{bucketTooltipLabel(point.date, range)}</strong>
      <span>{plural(point.total, "search", "searches")}</span>
      {accountTypes.map((type) => (
        <span key={type.key} className="tip-split"><i style={{ background: type.color }} aria-hidden="true" />{type.label}: {formatNumber(point[type.key])}</span>
      ))}
      {unattributed > 0 && (
        <span className="tip-split"><i style={{ background: MUTED_MARK, opacity: 0.45 }} aria-hidden="true" />{UNATTRIBUTED}: {formatNumber(unattributed)}</span>
      )}
      {unattributed > 0 && <span className="tip-names">From deleted or unrecognised accounts.</span>}
    </div>
  );
}

/**
 * Recorded searches over time, stacked by account type: one column per day (per week for all time and for a year).
 * A search is a recorded navigation request, not a visit, an arrival or a person. The account legend opens each type's
 * accounts in User Management.
 */
export function SearchActivity({ data }: { data: DecisionAnalytics }) {
  const navigate = useOpenModule();
  const { total, byAccountType, activity } = data.searches;
  if (!total) return <Empty>No searches were recorded in this range.</Empty>;
  const perWeek = activity.bucket === "week";
  // Searches from a deleted or unrecognised account still happened: plot them in a neutral stack so a column's height is its total.
  const points: ActivityRow[] = activity.points.map((point) => ({ ...point, unattributed: Math.max(0, point.total - point.student - point.teacher - point.visitor) }));
  const unattributed = points.reduce((sum, point) => sum + point.unattributed, 0);
  return (
    <>
      <ul className="decision-legend decision-legend-links" aria-label="Account types">
        {accountTypes.map((type) => (
          <li key={type.key}>
            <button
              type="button"
              onClick={() => navigate(usersLink(type.key))}
              aria-label={`${type.label}: ${plural(byAccountType[type.key], "search", "searches")}. Open ${type.label} accounts in User Management`}
              title={`Open ${type.label} accounts in User Management`}
            >
              <i style={{ background: type.color }} aria-hidden="true" />
              {type.label}<small>{formatNumber(byAccountType[type.key])}</small>
            </button>
          </li>
        ))}
        {unattributed > 0 && (
          <li className="decision-legend-note" title="Searches from deleted or unrecognised accounts">
            <i style={{ background: MUTED_MARK, opacity: 0.45 }} aria-hidden="true" />
            {UNATTRIBUTED}<small>{formatNumber(unattributed)}</small>
          </li>
        )}
      </ul>
      <ChartArea height={252}>
        <BarChart data={points} margin={{ top: 6, right: 8, bottom: 22, left: 0 }}>
          <CartesianGrid vertical={false} stroke={INK.grid} />
          <XAxis
            dataKey="date"
            tickFormatter={(date: string, index: number) => bucketAxisLabel(date, index, points.map((point) => point.date), data.range)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: INK.grid }}
            minTickGap={18}
            label={{ value: perWeek ? "Week starting" : "Day", position: "insideBottom", offset: -12, fill: INK.muted, fontSize: 11 }}
          />
          <YAxis
            allowDecimals={false}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={formatNumber}
            label={{ value: perWeek ? "Searches per week" : "Searches per day", angle: -90, position: "insideLeft", offset: 12, fill: INK.muted, fontSize: 11, style: { textAnchor: "middle" } }}
          />
          <Tooltip cursor={{ fill: "#f3f6f4" }} content={({ active, payload }) => {
            const point = active ? (payload?.[0]?.payload as ActivityRow | undefined) : undefined;
            return point ? <ActivityTip point={point} range={data.range} /> : null;
          }} />
          {accountTypes.map((type) => (
            <Bar key={type.key} dataKey={type.key} name={type.label} stackId="searches" fill={type.color} maxBarSize={30} isAnimationActive={false} />
          ))}
          {unattributed > 0 && <Bar dataKey="unattributed" name={UNATTRIBUTED} stackId="searches" fill={MUTED_MARK} fillOpacity={0.45} maxBarSize={30} isAnimationActive={false} />}
        </BarChart>
      </ChartArea>
    </>
  );
}
