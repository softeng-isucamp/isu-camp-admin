import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Button, Card, Empty, ProgressBar, Spinner } from "../../../components/UI";
import { services } from "../../../services/api";
import { errorMessage } from "../../../services/errors";
import type { DashboardRange, DecisionAnalytics } from "../../../types";
import { EffortVsDemand, FixFirstMatrix, IndoorDemand } from "./decision/BothCharts";
import { DecisionCard } from "./decision/DecisionCard";
import { DECISION_GROUPS } from "./decision/decisionCopy";
import { PlaceFunnel, SinglePointsOfFailure, TravelModeReach } from "./decision/ReadinessCharts";
import { AudienceMix, MoversSlope, QuietHoursHeatmap } from "./decision/UsageCharts";

export const dashboardAnalyticsQueryKey = (range: DashboardRange) => ["dashboard-analytics", range] as const;
export const decisionAnalyticsQueryKey = (range: DashboardRange) => ["dashboard-decision-analytics", range] as const;

/** Charts per group, in rank order; `DECISION_GROUPS` supplies the matching headings and copy. */
const GROUP_CHARTS: Array<Array<(data: DecisionAnalytics) => ReactNode>> = [
  [(d) => <FixFirstMatrix data={d} />, (d) => <IndoorDemand data={d} />, (d) => <EffortVsDemand data={d} />],
  [(d) => <PlaceFunnel data={d} />, (d) => <SinglePointsOfFailure data={d} />, (d) => <TravelModeReach data={d} />],
  [(d) => <QuietHoursHeatmap data={d} />, (d) => <MoversSlope data={d} />, (d) => <AudienceMix data={d} />],
];

/** The Dashboard's Analytics tab: nine decision charts in three ranked groups. */
export function AnalyticsTab({ range }: { range: DashboardRange }) {
  const { data, error, isFetching, isLoading, refetch } = useQuery({
    queryKey: decisionAnalyticsQueryKey(range),
    queryFn: () => services.dashboard.decisionAnalytics(range),
    placeholderData: (previous) => previous,
    retry: false,
  });

  if (error && !data) {
    return (
      <Card className="analytics-unavailable" role="alert">
        <Empty>{errorMessage(error, "Analytics couldn't be loaded. Please try again.")}</Empty>
        <Button type="button" variant="subtle" loading={isFetching} onClick={() => void refetch()}>
          {isFetching ? "Retrying…" : "Try again"}
        </Button>
      </Card>
    );
  }

  if (!data) {
    return (
      <div className="analytics">
        <div className="dashboard-state" role="status" aria-live="polite"><Spinner size={18} /> Loading analytics…</div>
      </div>
    );
  }

  return (
    <div className="analytics decision-analytics">
      <ProgressBar active={isFetching && !isLoading} />
      {error && (
        <div className="dashboard-error" role="alert">
          <span>The latest refresh of analytics failed, so the numbers shown may be out of date. {errorMessage(error, "")}</span>
          <button type="button" disabled={isFetching} onClick={() => void refetch()}>
            {isFetching ? "Retrying…" : "Try again"}
          </button>
        </div>
      )}
      <p className="decision-notice">Sample data — these charts use fixture numbers to compare designs.</p>
      {DECISION_GROUPS.map((group, g) => (
        <section key={group.id} className="decision-group" aria-labelledby={`decision-${group.id}`}>
          <div className="decision-group-head">
            <h2 id={`decision-${group.id}`}>{group.name}</h2>
            <span className="decision-tag">{group.tag}</span>
          </div>
          <p className="decision-sub">{group.sub}</p>
          <div className="decision-row">
            {group.cards.map((copy, i) => (
              <DecisionCard key={copy.title} rank={i + 1} copy={copy} best={i === 0}>
                {GROUP_CHARTS[g][i](data)}
              </DecisionCard>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
