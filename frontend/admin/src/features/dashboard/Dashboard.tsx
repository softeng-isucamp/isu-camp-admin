import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, Badge, Empty, ProgressBar, Spinner } from "../../components/UI";
import { services, USE_HTTP_API } from "../../services/api";
import { errorMessage } from "../../services/errors";
import { formatDateTime } from "../../lib/format";
import type { DashboardRange } from "../../types";
import metricBuildings from "../../assets/figma/dashboard/metric-buildings.svg";
import metricOffices from "../../assets/figma/dashboard/metric-offices.svg";
import { DashboardMapPreview } from "./DashboardMapPreview";
import { AccountTypeSplit } from "./AccountTypeSplit";
import { RangeSelect, rangeLabel } from "./RangeSelect";
import { dashboardAnalyticsQueryKey } from "./analytics/AnalyticsTab";
import { usePermissions } from "../auth/usePermissions";

export function Dashboard() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [range, setRange] = useState<DashboardRange>("week");
  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["dashboard", range],
    queryFn: () => services.dashboard.summary(range),
    placeholderData: (previous) => previous,
  });

  // Only the local adapter has Visit data; the HTTP backend serves Searches only.
  const useAnalyticsDestinations = !USE_HTTP_API;
  const destinationsQuery = useQuery({
    queryKey: dashboardAnalyticsQueryKey(range),
    queryFn: () => services.dashboard.analytics(range),
    placeholderData: (previous) => previous,
    enabled: useAnalyticsDestinations,
    retry: false,
  });
  const destinations: Array<{ rank: string; locationId?: string; name: string; context: string; searches: number; visits?: number }> =
    useAnalyticsDestinations && destinationsQuery.data ? destinationsQuery.data.topDestinations : data?.topSearched ?? [];
  const destinationsLoading = useAnalyticsDestinations ? destinationsQuery.isLoading : isLoading;
  const destinationsFailed = useAnalyticsDestinations ? !!destinationsQuery.error && !destinationsQuery.data : !!error && !data;

  const rangeText = rangeLabel(range);
  const buildingChange = data?.buildingChange;
  const recentAdminActivity = (data?.recent ?? []).filter((entry) => entry.category === "Admin");

  return (
    <div className="page dashboard">
      <section className="hero">
        <div>
          <p className="eyebrow">KUMPAS ADMIN</p>
          <h1>Campus Overview</h1>
          <p>Campus data quality, location coverage, map setup, and recent admin activity.</p>
        </div>
        <Link className="btn btn-primary" to="/locations">
          Open Locations
        </Link>
      </section>
      <div className="dashboard-bar">
        <div className="dashboard-range">
          <RangeSelect value={range} onChange={setRange} firstYear={data?.firstAnalyticsYear} disabled={isFetching} label="Dashboard time range" />
        </div>
      </div>
      <>
          <div className="metric-grid">
            <Link className="card dashboard-link" to="/locations">
              <div className="metric-top">
                <span className="metric-icon">
                  <img src={metricBuildings} alt="" />
                </span>
                {buildingChange !== null && buildingChange !== undefined && (
                  <Badge>
                    {buildingChange >= 0 ? "+" : ""}{buildingChange} {buildingChange >= 0 ? "added" : "change"} {rangeText}
                  </Badge>
                )}
              </div>
              <span>Total Buildings</span>
              <strong>{data?.buildings ?? "—"}</strong>
            </Link>
            <Link className="card dashboard-link" to="/locations">
              <div className="metric-top">
                <span className="metric-icon">
                  <img src={metricOffices} alt="" />
                </span>
              </div>
              <span>Indoor Locations</span>
              <strong>{data?.indoorLocations?.toLocaleString() ?? "—"}</strong>
            </Link>
          </div>
          {error && (
            <div className="dashboard-error" role="alert">
              <span>{errorMessage(error, "Dashboard information couldn't be loaded. Please try again.")}</span>
              <button type="button" onClick={() => void refetch()}>Try again</button>
            </div>
          )}
          <div className="dashboard-grid">
            <div className="stack">
              <Card className="map-card">
                <div className="card-heading">
                  <div>
                    <h2>Campus Map Preview</h2>
                    <p>Preview campus locations and pathways.</p>
                  </div>
                  <Link to="/map-editor">Expand View ↗</Link>
                </div>
                <DashboardMapPreview />
              </Card>
              <Card>
                <div className="card-heading">
                  <div>
                    <h2>Top Destinations</h2>
                    <p>{useAnalyticsDestinations ? "Most searched campus destinations and how often users arrive." : "Most searched campus destinations."}</p>
                  </div>
                  <Link to="/locations">VIEW ALL</Link>
                </div>
                <ProgressBar active={useAnalyticsDestinations ? destinationsQuery.isFetching && !destinationsLoading : isFetching && !isLoading} />
                <div className="rank-list">
                  {destinationsLoading ? (
                    <div className="dashboard-state" role="status" aria-live="polite"><Spinner size={18} /> Loading search analytics…</div>
                  ) : destinationsFailed ? (
                    <Empty>Search analytics are unavailable.</Empty>
                  ) : destinations.length === 0 ? (
                    <Empty>No search analytics recorded yet.</Empty>
                  ) : (
                    destinations.map((r) => (
                      <Link
                        className={r.visits !== undefined ? "rank-row rank-row-visits dashboard-link" : "rank-row dashboard-link"}
                        key={r.locationId ?? `${r.rank}:${r.name}`}
                        to={`/locations?${new URLSearchParams({
                          q: r.name,
                          ...(r.locationId ? { locationKey: r.locationId } : {}),
                        })}`}
                        title={`View ${r.name} in directory`}
                      >
                        <b>{r.rank}</b>
                        <div>
                          <strong>{r.name}</strong>
                          <small>{r.context}</small>
                        </div>
                        <span>
                          <strong>{r.searches}</strong>
                          <small>searches</small>
                        </span>
                        {r.visits !== undefined && (
                          <>
                            <span>
                              <strong>{r.visits}</strong>
                              <small>visits</small>
                            </span>
                            <span>
                              <strong>{r.searches ? Math.round((r.visits / r.searches) * 100) : 0}%</strong>
                              <small>arrival rate</small>
                            </span>
                          </>
                        )}
                      </Link>
                    ))
                  )}
                </div>
              </Card>
            </div>
            <div className="stack">
              <Card className="account-type-card">
                <div className="card-heading">
                  <div>
                    <h2>Registered Users</h2>
                    <p>Share of accounts by account type.</p>
                  </div>
                  <Link to="/users">VIEW ALL</Link>
                </div>
                {isLoading ? (
                  <div className="dashboard-state" role="status" aria-live="polite"><Spinner size={18} /> Loading registered users…</div>
                ) : error && !data ? (
                  <Empty>Registered users are unavailable.</Empty>
                ) : (
                  <AccountTypeSplit total={data?.users ?? null} counts={data?.usersByType ?? null} onSelect={(type) => navigate(`/users?${new URLSearchParams({ userType: type })}`)} />
                )}
              </Card>
              <Card>
                <div className="card-heading">
                  <h2>Recent Activity</h2>
                  <Link to="/system-logs">VIEW ALL</Link>
                </div>
                <div className="activity">
                  {isLoading ? (
                    <div className="dashboard-state" role="status" aria-live="polite"><Spinner size={18} /> Loading recent activity…</div>
                  ) : error && !data ? (
                    <Empty>Recent activity is unavailable.</Empty>
                  ) : recentAdminActivity.length === 0 ? (
                    <Empty>No recent administrative activity recorded yet.</Empty>
                  ) : recentAdminActivity.map((a) => (
                    <Link
                      className="activity-row dashboard-link"
                      key={a.id}
                      to="/system-logs"
                      title="View activity in system logs"
                    >
                      <i />
                      <div>
                        <small>{formatDateTime(a.createdAt)}</small>
                        <strong>{a.action}</strong>
                        <p>{a.detail ?? `${a.target} was updated.`}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </Card>
            </div>
          </div>
      </>
    </div>
  );
}
