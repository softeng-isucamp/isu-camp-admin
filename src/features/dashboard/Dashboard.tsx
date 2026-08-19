import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, Badge } from "../../components/UI";
import { services } from "../../services/api";
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
        <Card>
          <div className="metric-top">
            <span className="metric-icon">▤</span>
          </div>
          <span>Campus Locations</span>
          <strong>{data?.locations?.toLocaleString() ?? "—"}</strong>
        </Card>
        <Card>
          <div className="metric-top">
            <span className="metric-icon">⌁</span>
            <Badge tone="blue">LIVE</Badge>
          </div>
          <span>Active Pathways</span>
          <strong>{data?.pathways?.toLocaleString() ?? "—"}</strong>
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
              <div className="map-grid" />
              <div className="map-building b1" />
              <div className="map-building b2" />
              <div className="map-building b3" />
              <div className="map-path p1" />
              <div className="map-path p2" />
              <span className="map-pin pin1">●</span>
              <span className="map-pin pin2">●</span>
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
              {[
                ["01", "Registrar’s Office", "Office · Administration", "128"],
                ["02", "Computer Lab 1", "Laboratory · CCSICT", "104"],
                ["03", "CAS ROOM 101", "Classroom · CAS", "87"],
                ["04", "University Library", "Library · Facility", "76"],
                ["05", "Student Development Center", "Office · Facility", "61"],
              ].map((r) => (
                <div className="rank-row" key={r[0]}>
                  <b>{r[0]}</b>
                  <div>
                    <strong>{r[1]}</strong>
                    <small>{r[2]}</small>
                  </div>
                  <span>
                    <strong>{r[3]}</strong>
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
