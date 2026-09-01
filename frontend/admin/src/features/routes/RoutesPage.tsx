import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { pathways as initialPathways } from "../../services/mockData";
import routesModuleIcon from "../../assets/figma/modules/routes.svg";
import { RouteDetailsModal } from "./RouteDetailsModal";

const endpointLabels: Record<string, [string, string]> = {
  "ccsict-junction": ["Main Gate", "Arts & Sciences"],
  "junction-student": ["ISU Dormitory", "ISU Grandstand"],
  "junction-library": ["College of Medicine", "University Library"],
};

export function RoutesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
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
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setActionMenuId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

  const rawPathways = data?.items ?? initialPathways;
  const items = rawPathways.filter(
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

  const save = async (nextDraft: Pathway | null = draft) => {
    if (!nextDraft) return;
    setError("");
    try {
      await services.routes.save(nextDraft);
      await refresh();
      setDialog(null);
      setNotice(`${nextDraft.name} saved successfully.`);
      setSuccess(nextDraft.name);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save route.",
      );
    }
  };

  const remove = async () => {
    if (!selected) return;
    await services.routes.remove(selected.id, true);
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
    <div className="page routes-page">
      <div className="page-hero">
        <span className="page-icon" style={{ background: "#d6ede0", borderRadius: "12px", width: "48px", height: "48px", display: "grid", placeItems: "center" }}>
          <img src={routesModuleIcon} alt="" style={{ width: "24px", height: "24px" }} />
        </span>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: "bold", margin: "0", color: "#191c1d" }}>Manage Routes &amp; Paths</h1>
          <p style={{ color: "#525c57", marginTop: "4px", fontSize: "15px" }}>Create and manage connections between campus locations.</p>
        </div>
      </div>

      {notice && (
        <div className="notice" role="status" style={{ background: "#e6f7ec", color: "#0c7441", padding: "10px 16px", borderRadius: "12px" }}>
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
        <Card className="route-summary" style={{ borderRadius: "20px" }}>
          <p className="eyebrow">SELECTED CONNECTION</p>
          <h2 style={{ fontSize: "20px", fontWeight: "bold", margin: "6px 0 2px" }}>{summary?.name ?? "Select a route connection"}</h2>
          <p style={{ color: "#6b7280", fontSize: "13px", margin: "0 0 12px" }}>
            {summary
              ? `${summary.shade} · ${summary.distance} · ${summary.time}`
              : "Choose a row to inspect its path details."}
          </p>
          <hr style={{ borderColor: "#f3f4f6", margin: "12px 0" }} />
          <Badge>
            {summary
              ? `${summary.status} · ${summary.direction} ${summary.type.toLowerCase()}`
              : "No connection selected"}
          </Badge>
          <div className="mini-route" style={{ margin: "16px 0" }}>
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
          <Button
            variant="subtle"
            disabled={!summary}
            onClick={() => summary && navigate(`/map-editor?pathway=${encodeURIComponent(summary.id)}`)}
          >
            Open in Map Editor
          </Button>
        </Card>

        <Card className="table-card" style={{ background: "#fff", borderRadius: "20px", overflow: "visible" }}>
          <div className="table-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: "1px solid #e5e7eb", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <h2 style={{ fontSize: "18px", fontWeight: "bold", margin: "0", color: "#191c1d" }}>Routes &amp; Paths</h2>
              <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: "14px" }}>{items.length} connections</p>
            </div>
            <div className="inline-fields" style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
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
                <option>Unknown</option>
              </SelectField>
              <Button
                variant="subtle"
                style={{ height: "46px", borderRadius: "999px", padding: "0 18px", border: "1px solid #0c7441", color: "#0c7441", display: "inline-flex", alignItems: "center", gap: "8px" }}
                onClick={() => {
                  setImportText("");
                  setImportResult(null);
                  setDialog("import");
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                Import JSON
              </Button>
              <Button
                style={{ height: "46px", borderRadius: "999px", padding: "0 22px", background: "#005931", color: "#fff" }}
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

          <div className="table-wrap" style={{ overflow: "visible", minHeight: "220px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb", color: "#4b5563", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  <th style={{ padding: "14px 20px" }}>ROUTE / PATH</th>
                  <th style={{ padding: "14px 20px" }}>SOURCE → DESTINATION</th>
                  <th style={{ padding: "14px 20px" }}>SHADE</th>
                  <th style={{ padding: "14px 20px" }}>STATUS</th>
                  <th style={{ padding: "14px 20px", textAlign: "right" }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item, index) => {
                  const isNearBottom = index >= 3 && index >= visibleItems.length - 2;
                  return (
                  <tr
                    key={item.id}
                    onClick={() => setSelected(item)}
                    className={
                      selected?.id === item.id ? "selected-row" : undefined
                    }
                    style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}
                  >
                    <td style={{ padding: "16px 20px" }}>
                      <strong style={{ display: "block", fontSize: "14px", color: "#111827" }}>{item.name}</strong>
                      <small style={{ color: "#6b7280", fontSize: "12px" }}>
                        {item.direction} corridor · {item.distance}
                      </small>
                    </td>
                    <td style={{ padding: "16px 20px", color: "#374151", fontSize: "14px" }}>
                      {endpointLabels[item.id]?.[0] ?? item.sourceNodeId} →{" "}
                      {endpointLabels[item.id]?.[1] ?? item.destinationNodeId}
                    </td>
                    <td style={{ padding: "16px 20px" }}>
                      <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 500, background: "#d6ede0", color: "#0c7441" }}>
                        {item.shade}
                      </span>
                    </td>
                    <td style={{ padding: "16px 20px" }}>
                      <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 500, background: item.status === "Open" ? "#e6f7ec" : "#fee2e2", color: item.status === "Open" ? "#0c7441" : "#dc2626" }}>
                        {item.status}
                      </span>
                    </td>
                    <td style={{ padding: "16px 20px", textAlign: "right", position: "relative" }}>
                      <div style={{ display: "inline-flex", gap: "6px" }} ref={actionMenuId === item.id ? actionMenuRef : undefined}>
                        <button
                          className="table-action menu-trigger"
                          aria-label={`Actions for ${item.name}`}
                          aria-expanded={actionMenuId === item.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActionMenuId((current) => (current === item.id ? null : item.id));
                          }}
                          style={{ background: "#f3f4f6", border: "none", borderRadius: "8px", width: "34px", height: "34px", cursor: "pointer", fontSize: "16px", color: "#4b5563" }}
                        >
                          •••
                        </button>
                        {actionMenuId === item.id && (
                          <div
                            className="row-action-menu"
                            role="menu"
                            style={{
                              position: "absolute",
                              right: "20px",
                              top: isNearBottom ? "auto" : "44px",
                              bottom: isNearBottom ? "44px" : "auto",
                              background: "#fff",
                              borderRadius: "14px",
                              boxShadow: "0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1)",
                              zIndex: 40,
                              padding: "6px",
                              minWidth: "165px",
                              border: "1px solid #e5e7eb",
                              textAlign: "left",
                            }}
                          >
                            <button
                              role="menuitem"
                              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", fontSize: "13px", cursor: "pointer", borderRadius: "8px", color: "#191c1d" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelected(item);
                                setDraft({ ...item });
                                setDialog("edit");
                                setActionMenuId(null);
                              }}
                            >
                              Edit route
                            </button>
                            <button
                              role="menuitem"
                              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", fontSize: "13px", cursor: "pointer", borderRadius: "8px", color: "#191c1d" }}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setSelected(item);
                                setActionMenuId(null);
                                try {
                                  await (item.status === "Open" ? services.routes.close(item.id) : services.routes.reopen(item.id));
                                  await refresh();
                                  setNotice(`${item.name} ${item.status === "Open" ? "closed" : "reopened"} successfully.`);
                                } catch (cause) {
                                  setError(cause instanceof Error ? cause.message : "Unable to update Pathway lifecycle.");
                                }
                              }}
                            >
                              {item.status === "Open" ? "Close pathway" : "Reopen pathway"}
                            </button>
                            <button
                              role="menuitem"
                              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", fontSize: "13px", color: "#dc2626", cursor: "pointer", borderRadius: "8px" }}
                              onClick={(e) => {
                                e.stopPropagation();
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
                  );
                })}
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
        <RouteDetailsModal
          entity={{ kind: "pathway", value: draft }}
          nodes={nodes}
          locations={[]}
          mode={dialog}
          lockSpatialFields={false}
          submitError={error}
          onClose={() => setDialog(null)}
          onSubmit={(entity) => save(entity as Pathway)}
        />
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
