import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from "recharts";
import type { DecisionAnalytics } from "../../types";
import { ChartArea } from "../dashboard/analytics/ChartCard";
import { AXIS_TICK, ALERT, INK, SERIES } from "../dashboard/analytics/palette";
import { ClickTip } from "./ClickTip";
import { locationsListLink, useOpenModule } from "./links";
import { RowLabelTick, type RowLink } from "./RowLabelTick";

type Row = DecisionAnalytics["readiness"]["checks"][number] & { missingCount: number };

/**
 * Fully-ready count beside one bar per check, in two halves. The blue half opens Locations narrowed to the places that
 * have it, the red half to the places missing it; a half the server sent no list for is not clickable.
 */
export function DirectoryReadiness({ data }: { data: DecisionAnalytics }) {
  const navigate = useOpenModule();
  const { readiness } = data;
  const rows: Row[] = readiness.checks.map((check) => ({ ...check, missingCount: check.total - check.complete }));
  const openRow = (row: Row) => navigate(locationsListLink(row.missing, `Missing ${row.label.toLowerCase()}`));
  const openHave = (entry: unknown) => {
    const row = (entry as { payload?: Row } | undefined)?.payload;
    if (row?.have?.length) navigate(locationsListLink(row.have, `With ${row.label.toLowerCase()}`));
  };
  const openMissing = (entry: unknown) => {
    const row = (entry as { payload?: Row } | undefined)?.payload;
    if (row && row.missing.length) openRow(row);
  };
  const links: RowLink[] = rows.map((row) =>
    row.missing.length ? { label: `${row.label}: list the ${row.missing.length} missing it in Locations`, open: () => openRow(row) } : undefined);
  return (
    <div className="readiness">
      <button
        type="button"
        className="readiness-headline"
        onClick={() => navigate("/locations")}
        title="Open Locations"
      >
        <strong className={readiness.fullyReady < readiness.total / 2 ? "bad" : undefined}>{readiness.fullyReady}</strong>
        <span>/ {readiness.total} fully ready</span>
      </button>
      <ChartArea height={262}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 0 }} barCategoryGap="26%">
          <CartesianGrid horizontal={false} stroke={INK.grid} />
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis yAxisId="checks" type="category" dataKey="label" tick={<RowLabelTick links={links} />} tickLine={false} axisLine={{ stroke: INK.grid }} width={128} interval={0} />
          {/* Right-hand axis carries the "N missing" labels: a zero-width bar renders no label, so they cannot ride on the bars. */}
          <YAxis
            yAxisId="gaps"
            orientation="right"
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            width={92}
            interval={0}
            tick={({ x, y, index }: { x?: number | string; y?: number | string; index?: number }) => {
              const row = rows[Number(index)];
              if (!row) return <g />;
              return (
                <text x={Number(x) + 8} y={Number(y)} dy={4} fontSize={12} fontWeight={600} fill={row.missingCount ? ALERT : INK.muted}>
                  {row.missingCount ? `${row.missingCount} missing` : "done"}
                </text>
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
                  value={`${row.complete} of ${row.total} have it · ${row.missingCount} missing`}
                />
              );
            }}
          />
          <Bar yAxisId="checks" dataKey="complete" stackId="r" fill={SERIES.blue} onClick={openHave} isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.key} cursor={row.have?.length ? "pointer" : "default"} />)}
          </Bar>
          <Bar yAxisId="checks" dataKey="missingCount" stackId="r" fill={ALERT} fillOpacity={0.22} radius={[0, 4, 4, 0]} onClick={openMissing} isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.key} cursor={row.missing.length ? "pointer" : "default"} />)}
          </Bar>
        </BarChart>
      </ChartArea>
    </div>
  );
}
