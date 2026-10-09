import { useQuery } from "@tanstack/react-query";
import { Card, Empty, ProgressBar } from "../../../components/UI";
import { services } from "../../../services/api";
import type { DashboardRange } from "../../../types";
import { ActivityKpis } from "./ActivityKpis";
import { DirectoryCompleteness } from "./DirectoryCompleteness";
import { PeakHoursHeatmap } from "./PeakHoursHeatmap";
import { RegistrationsOverTime } from "./RegistrationsOverTime";
import { SearchesVisitsTrend } from "./SearchesVisitsTrend";
import { VisitsByAccountType } from "./VisitsByAccountType";
import { VisitsByDestinationType } from "./VisitsByDestinationType";

export const dashboardAnalyticsQueryKey = (range: DashboardRange) => ["dashboard-analytics", range] as const;

/**
 * Candidate charts for the Analytics tab. To drop a chart, delete its file and its JSX line below.
 */
export function AnalyticsTab({ range }: { range: DashboardRange }) {
  const { data, error, isFetching, isLoading } = useQuery({
    queryKey: dashboardAnalyticsQueryKey(range),
    queryFn: () => services.dashboard.analytics(range),
    placeholderData: (previous) => previous,
    retry: false,
  });

  if (error && !data) {
    return (
      <Card className="analytics-unavailable">
        <Empty>Analytics are not available from the backend yet.</Empty>
      </Card>
    );
  }

  return (
    <div className="analytics">
      <ProgressBar active={isFetching && !isLoading} />
      <section aria-labelledby="analytics-app-usage">
        <h2 className="analytics-section" id="analytics-app-usage">App Usage</h2>
        <div className="analytics-grid">
          <ActivityKpis data={data} />
          <SearchesVisitsTrend data={data} />
          <PeakHoursHeatmap data={data} />
          <VisitsByAccountType data={data} />
          <VisitsByDestinationType data={data} />
          <RegistrationsOverTime data={data} />
        </div>
      </section>
      <section aria-labelledby="analytics-data-health">
        <h2 className="analytics-section" id="analytics-data-health">Data Health</h2>
        <div className="analytics-grid">
          <DirectoryCompleteness data={data} />
        </div>
      </section>
    </div>
  );
}
