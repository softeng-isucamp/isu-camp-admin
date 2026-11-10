import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from "recharts";
import { Empty } from "../../components/UI";
import type { DecisionAnalytics, IndoorMarkerRow } from "../../types";
import { ChartArea } from "../dashboard/analytics/ChartCard";
import { formatPercent } from "../dashboard/analytics/format";
import { ALERT, AXIS_TICK, INK, SERIES } from "../dashboard/analytics/palette";
import { ClickTip, plural } from "./ClickTip";
import { locationsKeysLink, locationsListLink, useOpenModule } from "./links";
import { LinkedTick, RowLabelTick, type RowLink } from "./RowLabelTick";

type Row = DecisionAnalytics["readiness"]["checks"][number] & { missingCount: number };

/**
 * The directory's gaps, ranked: one bar per check, the red part is the places missing it and the pale part is the places
 * that have it, so the bar's full length is how many places the check applies to (Indoor locations asks fewer places than the
 * rest). There is deliberately no "fully ready" total: it would weigh a missing photo and a missing entrance the same.
 * The red part opens Locations narrowed to the places missing it, the pale part to the places that have it; a part the
 * server sent no list for is not clickable.
 */
export function MissingDetails({ data }: { data: DecisionAnalytics }) {
  const navigate = useOpenModule();
  const { checks } = data.readiness;
  if (!checks.some((check) => check.total)) return <Empty>No active places to check yet.</Empty>;
  const rows: Row[] = checks
    .map((check) => ({ ...check, missingCount: check.total - check.complete }))
    .sort((a, b) => b.missingCount - a.missingCount || b.total - a.total || a.label.localeCompare(b.label));
  const widest = Math.max(...rows.map((row) => row.total), 1);
  const openMissing = (row: Row) => navigate(locationsListLink(row.missing, `Missing ${row.label.toLowerCase()}`));
  const openHave = (row: Row) => row.have && navigate(locationsListLink(row.have, `With ${row.label.toLowerCase()}`));
  const fromBar = (entry: unknown) => (entry as { payload?: Row } | undefined)?.payload;
  // Keyboard access to both halves: the row label opens the places missing it (or, when none are, those that have it), and a
  // row with both also makes its count label a link to the places that have it.
  const linkMissing = (row: Row): RowLink => ({ label: `${row.label}: list the ${row.missing.length} places missing it in Locations`, open: () => openMissing(row) });
  const linkHave = (row: Row): RowLink => ({ label: `${row.label}: list the ${row.have?.length ?? 0} places that have it in Locations`, open: () => openHave(row) });
  const links: RowLink[] = rows.map((row) => (row.missing.length ? linkMissing(row) : row.have?.length ? linkHave(row) : undefined));
  const countLinks: RowLink[] = rows.map((row) => (row.missing.length && row.have?.length ? linkHave(row) : undefined));
  return (
    <>
      <div className="decision-legend" aria-label="Legend">
        <span><i style={{ background: ALERT }} /> Missing it</span>
        <span><i style={{ background: SERIES.blue, opacity: 0.3 }} /> Has it</span>
      </div>
      <ChartArea height={262}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 8, bottom: 22, left: 0 }} barCategoryGap="26%">
          <CartesianGrid horizontal={false} stroke={INK.grid} />
          <XAxis
            type="number"
            domain={[0, widest]}
            allowDecimals={false}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: INK.grid }}
            label={{ value: "Places the check applies to", position: "insideBottom", offset: -12, fill: INK.muted, fontSize: 11 }}
          />
          <YAxis yAxisId="checks" type="category" dataKey="label" tick={<RowLabelTick links={links} />} tickLine={false} axisLine={{ stroke: INK.grid }} width={118} interval={0} />
          {/* Right-hand axis carries the "N of M missing" labels: a zero-width bar renders no label, so they cannot ride on the bars. */}
          <YAxis
            yAxisId="gaps"
            orientation="right"
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            width={132}
            interval={0}
            tick={({ x, y, index }: { x?: number | string; y?: number | string; index?: number }) => {
              const row = rows[Number(index)];
              if (!row) return <g />;
              return (
                <LinkedTick link={countLinks[Number(index)]}>
                  <text x={Number(x) + 8} y={Number(y)} dy={4} fontSize={12} fontWeight={row.missingCount ? 600 : 400} fill={row.missingCount ? ALERT : INK.muted}>
                    {row.missingCount ? `${row.missingCount} of ${row.total} missing` : `none of ${row.total} missing`}
                  </text>
                </LinkedTick>
              );
            }}
          />
          {/* Two Y axes and no axis 0: without axisId the tooltip falls back to a default axis and snaps to the wrong rows. */}
          <Tooltip
            axisId="checks"
            cursor={{ fill: "#f3f6f4" }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
              if (!row) return null;
              return (
                <ClickTip
                  title={row.label}
                  value={`${row.missingCount} of ${plural(row.total, "place")} missing it (${formatPercent(row.total ? row.missingCount / row.total : 0)})`}
                  names={row.missing}
                />
              );
            }}
          />
          <Bar yAxisId="checks" dataKey="missingCount" stackId="r" fill={ALERT} onClick={(entry) => { const row = fromBar(entry); if (row?.missing.length) openMissing(row); }} isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.key} cursor={row.missing.length ? "pointer" : "default"} />)}
          </Bar>
          <Bar yAxisId="checks" dataKey="complete" stackId="r" fill={SERIES.blue} fillOpacity={0.3} radius={[0, 4, 4, 0]} onClick={(entry) => { const row = fromBar(entry); if (row?.have?.length) openHave(row); }} isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.key} cursor={row.have?.length ? "pointer" : "default"} />)}
          </Bar>
        </BarChart>
      </ChartArea>
    </>
  );
}

const TYPE_LABELS: Record<IndoorMarkerRow["type"], { plural: string; noun: string }> = {
  Room: { plural: "Rooms", noun: "rooms" },
  Laboratory: { plural: "Laboratories", noun: "laboratories" },
  Office: { plural: "Offices", noun: "offices" },
  Restroom: { plural: "Restrooms", noun: "restrooms" },
};

type MarkerRow = IndoorMarkerRow & { unmarked: number; label: string };

/**
 * Every active indoor location with and without a map marker of its own, by type, whether or not anyone searched for it.
 * The red part opens Locations narrowed to the locations missing a marker, the blue part to those that have one. A
 * missing marker is not a missing building: the User App still opens the location at its building.
 */
export function IndoorMarkerCoverage({ data }: { data: DecisionAnalytics }) {
  const navigate = useOpenModule();
  const { indoorMarkers } = data.readiness;
  if (!indoorMarkers.some((row) => row.total)) return <Empty>No active indoor locations yet.</Empty>;
  const rows: MarkerRow[] = indoorMarkers
    .map((row) => ({ ...row, unmarked: row.total - row.marked, label: TYPE_LABELS[row.type].plural }))
    .sort((a, b) => b.unmarked - a.unmarked || b.total - a.total || a.label.localeCompare(b.label));
  const widest = Math.max(...rows.map((row) => row.total), 1);
  const openMissing = (row: MarkerRow) => navigate(locationsKeysLink(row.type, row.missing, `${row.label} with no marker`));
  const openHave = (row: MarkerRow) => navigate(locationsKeysLink(row.type, row.have, `${row.label} with a marker`));
  const fromBar = (entry: unknown) => (entry as { payload?: MarkerRow } | undefined)?.payload;
  // Keyboard access to both parts: the row label opens the ones with no marker (or, when all have one, those), and a row
  // with both also makes its count label a link to the ones that have a marker.
  const linkMissing = (row: MarkerRow): RowLink => ({ label: `${row.label}: list the ${row.missing.length} ${TYPE_LABELS[row.type].noun} with no marker in Locations`, open: () => openMissing(row) });
  const linkHave = (row: MarkerRow): RowLink => ({ label: `${row.label}: list the ${row.have.length} ${TYPE_LABELS[row.type].noun} with a marker in Locations`, open: () => openHave(row) });
  const links: RowLink[] = rows.map((row) => (row.missing.length ? linkMissing(row) : row.have.length ? linkHave(row) : undefined));
  const countLinks: RowLink[] = rows.map((row) => (row.missing.length && row.have.length ? linkHave(row) : undefined));
  return (
    <>
      <div className="decision-legend" aria-label="Legend">
        <span><i style={{ background: ALERT }} /> No marker</span>
        <span><i style={{ background: SERIES.blue }} /> Has a marker</span>
      </div>
      <ChartArea height={240}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 8, bottom: 22, left: 0 }} barCategoryGap="26%">
          <CartesianGrid horizontal={false} stroke={INK.grid} />
          <XAxis
            type="number"
            domain={[0, widest]}
            allowDecimals={false}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: INK.grid }}
            label={{ value: "Active indoor locations", position: "insideBottom", offset: -12, fill: INK.muted, fontSize: 11 }}
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
                  <text x={Number(x) + 8} y={Number(y)} dy={4} fontSize={12} fontWeight={row.unmarked ? 600 : 400} fill={row.unmarked ? ALERT : INK.muted}>
                    {row.total ? `${row.unmarked} of ${row.total} · ${formatPercent(row.unmarked / row.total)}` : "none yet"}
                  </text>
                </LinkedTick>
              );
            }}
          />
          <Tooltip
            axisId="types"
            cursor={{ fill: "#f3f6f4" }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as MarkerRow | undefined) : undefined;
              if (!row) return null;
              return (
                <ClickTip
                  title={row.label}
                  value={row.total
                    ? `${row.unmarked} of ${plural(row.total, "active location", "active locations")} (${formatPercent(row.unmarked / row.total)}) have no marker`
                    : "No active locations of this type"}
                  note={row.unmarked ? "The app still opens these at their building; only the exact spot is missing." : undefined}
                  names={row.missing}
                />
              );
            }}
          />
          <Bar yAxisId="types" dataKey="unmarked" stackId="markers" fill={ALERT} onClick={(entry) => { const row = fromBar(entry); if (row?.missing.length) openMissing(row); }} isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.type} cursor={row.missing.length ? "pointer" : "default"} />)}
          </Bar>
          <Bar yAxisId="types" dataKey="marked" stackId="markers" fill={SERIES.blue} radius={[0, 4, 4, 0]} onClick={(entry) => { const row = fromBar(entry); if (row?.have.length) openHave(row); }} isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.type} cursor={row.have.length ? "pointer" : "default"} />)}
          </Bar>
        </BarChart>
      </ChartArea>
    </>
  );
}
