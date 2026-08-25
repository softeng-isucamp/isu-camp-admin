import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, Badge, Empty } from "../../components/UI";
import { services } from "../../services/api";
import campusMap from "../../assets/figma/dashboard/campus-map.png";
import metricBuildings from "../../assets/figma/dashboard/metric-buildings.svg";
import metricOffices from "../../assets/figma/dashboard/metric-offices.svg";
import actionMap from "../../assets/figma/dashboard/action-map.svg";
import actionRouting from "../../assets/figma/dashboard/action-routing.svg";
import mapLayersIcon from "../../assets/figma/dashboard/map-layers-icon.svg";
import mapZoomIcon from "../../assets/figma/dashboard/map-zoom-icon.svg";

export function Dashboard() {
  const navigate = useNavigate();
  const [searchWindow, setSearchWindow] = useState("This Week");
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: services.dashboard.summary,
  });

  return (
    <div className="page dashboard">
      <section className="hero">
        <div>
          <p className="eyebrow">ISU-CAMP ADMIN</p>
          <h1>Campus Overview</h1>
          <p>
            System status is optimal. Currently managing campus infrastructure
            <br />
            and geospatial routing configurations.
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
            <Badge>+2 this week</Badge>
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
          <span>Registered Offices</span>
          <strong>{data?.offices?.toLocaleString() ?? "—"}</strong>
        </Card>
      </div>
      <div className="dashboard-grid">
        <div className="stack">
          <Card className="map-card">
            <div className="card-heading">
              <div>
                <h2>Campus Map Status</h2>
                <p>Live locations and pathways across campus.</p>
              </div>
              <Link to="/map-editor">Expand View ↗</Link>
            </div>
            <div className="map-preview">
              <img
                className="map-image"
                src={campusMap}
                alt="Campus map preview"
                onClick={() => navigate("/map-editor")}
                style={{ cursor: "pointer" }}
              />
              <div className="dashboard-map-controls" aria-label="Map controls">
                <button
                  type="button"
                  aria-label="Show map layers"
                  onClick={() => navigate("/map-editor")}
                  title="Open map layers"
                >
                  <img src={mapLayersIcon} alt="" />
                </button>
                <button
                  type="button"
                  aria-label="Zoom map"
                  onClick={() => navigate("/map-editor")}
                  title="Zoom into interactive map"
                >
                  <img src={mapZoomIcon} alt="" />
                </button>
              </div>
              <div className="legend">
                <b>LIVE LAYERS</b>
                <span>
                  <i className="dot green" />
                  Academic Buildings
                </span>
                <span>
                  <i className="dot blue" />
                  Student Services
                </span>
                <span>
                  <i className="dot orange" />
                  Maintenance Zones
                </span>
              </div>
            </div>
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
                  onChange={(event) => setSearchWindow(event.target.value)}
                >
                  <option>This Week</option>
                  <option>This Month</option>
                  <option>All Time</option>
                </select>
              </div>
            </div>
            <div className="rank-list">
              {(data?.topSearched ?? []).length === 0 ? (
                <Empty>No search analytics recorded yet.</Empty>
              ) : (
                (data?.topSearched ?? []).map((r) => (
                  <div
                    className="rank-row"
                    key={r.rank}
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate(`/locations?q=${encodeURIComponent(r.name)}`)}
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
              {(data?.recent ?? []).map((a) => (
                <div
                  className="activity-row"
                  key={a.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => navigate("/system-logs")}
                  title="View activity in system logs"
                >
                  <i />
                  <div>
                    <small>{a.createdAt}</small>
                    <strong>{a.action}</strong>
                    <p>{a.detail ?? `${a.target} was updated.`}</p>
                  </div>
                </div>
              ))}
            </div>
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
              <Link to="/routes">
                <span>
                  <img src={actionRouting} alt="" />
                </span>
                <div>
                  <strong>Configure Routing</strong>
                  <small>Manage pedestrian pathways and shade.</small>
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
