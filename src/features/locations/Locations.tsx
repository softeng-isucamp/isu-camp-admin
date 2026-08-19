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
import type { Location, LocationType } from "../../types";

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
  const [query, setQuery] = useState("");
  const [type, setType] = useState("All Types");
  const [status, setStatus] = useState("All Statuses");
  const [building, setBuilding] = useState("All Buildings");
  const [floor, setFloor] = useState("All Floors");
  const [dialog, setDialog] = useState<
    "add" | "import" | "edit" | "history" | "remove" | null
  >(null);
  const [draft, setDraft] = useState<Location>(blankLocation());
  const [selected, setSelected] = useState<Location | null>(null);
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<{
    imported: number;
    errors: string[];
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
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
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["locations"] });
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["logs"] });
  };
  const save = async () => {
    setError("");
    try {
      await services.locations.save(draft);
      await refresh();
      setDialog(null);
      setNotice(`${draft.name || "Location"} saved successfully.`);
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
  };
  const openEdit = (item: Location) => {
    setSelected(item);
    setDraft({ ...item });
    setDialog("edit");
  };
  return (
    <div className="page">
      <div className="page-hero">
        <span className="page-icon">▤</span>
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
              {items.map((item) => (
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
                    <button className="table-action" title="Locate on map">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && (
            <Empty>No campus location records matching filter criteria.</Empty>
          )}
        </div>
        <Pagination total={items.length} />
      </Card>
      {(dialog === "add" || dialog === "edit") && (
        <Modal
          title={dialog === "add" ? "Add Location" : "Edit Location"}
          onClose={() => setDialog(null)}
        >
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <Field
            label="LOCATION NAME"
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            placeholder="e.g. Student Innovation Center"
          />
          <Field
            label="CODE"
            value={draft.code}
            onChange={(event) =>
              setDraft({ ...draft, code: event.target.value })
            }
          />
          <SelectField
            label="TYPE"
            value={draft.type}
            onChange={(event) =>
              setDraft({ ...draft, type: event.target.value as LocationType })
            }
          >
            {[
              "Facility",
              "Building",
              "Floor",
              "Room",
              "Office",
              "Laboratory",
              "Restroom",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </SelectField>
          <Field
            label="FUNCTION"
            value={draft.function}
            onChange={(event) =>
              setDraft({ ...draft, function: event.target.value })
            }
          />
          <div className="modal-actions">
            <Button variant="subtle" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button onClick={save}>Save Location</Button>
          </div>
        </Modal>
      )}
      {dialog === "remove" && (
        <Modal title="Delete Location?" onClose={() => setDialog(null)}>
          <p>
            This action will remove <strong>{selected?.name}</strong> and its
            directory record.
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
        <Modal title="Location History" onClose={() => setDialog(null)}>
          <p className="muted">
            Hierarchy and administrative changes for{" "}
            <strong>{selected.name}</strong>.
          </p>
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
            <Button onClick={() => setDialog(null)}>Close</Button>
          </div>
        </Modal>
      )}
      {dialog === "import" && (
        <Modal title="Import Locations JSON" onClose={() => setDialog(null)}>
          <p className="muted">
            Paste or upload a JSON array. Parent references are checked before
            import.
          </p>
          <textarea
            className="json-input"
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder='[{"id":"loc-1", ...}]'
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
              Import
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
