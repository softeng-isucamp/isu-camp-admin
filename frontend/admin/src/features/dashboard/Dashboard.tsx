import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, Badge, Empty, ProgressBar, Spinner } from "../../components/UI";
import { services, USE_HTTP_API } from "../../services/api";
import { formatDateTime } from "../../lib/format";
import type { DashboardRange } from "../../types";
import metricBuildings from "../../assets/figma/dashboard/metric-buildings.svg";
import metricOffices from "../../assets/figma/dashboard/metric-offices.svg";
import { DashboardMapPreview } from "./DashboardMapPreview";
import { AccountTypeSplit } from "./AccountTypeSplit";
import { AnalyticsTab, dashboardAnalyticsQueryKey } from "./analytics/AnalyticsTab";
import type { DashboardTab } from "./dashboardTabs";

export function Dashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<DashboardTab>("overview");
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

  const rangeLabel = range === "week" ? "this week" : range === "month" ? "this month" : "all time";
  const buildingChange = data?.buildingChange;
  const recentAdminActivity = (data?.recent ?? []).filter((entry) => entry.category === "Admin");

  return (
    <div className="page dashboard">
      <section className={tab === "overview" ? "hero" : "hero hero-compact"}>
        <div>
          <p className="eyebrow">KUMPAS ADMIN</p>
          <h1>Campus Overview</h1>
          <p>
            Monitor campus data quality, location coverage,
            <br />
            map configuration, and recent administrative activity.
          </p>
        </div>
        <Link className="btn btn-primary" to="/locations">
          ＋ New Location
        </Link>
        <div className="hero-toolbar">
          <div className="hero-tabs" role="tablist" aria-label="Dashboard sections">
            {(["overview", "analytics"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? "active" : undefined}
                onClick={() => setTab(key)}
              >
                {key === "overview" ? "Overview" : "Analytics"}
              </button>
            ))}
          </div>
          <select
            className="dashboard-time-filter"
            aria-label="Dashboard time range"
            value={range}
            disabled={isFetching}
            onChange={(event) => setRange(event.target.value as DashboardRange)}
          >
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="all">All Time</option>
          </select>
        </div>
      </section>
      {tab === "analytics" ? <AnalyticsTab range={range} /> : (
        <>
          <div className="metric-grid">
            <Card style={{ cursor: "pointer" }} onClick={() => navigate("/locations")}>
              <div className="metric-top">
                <span className="metric-icon">
                  <img src={metricBuildings} alt="" />
                </span>
                {buildingChange !== null && buildingChange !== undefined && (
                  <Badge>
                    {buildingChange >= 0 ? "+" : ""}{buildingChange} {buildingChange >= 0 ? "added" : "change"} {rangeLabel}
                  </Badge>
                )}
              </div>
              <span>Total Buildings</span>
              <strong>{data?.buildings ?? "—"}</strong>
            </Card>
            <Card style={{ cursor: "pointer" }} onClick={() => navigate("/locations")}>
              <div className="metric-top">
                <span className="metric-icon">
                  <img src={metricOffices} alt="" />
                </span>
              </div>
              <span>Indoor Locations</span>
              <strong>{data?.indoorLocations?.toLocaleString() ?? "—"}</strong>
            </Card>
          </div>
          {error && (
            <div className="dashboard-error" role="alert">
              <span>Unable to load the dashboard. {error instanceof Error ? error.message : "The dashboard service returned an error."}</span>
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
                      <div
                        className={r.visits !== undefined ? "rank-row rank-row-visits" : "rank-row"}
                        key={r.locationId ?? `${r.rank}:${r.name}`}
                        style={{ cursor: "pointer" }}
                        onClick={() => navigate(`/locations?${new URLSearchParams({
                          q: r.name,
                          ...(r.locationId ? { locationKey: r.locationId } : {}),
                        })}`)}
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
                      </div>
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
                    <div
                      className="activity-row"
                      key={a.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => navigate("/system-logs")}
                      title="View activity in system logs"
                    >
                      <i />
                      <div>
                        <small>{formatDateTime(a.createdAt)}</small>
                        <strong>{a.action}</strong>
                        <p>{a.detail ?? `${a.target} was updated.`}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
