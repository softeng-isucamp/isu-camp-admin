import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
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
import type { Location, LocationType } from "../../types";
import locationsModuleIcon from "../../assets/figma/modules/locations.svg";

const blankLocation = (): Location => ({
  id: `loc-${Date.now()}`,
  name: "",
  code: `LOC-${Date.now().toString().slice(-4)}`,
  type: "Facility",
  parentId: null,
  function: "Campus facility",
  keywords: "",
  status: "Active",
  lat: 16.7209,
  lng: 121.6894,
  positioned: false,
});

export function Locations() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const routeLocation = useLocation();
  useEffect(() => {
    const failure = new URLSearchParams(window.location.search).get(
      "mockFailure",
    );
    if (failure === "locationSave") {
      setMockFailure("locationSave", true);
      return () => setMockFailure("locationSave", false);
    }
    return undefined;
  }, []);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const q = new URLSearchParams(routeLocation.search).get("q");
    if (q !== null) setQuery(q);
  }, [routeLocation.search]);
  const [type, setType] = useState("All Types");
  const [status, setStatus] = useState("All Statuses");
  const [building, setBuilding] = useState("All Buildings");
  const [floor, setFloor] = useState("All Floors");
  const [dialog, setDialog] = useState<
    "add" | "import" | "edit" | "history" | "remove" | null
  >(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Location>(blankLocation());
  const [selected, setSelected] = useState<Location | null>(null);
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<{
    imported: number;
    errors: string[];
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [success, setSuccess] = useState<{
    name: string;
    kind: "added" | "edited";
  } | null>(null);
  const [importSuccess, setImportSuccess] = useState<number | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["locations", query],
    queryFn: () => services.locations.list(query),
  });
  const { data: directory } = useQuery({
    queryKey: ["locations", "directory"],
    queryFn: () => services.locations.list(),
  });
  const allLocations = directory?.items ?? [];
  const buildingOptions = [
    ...new Set(allLocations.map((item) => item.building).filter(Boolean)),
  ] as string[];
  const floorOptions = [
    ...new Set(allLocations.map((item) => item.floor).filter(Boolean)),
  ] as string[];
  const items = (data?.items ?? []).filter(
    (item) =>
      (type === "All Types" || item.type === type) &&
      (status === "All Statuses" || item.status === status) &&
      (building === "All Buildings" || item.building === building) &&
      (floor === "All Floors" || item.floor === floor),
  );
  useEffect(() => setPage(1), [query, type, status, building, floor]);
  const visibleItems = items.slice((page - 1) * pageSize, page * pageSize);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["locations"] });
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["logs"] });
  };
  const save = async () => {
    setError("");
    const adding = dialog === "add";
    try {
      await services.locations.save(draft);
      await refresh();
      setDialog(null);
      setNotice(`${draft.name || "Location"} saved successfully.`);
      setSuccess({
        name: draft.name || "Location",
        kind: adding ? "added" : "edited",
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save location.",
      );
    }
  };
  const remove = async () => {
    if (!selected) return;
    await services.locations.remove(selected.id);
    await refresh();
    setDialog(null);
    setNotice(`${selected.name} removed successfully.`);
  };
  const validateImport = async () => {
    setImportResult(await services.imports.locations(importText));
  };
  const applyImport = async () => {
    if (!importResult || importResult.errors.length) return;
    const committed = await services.imports.locations(importText, true);
    await refresh();
    setDialog(null);
    setNotice(`${committed.imported} locations imported successfully.`);
    setImportSuccess(committed.imported);
  };
  const openEdit = (item: Location) => {
    setSelected(item);
    setDraft({ ...item });
    setDialog("edit");
  };
  return (
    <div className="page">
      <div className="page-hero">
        <span className="page-icon">
          <img src={locationsModuleIcon} alt="" />
        </span>
        <div>
          <h1>Campus Locations</h1>
          <p>
            Manage buildings, floors, rooms, offices, laboratories, restrooms,
            and facilities.
          </p>
        </div>
      </div>
      <Card className="filters">
        <Field
          label=""
          aria-label="Search locations"
          placeholder="Search by building, room, office, lab, facility, or keyword..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <SelectField
          label="TYPE"
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          <option>All Types</option>
          {[
            "Building",
            "Floor",
            "Room",
            "Office",
            "Laboratory",
            "Restroom",
            "Facility",
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </SelectField>
        <SelectField
          label="BUILDING"
          value={building}
          onChange={(event) => setBuilding(event.target.value)}
        >
          <option>All Buildings</option>
          {buildingOptions.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </SelectField>
        <SelectField
          label="FLOOR"
          value={floor}
          onChange={(event) => setFloor(event.target.value)}
        >
          <option>All Floors</option>
          {floorOptions.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </SelectField>
        <SelectField
          label="STATUS"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option>All Statuses</option>
          <option>Active</option>
          <option>Inactive</option>
        </SelectField>
        <Button
          onClick={() => {
            setDraft(blankLocation());
            setDialog("add");
          }}
        >
          ＋ Add Location
        </Button>
      </Card>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {success && (
        <Modal
          title={
            success.kind === "added" ? "Location Added" : "Location Updated"
          }
          onClose={() => setSuccess(null)}
        >
          <p className="muted">
            <strong>{success.name}</strong> was{" "}
            {success.kind === "added" ? "added to" : "updated in"} the campus
            directory successfully.
          </p>
          <div className="modal-actions">
            <Button onClick={() => setSuccess(null)}>Done</Button>
          </div>
        </Modal>
      )}
      {importSuccess !== null && (
        <Modal
          title="Locations Imported"
          onClose={() => setImportSuccess(null)}
        >
          <p className="muted">
            <strong>{importSuccess} locations</strong> were imported into the
            campus directory successfully.
          </p>
          <div className="modal-actions">
            <Button onClick={() => setImportSuccess(null)}>Done</Button>
          </div>
        </Modal>
      )}
      <Card className="table-card">
        <div className="table-heading">
          <div>
            <h2>Location Directory</h2>
            <p>
              {isLoading ? "Loading…" : `Showing ${items.length} locations`}
            </p>
          </div>
          <Button
            variant="subtle"
            onClick={() => {
              setImportText("");
              setImportResult(null);
              setDialog("import");
            }}
          >
            ⇧ Import JSON
          </Button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>LOCATION</th>
                <th>TYPE</th>
                <th>FUNCTION</th>
                <th>KEYWORDS</th>
                <th>STATUS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                    <small>{item.code}</small>
                    <small>
                      {item.parentId
                        ? `Child of ${item.parentId}`
                        : "Top-level campus record"}
                    </small>
                  </td>
                  <td>
                    <Badge>{item.type}</Badge>
                  </td>
                  <td>{item.function || "—"}</td>
                  <td className="muted">{item.keywords || "—"}</td>
                  <td>
                    <Badge>{item.status}</Badge>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="table-action"
                        title="Locate on map"
                        onClick={() =>
                          navigate(`/map-editor?location=${item.id}`)
                        }
                      >
                        ⌖
                      </button>
                      <button
                        className="table-action"
                        title="Edit location"
                        onClick={() => openEdit(item)}
                      >
                        ✎
                      </button>
                      <button
                        className="table-action"
                        title="View location history"
                        onClick={() => {
                          setSelected(item);
                          setDialog("history");
                        }}
                      >
                        ↺
                      </button>
                      <button
                        className="table-action danger-text"
                        title="Delete location"
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
                              navigate(`/map-editor?location=${item.id}`);
                              setActionMenuId(null);
                            }}
                          >
                            Locate on map
                          </button>
                          <button
                            role="menuitem"
                            onClick={() => {
                              openEdit(item);
                              setActionMenuId(null);
                            }}
                          >
                            Edit location
                          </button>
                          <button
                            role="menuitem"
                            onClick={() => {
                              setSelected(item);
                              setDialog("history");
                              setActionMenuId(null);
                            }}
                          >
                            View history
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
                            Delete location
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && (
            <Empty>No campus location records matching filter criteria.</Empty>
          )}
        </div>
        <Pagination
          total={items.length}
          page={page}
          pageSize={pageSize}
          onChange={setPage}
        />
      </Card>
      {(dialog === "add" || dialog === "edit") && (
        <Modal
          title={dialog === "add" ? "Add Location" : "Edit Location"}
          subtitle="Add a building, floor, room, office, laboratory, restroom, or facility."
          icon={<img src={locationsModuleIcon} alt="" className="w-5 h-5 brightness-0 invert" />}
          size="lg"
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
              label="LOCATION TYPE"
              required
              value={draft.type}
              onChange={(event) =>
                setDraft({ ...draft, type: event.target.value as LocationType })
              }
            >
              {[
                "Laboratory",
                "Room",
                "Office",
                "Facility",
                "Building",
                "Floor",
                "Restroom",
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </SelectField>
            <SelectField
              label="STATUS"
              required
              value={draft.status}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  status: event.target.value as Location["status"],
                })
              }
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </SelectField>
          </div>
          <div className="form-grid-two">
            <Field
              label="LOCATION NAME"
              required
              value={draft.name}
              placeholder="Computer Lab 1"
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
            <Field
              label="LOCATION CODE / ID"
              required
              value={draft.code}
              placeholder="LAB-CCSICT-201"
              onChange={(event) =>
                setDraft({ ...draft, code: event.target.value })
              }
            />
          </div>
          <div className="form-grid-two">
            <SelectField
              label="PARENT BUILDING"
              value={draft.building ?? ""}
              subhelper="Required for rooms, offices, laboratories, restrooms, and facilities."
              onChange={(event) =>
                setDraft({
                  ...draft,
                  building: event.target.value || undefined,
                })
              }
            >
              <option value="">Select building</option>
              {buildingOptions.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </SelectField>
            <SelectField
              label="PARENT FLOOR"
              value={draft.floor ?? ""}
              onChange={(event) =>
                setDraft({ ...draft, floor: event.target.value || undefined })
              }
            >
              <option value="">Select floor</option>
              {["Ground Floor", "Floor 1", "Floor 2", "Floor 3", "Floor 4"].map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </SelectField>
          </div>
          <Field
            label="FUNCTION / PURPOSE"
            required
            value={draft.function}
            placeholder="Programming and computer-based activities"
            onChange={(event) =>
              setDraft({ ...draft, function: event.target.value })
            }
          />
          <Field
            label="DESCRIPTION"
            value={draft.keywords ? `A ${draft.type.toLowerCase()} used for ${draft.function?.toLowerCase() || 'campus activities'}.` : ""}
            placeholder="A computer laboratory used for programming, software development, and hands-on IT exercises."
            onChange={(event) =>
              setDraft({ ...draft, function: event.target.value })
            }
          />
          <Field
            label="KEYWORDS / TAGS"
            value={draft.keywords ?? ""}
            placeholder="programming, coding, computer lab"
            onChange={(event) =>
              setDraft({ ...draft, keywords: event.target.value })
            }
          />
          <div className="field-group">
            <div className="field-label-row">
              <span className="field-label">PHOTO / IMAGE UPLOAD</span>
            </div>
            <label className="border border-dashed border-[#c2d4cb] bg-[#f4f7f5] hover:bg-[#ebf2ee] rounded-2xl p-3.5 flex items-center justify-between cursor-pointer transition">
              <div className="flex items-center gap-2.5 text-xs font-semibold text-[#3f4941]">
                <svg className="w-4 h-4 text-[#005931]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span>Upload a campus location photo or image</span>
              </div>
              <span className="text-[10px] text-[#64716a] font-mono font-medium">PNG, JPG, or WEBP</span>
              <input type="file" accept="image/*" className="hidden" />
            </label>
          </div>
          {dialog === "edit" && (
            <div className="record-information">
              <strong>RECORD INFORMATION</strong>
              <span>Created Aug 10, 2026 · 9:15 AM</span>
              <span>Last updated Aug 17, 2026 · 2:05 PM</span>
            </div>
          )}
          <div className="modal-actions">
            <Button variant="subtle" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button onClick={save}>
              Save Location
            </Button>
          </div>
        </Modal>
      )}
      {dialog === "remove" && (
        <Modal
          title="Delete Location?"
          subtitle="This action will permanently remove the record from campus directories."
          size="sm"
          variant="danger"
          onClose={() => setDialog(null)}
        >
          <p className="text-xs text-[#3f4941] leading-relaxed">
            Are you sure you want to remove <strong>{selected?.name}</strong>?
          </p>
          <div className="modal-actions">
            <Button variant="subtle" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove}>
              Delete Location
            </Button>
          </div>
        </Modal>
      )}
      {dialog === "history" && selected && (
        <Modal
          title="Location History"
          subtitle={`Structural lineage and changes for ${selected.name}`}
          size="md"
          variant="green"
          onClose={() => setDialog(null)}
        >
          <div className="history-list">
            <div>
              <small>Aug 10, 2026 · 9:15 AM</small>
              <strong>Created Location</strong>
              <span>
                {selected.parentId
                  ? `Parent: ${selected.parentId}`
                  : "Top-level campus record"}
              </span>
            </div>
            <div>
              <small>Aug 17, 2026 · 2:05 PM</small>
              <strong>Updated Directory Metadata</strong>
              <span>
                {selected.function || "No function description recorded."}
              </span>
            </div>
            <div>
              <small>Current hierarchy</small>
              <strong>
                {selected.parentId
                  ? `Nested under ${selected.parentId}`
                  : "Campus root"}
              </strong>
              <span>
                {selected.building || "Building not assigned"} ·{" "}
                {selected.floor || "Floor not assigned"}
              </span>
            </div>
          </div>
          <div className="modal-actions">
            <Button variant="subtle" onClick={() => setDialog(null)}>Close</Button>
          </div>
        </Modal>
      )}
      {dialog === "import" && (
        <Modal
          title="Import Locations JSON"
          subtitle="Transactional import of campus location definitions."
          size="lg"
          variant="green"
          onClose={() => setDialog(null)}
        >
          <p className="text-xs text-[#3f4941]">
            Paste or upload a JSON array of location records. Parent references and coordinates will be validated.
          </p>
          <textarea
            className="json-input"
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder='[{"id":"loc-1", "name":"Multimedia Lab", "type":"Laboratory", ...}]'
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
                : `Validation passed for ${importResult.imported} locations.`}
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
