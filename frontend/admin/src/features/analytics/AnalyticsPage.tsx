import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Button, Card, Empty, ProgressBar, Spinner } from "../../components/UI";
import { services, USE_HTTP_API } from "../../services/api";
import { errorMessage } from "../../services/errors";
import type { DashboardRange } from "../../types";
import { RangeSelect, rangeLabel } from "../dashboard/RangeSelect";
import { COPY } from "./copy";
import { GraphBlock } from "./GraphBlock";
import { ClosureImpact, TravelModeReach } from "./NetworkCharts";
import { MissingDetails } from "./ReadinessCharts";
import { SearchActivity, SearchesWithoutMarkers } from "./SearchCharts";

/** Readiness, closures and reach describe the map as it is now; only the searches follow the range picker. */
const SNAPSHOT_NOTE = "Current snapshot";

export const decisionAnalyticsQueryKey = (range: DashboardRange) => ["decision-analytics", range] as const;


function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="decision-group" aria-labelledby={`analytics-${id}`}>
      <div className="decision-group-head">
        <h2 id={`analytics-${id}`}>{title}</h2>
        {note && <span className={`decision-tag${note === SNAPSHOT_NOTE ? " decision-tag-snapshot" : ""}`}>{note}</span>}
      </div>
      <div className="graph-panel">{children}</div>
    </section>
  );
}

/**
 * The Analytics page, ordered the way an admin reads it: is the directory ready,
 * can people get there, then who is searching for what. Every bar and slice
 * opens the module where that thing gets fixed.
 */
export function AnalyticsPage() {
  const [range, setRange] = useState<DashboardRange>("week");
  const { data, error, isFetching, isLoading, refetch } = useQuery({
    queryKey: decisionAnalyticsQueryKey(range),
    queryFn: () => services.dashboard.decisionAnalytics(range),
    placeholderData: (previous) => previous,
    retry: false,
  });
  // Label what is on screen: while another range loads, the previous range's numbers stay up.
  const rangeText = rangeLabel(data ? data.range : range);

  return (
    <div className="page analytics-page">
      <section className="hero">
        <div>
          <p className="eyebrow">KUMPAS ADMIN</p>
          <h1>Analytics</h1>
          {!USE_HTTP_API && <p>Sample data (local mode).</p>}
        </div>
        <RangeSelect value={range} onChange={setRange} firstYear={data?.firstAnalyticsYear} disabled={isFetching} label="Search time range" />
      </section>
      <ProgressBar active={isFetching && !isLoading} />
      {error && !data ? (
        <Card className="analytics-unavailable" role="alert">
          <Empty>{errorMessage(error, "Analytics couldn't be loaded. Please try again.")}</Empty>
          <Button type="button" variant="subtle" loading={isFetching} onClick={() => void refetch()}>
            {isFetching ? "Retrying…" : "Try again"}
          </Button>
        </Card>
      ) : !data ? (
        <div className="dashboard-state" role="status" aria-live="polite"><Spinner size={18} /> Loading analytics…</div>
      ) : (
        <div className="analytics decision-analytics">
          {error && (
            <div className="dashboard-error" role="alert">
              <span>The latest refresh failed, so these numbers may be out of date.</span>
              <Button type="button" variant="subtle" loading={isFetching} onClick={() => void refetch()}>Try again</Button>
            </div>
          )}
          <Section id="ready" title="Is the directory ready?" note={SNAPSHOT_NOTE}>
            <GraphBlock copy={COPY.readiness} wide>
              <MissingDetails data={data} />
            </GraphBlock>
          </Section>
          <Section id="routes" title="Can people get there?" note={SNAPSHOT_NOTE}>
            <GraphBlock copy={COPY.closures}>
              <ClosureImpact data={data} />
            </GraphBlock>
            <GraphBlock copy={COPY.reach}>
              <TravelModeReach data={data} />
            </GraphBlock>
          </Section>
          <Section id="searches" title="Who is searching, and for what?" note={`${data.searches.total} searches ${rangeText}`}>
            <GraphBlock copy={COPY.activity}>
              <SearchActivity data={data} />
            </GraphBlock>
            <GraphBlock copy={COPY.markerGap}>
              <SearchesWithoutMarkers data={data} />
            </GraphBlock>
          </Section>
        </div>
      )}
    </div>
  );
}
