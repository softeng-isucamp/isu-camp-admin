import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { services } from "../../services/api";
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Modal,
  Pagination,
  SelectField,
} from "../../components/UI";
import type { Pathway, Shade } from "../../types";

export function RoutesPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All Statuses");
  const [dialog, setDialog] = useState<
    "add" | "import" | "edit" | "remove" | null
  >(null);
  const [selected, setSelected] = useState<Pathway | null>(null);
  const [draft, setDraft] = useState<Pathway | null>(null);
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<{
    imported: number;
    errors: string[];
  } | null>(null);
  const [notice, setNotice] = useState("");
  const { data } = useQuery({
    queryKey: ["routes", query],
    queryFn: () => services.routes.list(query),
  });
  const items = (data?.items ?? []).filter(
    (item) => status === "All Statuses" || item.status === status,
  );
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["routes"] });
    await queryClient.invalidateQueries({ queryKey: ["logs"] });
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const save = async () => {
    if (!draft) return;
    await services.routes.save(draft);
    await refresh();
    setDialog(null);
    setNotice(`${draft.name} saved successfully.`);
  };
  const remove = async () => {
    if (!selected) return;
    await services.routes.remove(selected.id);
    await refresh();
    setDialog(null);
    setNotice(`${selected.name} removed successfully.`);
  };
  const validateImport = async () =>
    setImportResult(await services.imports.routes(importText));
  const applyImport = async () => {
    if (!importResult || importResult.errors.length) return;
    await refresh();
    setDialog(null);
    setNotice(`${importResult.imported} routes imported successfully.`);
  };
  return (
    <div className="page">
      <div className="page-hero">
        <span className="page-icon">⌁</span>
        <div>
          <h1>Routes &amp; Paths</h1>
          <p>
            Manage pedestrian connections, pathway geometry, shade
            classification, and availability.
          </p>
        </div>
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <div className="routes-layout">
        <Card className="route-summary">
          <p className="eyebrow">SELECTED CONNECTION</p>
          <h2>Main Gate → College of Arts &amp; Sciences</h2>
          <p>Fully Shaded</p>
          <hr />
          <Badge>Open · Two-way covered walkway</Badge>
          <div className="mini-route">
            <span>S</span>
            <i />
            <span>D</span>
          </div>
        </Card>
        <Card className="table-card">
          <div className="table-heading">
            <div>
              <h2>Routes &amp; Paths</h2>
              <p>{items.length} connections</p>
            </div>
            <div className="inline-fields">
              <Field
                label=""
                placeholder="Search routes..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <SelectField
                label="STATUS"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option>All Statuses</option>
                <option>Open</option>
                <option>Closed</option>
              </SelectField>
              <Button
                variant="subtle"
                onClick={() => {
                  setImportText("");
                  setImportResult(null);
                  setDialog("import");
                }}
              >
                ⇧ Import
              </Button>
              <Button
                onClick={() => {
                  const base = items[0] ?? {
                    id: "",
                    name: "",
                    sourceNodeId: "ccsict-entry",
                    destinationNodeId: "junction-a",
                    distance: "—",
                    time: "—",
                    shade: "Unshaded" as Shade,
                    type: "Campus walkway",
                    direction: "Two-way",
                    status: "Open",
                    pathPoints: [],
                  };
                  setDraft({ ...base, id: `route-${Date.now()}`, name: "" });
                  setDialog("add");
                }}
              >
                ＋ Add Route
              </Button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ROUTE / PATH</th>
                  <th>SOURCE → DESTINATION</th>
                  <th>SHADE</th>
                  <th>STATUS</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                      <small>
                        {item.direction} corridor · {item.distance}
                      </small>
                    </td>
                    <td>
                      {item.sourceNodeId} → {item.destinationNodeId}
                    </td>
                    <td>
                      <Badge>{item.shade}</Badge>
                    </td>
                    <td>
                      <Badge>{item.status}</Badge>
                    </td>
                    <td>
                      <button
                        className="table-action"
                        title="Edit route"
                        onClick={() => {
                          setSelected(item);
                          setDraft({ ...item });
                          setDialog("edit");
                        }}
                      >
                        ✎
                      </button>
                      <button
                        className="table-action danger-text"
                        title="Delete route"
                        onClick={() => {
                          setSelected(item);
                          setDialog("remove");
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length && <Empty>No routes found.</Empty>}
          </div>
          <Pagination total={items.length} />
        </Card>
      </div>
      {(dialog === "add" || dialog === "edit") && draft && (
        <Modal
          title={dialog === "add" ? "Add Route / Path" : "Edit Route / Path"}
          onClose={() => setDialog(null)}
        >
          <Field
            label="ROUTE NAME"
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            placeholder="e.g. Gate–Arts"
          />
          <SelectField
            label="SHADE"
            value={draft.shade}
            onChange={(event) =>
              setDraft({ ...draft, shade: event.target.value as Shade })
            }
          >
            {["Fully Shaded", "Mostly Shaded", "Partial Shade", "Unshaded"].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </SelectField>
          <div className="modal-actions">
            <Button variant="subtle" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button onClick={save}>Save Route</Button>
          </div>
        </Modal>
      )}
      {dialog === "remove" && (
        <Modal title="Delete Route?" onClose={() => setDialog(null)}>
          <p>
            This action will remove <strong>{selected?.name}</strong>.
          </p>
          <div className="modal-actions">
            <Button variant="subtle" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove}>
              Delete Route
            </Button>
          </div>
        </Modal>
      )}
      {dialog === "import" && (
        <Modal title="Import Routes JSON" onClose={() => setDialog(null)}>
          <p className="muted">
            Validate source and destination node references before commit.
          </p>
          <textarea
            className="json-input"
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder='[{"id":"route-1", ...}]'
          />
          <input
            type="file"
            accept="application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) file.text().then(setImportText);
            }}
          />
          {importResult && (
            <div className={importResult.errors.length ? "error" : "notice"}>
              {importResult.errors.length
                ? importResult.errors.map((error) => (
                    <div key={error}>{error}</div>
                  ))
                : `Validation passed for ${importResult.imported} routes.`}
            </div>
          )}
          <div className="modal-actions">
            <Button variant="subtle" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="subtle" onClick={validateImport}>
              Validate
            </Button>
            <Button
              onClick={applyImport}
              disabled={!importResult || importResult.errors.length > 0}
            >
              Import
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
