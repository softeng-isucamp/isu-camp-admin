import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from "recharts";
import { Empty } from "../../components/UI";
import { accountTypes } from "../../lib/accountType";
import type { DecisionAnalytics, DestinationType, MarkerGapRow, SearchActivityPoint } from "../../types";
import { ChartArea } from "../dashboard/analytics/ChartCard";
import { formatBucket, formatBucketDate, formatNumber, formatPercent } from "../dashboard/analytics/format";
import { ALERT, AXIS_TICK, INK, MUTED_MARK, SERIES } from "../dashboard/analytics/palette";
import { ClickTip, plural } from "./ClickTip";
import { locationsKeysLink, useOpenModule } from "./links";
import { LinkedTick, RowLabelTick, type RowLink } from "./RowLabelTick";

const usersLink = (key: string) => `/users?${new URLSearchParams({ userType: key })}`;

type ActivityRow = SearchActivityPoint & { unattributed: number };
const UNATTRIBUTED = "Unattributed";

/** Search activity's tooltip: the bucket, each account type's searches, and the searches no account type claims. */
function ActivityTip({ point, range }: { point: ActivityRow; range: DecisionAnalytics["range"] }) {
  const { unattributed } = point;
  return (
    <div className="decision-tooltip">
      <strong>{formatBucket(point.date, range)}</strong>
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
            tickFormatter={formatBucketDate}
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

const TYPE_LABELS: Record<DestinationType, { plural: string; noun: string }> = {
  Building: { plural: "Places", noun: "places" },
  Room: { plural: "Rooms", noun: "rooms" },
  Laboratory: { plural: "Laboratories", noun: "laboratories" },
  Office: { plural: "Offices", noun: "offices" },
  Restroom: { plural: "Restrooms", noun: "restrooms" },
};

type GapRow = MarkerGapRow & { marked: number; label: string };

/** What a missing marker means for one type, in the User App's terms. */
const markerNote = (row: MarkerGapRow) => {
  if (!row.withoutMarker) return undefined;
  if (row.type === "Building") return "These places are not on the User App's map, so people cannot be shown or routed to them.";
  // An indoor Location with no point of its own is still found, shown and routed to at its building.
  return row.notOnMap
    ? `The app still opens these at their building; ${plural(row.notOnMap, "search", "searches")} also have no mapped building.`
    : "The app still opens these at their building; only the exact spot is missing.";
};

/**
 * For each destination type: the searches in the range and how many were for a destination with no map marker, as
 * counts and a share. The red part opens Locations narrowed to the searched destinations with no marker, the blue part
 * to those that have one. A missing indoor marker is not a missing building: the app falls back to the parent building.
 */
export function SearchesWithoutMarkers({ data }: { data: DecisionAnalytics }) {
  const navigate = useOpenModule();
  const { markerGap } = data.searches;
  if (!markerGap.some((row) => row.searches)) return <Empty>No searches for active destinations were recorded in this range.</Empty>;
  const rows: GapRow[] = markerGap
    .map((row) => ({ ...row, marked: row.searches - row.withoutMarker, label: TYPE_LABELS[row.type].plural }))
    .sort((a, b) => b.withoutMarker - a.withoutMarker || b.searches - a.searches);
  const widest = Math.max(...rows.map((row) => row.searches), 1);
  const openMissing = (row: GapRow) => navigate(locationsKeysLink(row.type, row.missing, `${row.label} searched, no marker`));
  const openHave = (row: GapRow) => navigate(locationsKeysLink(row.type, row.have, `${row.label} searched, with a marker`));
  const fromBar = (entry: unknown) => (entry as { payload?: GapRow } | undefined)?.payload;
  // Keyboard access to both groups: the row label opens the ones with no marker (or, when every searched one has a marker,
  // those), and a row that has both also makes its count label a link to the ones that have a marker.
  const linkMissing = (row: GapRow): RowLink => ({ label: `${row.label}: list the ${row.missing.length} searched ${TYPE_LABELS[row.type].noun} with no marker in Locations`, open: () => openMissing(row) });
  const linkHave = (row: GapRow): RowLink => ({ label: `${row.label}: list the ${row.have.length} searched ${TYPE_LABELS[row.type].noun} with a marker in Locations`, open: () => openHave(row) });
  const links: RowLink[] = rows.map((row) => (row.missing.length ? linkMissing(row) : row.have.length ? linkHave(row) : undefined));
  const countLinks: RowLink[] = rows.map((row) => (row.missing.length && row.have.length ? linkHave(row) : undefined));
  return (
    <>
      <div className="decision-legend" aria-label="Legend">
        <span><i style={{ background: ALERT }} /> No marker</span>
        <span><i style={{ background: SERIES.blue }} /> Has a marker</span>
      </div>
      <ChartArea height={252}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 8, bottom: 22, left: 0 }} barCategoryGap="26%">
          <CartesianGrid horizontal={false} stroke={INK.grid} />
          <XAxis
            type="number"
            domain={[0, widest]}
            allowDecimals={false}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: INK.grid }}
            label={{ value: "Searches", position: "insideBottom", offset: -12, fill: INK.muted, fontSize: 11 }}
          />
          <YAxis yAxisId="types" type="category" dataKey="label" tick={<RowLabelTick links={links} />} tickLine={false} axisLine={{ stroke: INK.grid }} width={96} interval={0} />
          {/* Right-hand axis carries "N of M" so both counts show even on a row with no red part. */}
          <YAxis
            yAxisId="counts"
            orientation="right"
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            width={112}
            interval={0}
            tick={({ x, y, index }: { x?: number | string; y?: number | string; index?: number }) => {
              const row = rows[Number(index)];
              if (!row) return <g />;
              return (
                <LinkedTick link={countLinks[Number(index)]}>
                  <text x={Number(x) + 8} y={Number(y)} dy={4} fontSize={12} fontWeight={row.withoutMarker ? 600 : 400} fill={row.withoutMarker ? ALERT : INK.muted}>
                    {row.searches ? `${row.withoutMarker} of ${row.searches} · ${formatPercent(row.withoutMarker / row.searches)}` : "no searches"}
                  </text>
                </LinkedTick>
              );
            }}
          />
          <Tooltip
            axisId="types"
            cursor={{ fill: "#f3f6f4" }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as GapRow | undefined) : undefined;
              if (!row) return null;
              return (
                <ClickTip
                  title={row.label}
                  value={row.searches
                    ? `${row.withoutMarker} of ${plural(row.searches, "search", "searches")} (${formatPercent(row.withoutMarker / row.searches)}) had no marker`
                    : "No searches in this range"}
                  note={markerNote(row)}
                  names={row.missing}
                />
              );
            }}
          />
          <Bar yAxisId="types" dataKey="withoutMarker" stackId="gap" fill={ALERT} onClick={(entry) => { const row = fromBar(entry); if (row?.missing.length) openMissing(row); }} isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.type} cursor={row.missing.length ? "pointer" : "default"} />)}
          </Bar>
          <Bar yAxisId="types" dataKey="marked" stackId="gap" fill={SERIES.blue} radius={[0, 4, 4, 0]} onClick={(entry) => { const row = fromBar(entry); if (row?.have.length) openHave(row); }} isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.type} cursor={row.have.length ? "pointer" : "default"} />)}
          </Bar>
        </BarChart>
      </ChartArea>
    </>
  );
}
