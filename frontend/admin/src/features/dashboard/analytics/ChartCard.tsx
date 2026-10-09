import type { ReactNode } from "react";
import { ResponsiveContainer } from "recharts";
import { Card, Empty, Spinner } from "../../../components/UI";
import type { DashboardAnalytics } from "../../../types";

type Props = {
  title: string;
  subtitle: string;
  /** Undefined while the analytics query is loading. */
  data: DashboardAnalytics | undefined;
  isEmpty?: (data: DashboardAnalytics) => boolean;
  emptyMessage?: string;
  className?: string;
  children: (data: DashboardAnalytics) => ReactNode;
};

/** Shared card chrome for every analytics chart: heading, loading and empty states. */
export function ChartCard({ title, subtitle, data, isEmpty, emptyMessage = "No activity recorded for this period.", className, children }: Props) {
  return (
    <Card className={className ? `analytics-card ${className}` : "analytics-card"}>
      <div className="card-heading">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="analytics-body">
        {!data ? (
          <div className="dashboard-state" role="status" aria-live="polite"><Spinner size={18} /> Loading {title.toLowerCase()}…</div>
        ) : isEmpty?.(data) ? (
          <Empty>{emptyMessage}</Empty>
        ) : (
          children(data)
        )}
      </div>
    </Card>
  );
}

/** ResponsiveContainer with a starting size so charts also lay out in jsdom and before first measure. */
export function ChartArea({ height = 260, children }: { height?: number; children: React.ReactElement }) {
  return (
    <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 640, height }}>
      {children}
    </ResponsiveContainer>
  );
}
