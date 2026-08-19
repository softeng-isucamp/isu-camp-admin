import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, Badge } from "../../components/UI";
import { services } from "../../services/api";
import campusMap from "../../assets/figma/dashboard/campus-map.png";
export function Dashboard() {
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
        <Card>
          <div className="metric-top">
            <span className="metric-icon">▥</span>
            <Badge>+2 this week</Badge>
          </div>
          <span>Total Buildings</span>
          <strong>{data?.buildings ?? "—"}</strong>
        </Card>
        <Card>
          <div className="metric-top">
            <span className="metric-icon">⌂</span>
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
              />
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
              <Link to="/locations">VIEW ALL</Link>
            </div>
            <div className="rank-list">
              {(data?.topSearched ?? []).map((r) => (
                <div className="rank-row" key={r.rank}>
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
              ))}
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
                <div className="activity-row" key={a.id}>
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
                <span>⌖</span>
                <div>
                  <strong>Edit Campus Map</strong>
                  <small>Modify structural layouts and markers.</small>
                </div>
                →
              </Link>
              <Link to="/routes">
                <span>⌁</span>
                <div>
                  <strong>Configure Routing</strong>
                  <small>Manage pedestrian pathways and shade.</small>
                </div>
                →
              </Link>
              <Link to="/locations">
                <span>▤</span>
                <div>
                  <strong>Manage Locations</strong>
                  <small>Review campus places and facilities.</small>
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
