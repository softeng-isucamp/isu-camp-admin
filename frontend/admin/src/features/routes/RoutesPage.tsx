import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { services, setMockFailure } from "../../services/api";
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
import type { Pathway, RouteNode, Shade } from "../../types";
import routesModuleIcon from "../../assets/figma/modules/routes.svg";

const endpointLabels: Record<string, [string, string]> = {
  "ccsict-junction": ["Main Gate", "Arts & Sciences"],
  "junction-student": ["ISU Dormitory", "ISU Grandstand"],
  "junction-library": ["College of Medicine", "University Library"],
};

export function RoutesPage() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const failure = new URLSearchParams(window.location.search).get(
      "mockFailure",
    );
    if (failure === "routeSave") {
      setMockFailure("routeSave", true);
      return () => setMockFailure("routeSave", false);
    }
    return undefined;
  }, []);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("All Sources");
  const [destination, setDestination] = useState("All Destinations");
  const [status, setStatus] = useState("All Statuses");
  const [shade, setShade] = useState("All Shades");
  const [dialog, setDialog] = useState<
    "add" | "import" | "edit" | "remove" | null
  >(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Pathway | null>(null);
  const [draft, setDraft] = useState<Pathway | null>(null);
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<{
    imported: number;
    errors: string[];
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { data } = useQuery({
    queryKey: ["routes", query],
    queryFn: () => services.routes.list(query),
  });
  const { data: nodesData } = useQuery<RouteNode[]>({
    queryKey: ["nodes"],
    queryFn: () => services.map.nodes(),
  });
  const nodes = nodesData ?? [];
  const items = (data?.items ?? []).filter(
    (item) =>
      (source === "All Sources" || item.sourceNodeId === source) &&
      (destination === "All Destinations" ||
        item.destinationNodeId === destination) &&
      (status === "All Statuses" || item.status === status) &&
      (shade === "All Shades" || item.shade === shade),
  );
  useEffect(() => setPage(1), [query, source, destination, status, shade]);
  const visibleItems = items.slice((page - 1) * pageSize, page * pageSize);
  const summary = selected ?? items[0];
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["routes"] });
    await queryClient.invalidateQueries({ queryKey: ["logs"] });
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const save = async () => {
    if (!draft) return;
    setError("");
    try {
      await services.routes.save(draft);
      await refresh();
      setDialog(null);
      setNotice(`${draft.name} saved successfully.`);
      setSuccess(draft.name);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save route.",
      );
    }
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
    const committed = await services.imports.routes(importText, true);
    await refresh();
    setDialog(null);
    setNotice(`${committed.imported} routes imported successfully.`);
    setImportSuccess(committed.imported);
  };
  return (
    <div className="page">
      <div className="page-hero">
        <span className="page-icon">
          <img src={routesModuleIcon} alt="" />
        </span>
        <div>
          <h1>Manage Routes &amp; Paths</h1>
          <p>Create and manage connections between campus locations.</p>
        </div>
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl" role="alert">
          {error}
        </div>
      )}
      {success && (
        <Modal title="Pathway Saved" size="sm" onClose={() => setSuccess(null)}>
          <p className="text-xs text-[#3f4941] leading-relaxed">
            <strong className="text-[#191c1d]">{success}</strong> was successfully saved to the campus pathway network.
          </p>
          <div className="modal-actions">
            <Button variant="primary" onClick={() => setSuccess(null)}>Done</Button>
          </div>
        </Modal>
      )}
      {importSuccess !== null && (
        <Modal title="Pathways Imported" size="sm" onClose={() => setImportSuccess(null)}>
          <p className="text-xs text-[#3f4941] leading-relaxed">
            <strong className="text-[#191c1d]">{importSuccess} pathways</strong> were successfully imported into the campus network.
          </p>
          <div className="modal-actions">
            <Button variant="primary" onClick={() => setImportSuccess(null)}>Done</Button>
          </div>
        </Modal>
      )}
      <div className="routes-layout">
        <Card className="route-summary">
          <p className="eyebrow">SELECTED CONNECTION</p>
          <h2>{summary?.name ?? "Select a route connection"}</h2>
          <p>
            {summary
              ? `${summary.shade} · ${summary.distance} · ${summary.time}`
              : "Choose a row to inspect its path details."}
          </p>
          <hr />
          <Badge>
            {summary
              ? `${summary.status} · ${summary.direction} ${summary.type.toLowerCase()}`
              : "No connection selected"}
          </Badge>
          <div className="mini-route">
            <span>
              {summary?.sourceNodeId?.slice(0, 1).toUpperCase() ?? "S"}
            </span>
            <i />
            <span>
              {summary?.destinationNodeId?.slice(0, 1).toUpperCase() ?? "D"}
            </span>
          </div>
          <div className="route-preview" aria-label="Route geometry preview">
            <svg viewBox="0 0 220 90" role="img">
              <polyline
                points={
                  summary
                    ? `10,76 ${summary.pathPoints.map((_, index) => `${35 + ((index * 42) % 150)},${25 + (index % 2) * 35}`).join(" ")} 210,18`
                    : "10,76 110,45 210,18"
                }
              />
              <circle cx="10" cy="76" r="6" />
              <circle cx="210" cy="18" r="6" />
            </svg>
            <small>
              {summary
                ? `${summary.pathPoints.length} geometry point${summary.pathPoints.length === 1 ? "" : "s"}`
                : "No route selected"}
            </small>
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
                label="SOURCE"
                value={source}
                onChange={(event) => setSource(event.target.value)}
              >
                <option>All Sources</option>
                <option value="ccsict-entry">Main Gate</option>
                <option value="junction-a">Arts &amp; Sciences</option>
                <option value="student-entry">ISU Dormitory</option>
              </SelectField>
              <SelectField
                label="DESTINATION"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
              >
                <option>All Destinations</option>
                <option value="junction-a">Arts &amp; Sciences</option>
                <option value="student-entry">ISU Grandstand</option>
                <option value="library-entry">University Library</option>
              </SelectField>
              <SelectField
                label="STATUS"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option>All Statuses</option>
                <option>Open</option>
                <option>Closed</option>
              </SelectField>
              <SelectField
                label="SHADE"
                value={shade}
                onChange={(event) => setShade(event.target.value)}
              >
                <option>All Shades</option>
                <option>Fully Shaded</option>
                <option>Mostly Shaded</option>
                <option>Partial Shade</option>
                <option>Unshaded</option>
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
                {visibleItems.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => setSelected(item)}
                    className={
                      selected?.id === item.id ? "selected-row" : undefined
                    }
                  >
                    <td>
                      <strong>{item.name}</strong>
                      <small>
                        {item.direction} corridor · {item.distance}
                      </small>
                    </td>
                    <td>
                      {endpointLabels[item.id]?.[0] ?? item.sourceNodeId} →{" "}
                      {endpointLabels[item.id]?.[1] ?? item.destinationNodeId}
                    </td>
                    <td>
                      <Badge>{item.shade}</Badge>
                    </td>
                    <td>
                      <Badge>{item.status}</Badge>
                    </td>
                    <td>
                      <div className="row-actions">
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
                        <button
                          className="table-action menu-trigger"
                          aria-label={`Actions for ${item.name}`}
                          aria-expanded={actionMenuId === item.id}
                          onClick={() =>
                            setActionMenuId((current) =>
                              current === item.id ? null : item.id,
                            )
                          }
                        >
                          ⋯
                        </button>
                        {actionMenuId === item.id && (
                          <div className="row-action-menu" role="menu">
                            <button
                              role="menuitem"
                              onClick={() => {
                                setSelected(item);
                                setDraft({ ...item });
                                setDialog("edit");
                                setActionMenuId(null);
                              }}
                            >
                              Edit route
                            </button>
                            <button
                              className="danger-text"
                              role="menuitem"
                              onClick={() => {
                                setSelected(item);
                                setDialog("remove");
                                setActionMenuId(null);
                              }}
                            >
                              Delete route
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length && <Empty>No routes found.</Empty>}
          </div>
          <Pagination
            total={items.length}
            page={page}
            pageSize={pageSize}
            onChange={setPage}
          />
        </Card>
      </div>
      {(dialog === "add" || dialog === "edit") && draft && (
        <Modal
          title={dialog === "add" ? "Add Route / Path" : "Edit Route / Path"}
          subtitle="Connect two campus nodes for navigation."
          size="md"
          variant="green"
          onClose={() => setDialog(null)}
        >
          {error && (
            <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl" role="alert">
              {error}
            </div>
          )}
          <div className="form-grid-two">
            <SelectField
              label="SOURCE"
              required
              value={draft.sourceNodeId}
              subhelper="Required · must differ from destination"
              onChange={(event) =>
                setDraft({ ...draft, sourceNodeId: event.target.value })
              }
            >
              <option value="">Select source</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.nodeType})
                </option>
              ))}
            </SelectField>
            <SelectField
              label="DESTINATION"
              required
              value={draft.destinationNodeId}
              subhelper="Required · must differ from source"
              onChange={(event) =>
                setDraft({ ...draft, destinationNodeId: event.target.value })
              }
            >
              <option value="">Select destination</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.nodeType})
                </option>
              ))}
            </SelectField>
          </div>
          <div className="form-grid-two">
            <SelectField
              label="SHADE"
              required
              value={draft.shade}
              subhelper="No Shade · Partial Shade · Mostly Shaded · Fully Shaded · Indoor"
              onChange={(event) =>
                setDraft({ ...draft, shade: event.target.value as Shade })
              }
            >
              <option value="">Select shade</option>
              {["Fully Shaded", "Mostly Shaded", "Partial Shade", "Unshaded"].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </SelectField>
            <SelectField
              label="PATH TYPE"
              required
              value={draft.type || "Walkway"}
              subhelper="Walkway · Covered walkway · Stairs · Road crossing"
              onChange={(event) =>
                setDraft({ ...draft, type: event.target.value })
              }
            >
              <option value="">Select path type</option>
              {["Walkway", "Covered walkway", "Stairs", "Road crossing"].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </SelectField>
          </div>
          <div className="form-grid-two">
            <Field
              label="NOTES"
              value={draft.name}
              placeholder="Optional notes about this connection"
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
            <SelectField
              label="STATUS"
              required
              value={draft.status}
              subhelper="Open · Temporarily Closed · Under Maintenance · Restricted"
              onChange={(event) =>
                setDraft({
                  ...draft,
                  status: event.target.value as Pathway["status"],
                })
              }
            >
              <option value="Open">Open</option>
              <option value="Closed">Closed</option>
            </SelectField>
          </div>
          <div className="modal-actions">
            <Button variant="subtle" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button onClick={save}>Save Route</Button>
          </div>
        </Modal>
      )}
      {dialog === "remove" && (
        <Modal
          title="Delete Route?"
          subtitle="Permanently remove this connection from campus navigation."
          size="sm"
          variant="danger"
          onClose={() => setDialog(null)}
        >
          <p className="text-xs text-[#3f4941] leading-relaxed">
            Are you sure you want to remove <strong>{selected?.name}</strong> from the campus network?
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
        <Modal
          title="Import Pathways JSON"
          subtitle="Validate source and destination node references before committing."
          size="lg"
          variant="green"
          onClose={() => setDialog(null)}
        >
          <p className="text-xs text-[#3f4941]">
            Paste or upload a JSON array of pathway definitions.
          </p>
          <textarea
            className="json-input"
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder='[{"id":"path-1", "name":"Walkway 1", "sourceNodeId":"node-1", ...}]'
            rows={8}
          />
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept="application/json"
              className="text-xs text-[#3f4941]"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) file.text().then(setImportText);
              }}
            />
          </div>
          {importResult && (
            <div className={importResult.errors.length ? "p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl" : "notice"}>
              {importResult.errors.length
                ? importResult.errors.map((error) => (
                    <div key={error}>{error}</div>
                  ))
                : `Validation passed for ${importResult.imported} pathways.`}
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
              Commit Import
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
