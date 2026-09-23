import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, Badge, Empty } from "../../components/UI";
import { services } from "../../services/api";
import { formatDateTime } from "../../lib/format";
import type { DashboardRange } from "../../types";
import metricBuildings from "../../assets/figma/dashboard/metric-buildings.svg";
import metricOffices from "../../assets/figma/dashboard/metric-offices.svg";
import metricUsers from "../../assets/figma/navigation/profile-user.svg";
import actionMap from "../../assets/figma/dashboard/action-map.svg";
import { DashboardMapPreview } from "./DashboardMapPreview";

export function Dashboard() {
  const navigate = useNavigate();
  const [searchWindow, setSearchWindow] = useState<DashboardRange>("week");
  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["dashboard", searchWindow],
    queryFn: () => services.dashboard.summary(searchWindow),
    placeholderData: (previous) => previous,
  });

  const rangeLabel = searchWindow === "week" ? "this week" : searchWindow === "month" ? "this month" : "all time";
  const buildingChange = data?.buildingChange;
  const recentAdminActivity = (data?.recent ?? []).filter((entry) => entry.category === "Admin");

  return (
    <div className="page dashboard">
      <section className="hero">
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
      </section>
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
                <h2>Top Searched Locations</h2>
                <p>Most searched campus destinations by users.</p>
              </div>
              <div className="dashboard-card-controls">
                <Link to="/locations">VIEW ALL</Link>
                <select
                  className="dashboard-time-filter"
                  aria-label="Top searched time range"
                  value={searchWindow}
                  disabled={isFetching}
                  onChange={(event) => setSearchWindow(event.target.value as DashboardRange)}
                >
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                  <option value="all">All Time</option>
                </select>
              </div>
            </div>
            <div className="rank-list">
              {isLoading ? (
                <div className="dashboard-state" role="status" aria-live="polite">Loading search analytics…</div>
              ) : error && !data ? (
                <Empty>Search analytics are unavailable.</Empty>
              ) : (data?.topSearched ?? []).length === 0 ? (
                <Empty>No search analytics recorded yet.</Empty>
              ) : (
                (data?.topSearched ?? []).map((r) => (
                  <div
                    className="rank-row"
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
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
        <div className="stack">
          <Card>
            <div className="card-heading">
              <h2>Recent Activity</h2>
              <Link to="/system-logs">VIEW ALL</Link>
            </div>
            <div className="activity">
              {isLoading ? (
                <div className="dashboard-state" role="status" aria-live="polite">Loading recent activity…</div>
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
          <Card className="registered-users-card" style={{ cursor: "pointer" }} onClick={() => navigate("/users")}>
            <div className="metric-top">
              <span className="metric-icon">
                <img src={metricUsers} alt="" />
              </span>
            </div>
            <span>Registered Users</span>
            <strong>{data?.users?.toLocaleString() ?? "—"}</strong>
          </Card>
          <Card>
            <div className="card-heading">
              <h2>Quick Actions</h2>
            </div>
            <div className="quick-links">
              <Link to="/map-editor">
                <span>
                  <img src={actionMap} alt="" />
                </span>
                <div>
                  <strong>Edit Campus Map</strong>
                  <small>Modify structural layouts and markers.</small>
                </div>
                →
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
