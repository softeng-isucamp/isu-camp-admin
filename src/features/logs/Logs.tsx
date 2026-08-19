import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { services } from "../../services/api";
import {
  Badge,
  Card,
  Empty,
  Field,
  SelectField,
  Modal,
  Button,
  Pagination,
} from "../../components/UI";
import type { AuditEntry } from "../../types";
export function Logs() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("All");
  const [actor, setActor] = useState("All Actors");
  const [date, setDate] = useState("All Dates");
  const [detail, setDetail] = useState<AuditEntry | null>(null);
  const { data } = useQuery({
    queryKey: ["logs", category, q, actor, date],
    queryFn: () => services.logs.list(category, q, actor, date),
  });
  return (
    <div className="page">
      <div className="page-hero">
        <span className="page-icon">≡</span>
        <div>
          <h1>System Logs</h1>
          <p>Review administrator changes and user activity across ISU-CAMP.</p>
        </div>
      </div>
      <Card className="filters logs-filters">
        <Field
          label=""
          placeholder="Search logs..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <SelectField
          label="ACTIVITY TYPE"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option>All</option>
          <option>Admin</option>
          <option>User</option>
        </SelectField>
        <SelectField
          label="ACTOR"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
        >
          <option>All Actors</option>
          <option>admin01</option>
          <option>staff02</option>
          <option>student01</option>
          <option>student02</option>
        </SelectField>
        <SelectField
          label="DATE"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        >
          <option>All Dates</option>
          <option>Aug 17, 2026</option>
        </SelectField>
      </Card>
      <Card className="table-card">
        <div className="tabs">
          <button
            className={category === "All" ? "active" : ""}
            onClick={() => setCategory("All")}
          >
            All Logs
          </button>
          <button
            className={category === "Admin" ? "active" : ""}
            onClick={() => setCategory("Admin")}
          >
            Admin Activity
          </button>
          <button
            className={category === "User" ? "active" : ""}
            onClick={() => setCategory("User")}
          >
            User Activity
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ACTIVITY</th>
                <th>ACTOR</th>
                <th>TARGET</th>
                <th>DATE &amp; TIME</th>
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((l) => (
                <tr key={l.id}>
                  <td>
                    <strong>{l.action}</strong>
                    <small>{l.category} activity</small>
                  </td>
                  <td>{l.actor}</td>
                  <td>{l.target}</td>
                  <td>{l.createdAt}</td>
                  <td>
                    <button
                      className="text-action"
                      onClick={() => setDetail(l)}
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.items.length && <Empty>No logs found.</Empty>}
        </div>
        <Pagination total={data?.total ?? 0} />
      </Card>
      {detail && (
        <Modal title="Log Details" onClose={() => setDetail(null)}>
          <Badge>
            {detail.category === "Admin"
              ? "Administrator detail"
              : detail.category === "User"
                ? "User activity detail"
                : "System detail"}
          </Badge>
          <div className="detail-grid">
            <span>ACTIVITY</span>
            <strong>{detail.action}</strong>
            <span>ACTOR</span>
            <strong>{detail.actor}</strong>
            <span>TARGET</span>
            <strong>{detail.target}</strong>
            <span>DATE &amp; TIME</span>
            <strong>{detail.createdAt}</strong>
          </div>
          <p className="muted">
            {detail.category === "Admin"
              ? "This administrator action changed protected campus data."
              : detail.category === "User"
                ? "This user event records activity originating from a campus account."
                : "This system event was recorded by the ISU-CAMP service."}
          </p>
          <p className="muted">
            {detail.detail ??
              "No additional detail was recorded for this activity."}
          </p>
          <div className="modal-actions">
            <Button onClick={() => setDetail(null)}>Close</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
