import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Button, Card, Empty, ProgressBar, Spinner } from "../../components/UI";
import { services } from "../../services/api";
import { errorMessage } from "../../services/errors";
import type { DashboardRange } from "../../types";
import { COPY } from "./copy";
import { GraphBlock } from "./GraphBlock";
import { ClosureImpact, TravelModeReach } from "./NetworkCharts";
import { DirectoryReadiness } from "./ReadinessCharts";
import { SearchesByAccountType, SearchesByDestinationType } from "./SearchCharts";

export const decisionAnalyticsQueryKey = (range: DashboardRange) => ["decision-analytics", range] as const;

const RANGE_LABEL: Record<DashboardRange, string> = { week: "this week", month: "this month", all: "all time" };

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="decision-group" aria-labelledby={`analytics-${id}`}>
      <div className="decision-group-head">
        <h2 id={`analytics-${id}`}>{title}</h2>
        {note && <span className="decision-tag">{note}</span>}
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
  const rangeLabel = RANGE_LABEL[range];

  return (
    <div className="page analytics-page">
      <section className="hero">
        <div>
          <p className="eyebrow">KUMPAS ADMIN</p>
          <h1>Analytics</h1>
          <p>Sample data until the server provides these numbers.</p>
        </div>
        <select
          className="dashboard-time-filter"
          aria-label="Search time range"
          value={range}
          disabled={isFetching}
          onChange={(event) => setRange(event.target.value as DashboardRange)}
        >
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="all">All time</option>
        </select>
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
          <Section id="ready" title="Is the directory ready?">
            <GraphBlock copy={COPY.readiness} wide>
              <DirectoryReadiness data={data} />
            </GraphBlock>
          </Section>
          <Section id="routes" title="Can people get there?">
            <GraphBlock copy={COPY.closures}>
              <ClosureImpact data={data} />
            </GraphBlock>
            <GraphBlock copy={COPY.reach}>
              <TravelModeReach data={data} />
            </GraphBlock>
          </Section>
          <Section id="searches" title="Who is searching, and for what?" note={`${data.searches.total} searches ${rangeLabel}`}>
            <GraphBlock copy={COPY.byAccount}>
              <SearchesByAccountType data={data} />
            </GraphBlock>
            <GraphBlock copy={COPY.byDestination}>
              <SearchesByDestinationType data={data} />
            </GraphBlock>
          </Section>
        </div>
      )}
    </div>
  );
}
