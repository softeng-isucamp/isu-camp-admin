import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { services, setMockFailure } from "../../services/api";
import {
  Button,
  Card,
  Empty,
  Field,
  Pagination,
  SelectField,
} from "../../components/UI";
import type { Location, LocationType } from "../../types";
import { locations as initialLocations } from "../../services/mockData";
import locationsModuleIcon from "../../assets/figma/modules/locations.svg";

const blankLocation = (): Location => ({
  id: `loc-${Date.now()}`,
  name: "",
  code: `LOC-${Date.now().toString().slice(-4)}`,
  type: "Laboratory",
  parentId: null,
  building: "CCSICT Building",
  floor: "Floor 2",
  function: "Academic and laboratory activities",
  keywords: "",
  status: "Active",
  lat: 16.72102,
  lng: 121.68929,
  positioned: true,
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
  const [viewMode, setViewMode] = useState<"hierarchy" | "flat">("hierarchy");
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());

  const [dialog, setDialog] = useState<
    "add" | "import" | "edit" | "history" | "remove" | null
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

  const [draft, setDraft] = useState<Location>(blankLocation());
  const [selected, setSelected] = useState<Location | null>(null);
  const [importText, setImportText] = useState("");
  const [importMode, setImportMode] = useState<"add" | "update">("add");
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
    building?: string;
    floor?: string;
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

  const allLocations = directory?.items ?? data?.items ?? initialLocations;
  const buildingOptions = [
    ...new Set(allLocations.map((item) => item.building).filter(Boolean)),
  ] as string[];
  const floorOptions = [
    ...new Set(
      allLocations
        .map((item) => item.floor)
        .concat(allLocations.filter((i) => i.type === "Floor").map((i) => i.name))
        .concat(["2nd Floor", "Floor 2"])
        .filter(Boolean),
    ),
  ] as string[];

  const rawItems = data?.items ?? initialLocations;
  const items = useMemo(() => {
    return rawItems.filter(
      (item) =>
        (type === "All Types" || item.type === type) &&
        (status === "All Statuses" || status === "All Status" || item.status === status) &&
        (building === "All Buildings" || item.building === building || item.name === building) &&
        (floor === "All Floors" ||
          item.floor === floor ||
          item.name === floor ||
          (floor === "2nd Floor" && (item.floor === "Floor 2" || item.name === "Floor 2" || item.parentId === "flr-ccsict-2")) ||
          (floor === "Floor 2" && (item.floor === "2nd Floor" || item.name === "2nd Floor" || item.parentId === "flr-ccsict-2"))),
    );
  }, [rawItems, type, status, building, floor]);

  useEffect(() => setPage(1), [query, type, status, building, floor]);

  // Build hierarchy tree
  const hierarchyRows = useMemo(() => {
    if (viewMode === "flat") return items.map((item) => ({ item, level: 0, hasChildren: false, isLast: false, isCollapsed: false }));

    const result: Array<{ item: Location; level: number; hasChildren: boolean; isLast: boolean; isCollapsed: boolean }> = [];

    // Find roots
    const rootBuildings = items.filter((loc) => loc.type === "Building");
    const standalone = items.filter((loc) => loc.parentId === null && loc.type !== "Building");

    for (const bldg of rootBuildings) {
      const bldgCollapsed = collapsedNodes.has(bldg.id);
      const childFloors = allLocations.filter((loc) => loc.parentId === bldg.id || (loc.building === bldg.name && loc.type === "Floor"));
      result.push({ item: bldg, level: 0, hasChildren: childFloors.length > 0, isLast: false, isCollapsed: bldgCollapsed });

      if (!bldgCollapsed) {
        childFloors.forEach((flr, flrIndex) => {
          const flrCollapsed = collapsedNodes.has(flr.id);
          const childRooms = allLocations.filter(
            (loc) => loc.parentId === flr.id || (loc.building === bldg.name && loc.floor === flr.name && loc.type !== "Floor" && loc.type !== "Building")
          );
          result.push({
            item: flr,
            level: 1,
            hasChildren: childRooms.length > 0,
            isLast: flrIndex === childFloors.length - 1,
            isCollapsed: flrCollapsed,
          });

          if (!flrCollapsed) {
            childRooms.forEach((rm, rmIndex) => {
              result.push({
                item: rm,
                level: 2,
                hasChildren: false,
                isLast: rmIndex === childRooms.length - 1,
                isCollapsed: false,
              });
            });
          }
        });
      }
    }

    // Add standalone items
    for (const s of standalone) {
      result.push({ item: s, level: 0, hasChildren: false, isLast: false, isCollapsed: false });
    }

    // If filter produced items not in tree, include them
    const includedIds = new Set(result.map((r) => r.item.id));
    for (const item of items) {
      if (!includedIds.has(item.id)) {
        result.push({ item, level: 0, hasChildren: false, isLast: false, isCollapsed: false });
      }
    }

    return result;
  }, [items, allLocations, viewMode, collapsedNodes]);

  const visibleRows = hierarchyRows.slice((page - 1) * pageSize, page * pageSize);

  const toggleCollapse = (id: string) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
        building: draft.building,
        floor: draft.floor,
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

  const renderLocationTypeIcon = (locType: string) => {
    switch (locType.toLowerCase()) {
      case "building":
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0c7441" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 21h18M4 18h16M6 18V9M10 18V9M14 18V9M18 18V9M12 3l9 4.5H3L12 3z" />
          </svg>
        );
      case "floor":
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0c7441" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
        );
      case "laboratory":
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0c7441" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 2v7.5L4.5 19.5A2 2 0 0 0 6.2 22h11.6a2 2 0 0 0 1.7-2.5L14 9.5V2" />
            <line x1="8.5" y1="2" x2="15.5" y2="2" />
            <path d="M7 16h10" />
          </svg>
        );
      case "room":
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0c7441" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" />
            <circle cx="15" cy="12" r="1.5" fill="#0c7441" />
          </svg>
        );
      case "office":
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0c7441" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
          </svg>
        );
      case "restroom":
      case "restroom / cr":
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0c7441" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="4" r="2" />
            <path d="M6 9h6l-1 9H7L6 9z" />
            <circle cx="17" cy="4" r="2" />
            <path d="M15 9h4l1 9h-2l-.5-5-.5 5h-2z" />
          </svg>
        );
      default:
        return (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0c7441" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
        );
    }
  };

  return (
    <div className="page locations-page">
      <div className="page-hero">
        <span className="page-icon" style={{ background: "#d6ede0", borderRadius: "12px", width: "48px", height: "48px", display: "grid", placeItems: "center" }}>
          <img src={locationsModuleIcon} alt="" style={{ width: "24px", height: "24px" }} />
        </span>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: "bold", margin: "0", color: "#191c1d" }}>Campus Locations</h1>
          <p style={{ color: "#525c57", marginTop: "4px", fontSize: "15px" }}>
            Manage buildings, floors, rooms, offices, laboratories, restrooms, and facilities.
          </p>
        </div>
      </div>

      <Card className="filters" style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center", padding: "16px 20px" }}>
        <div style={{ flex: "1 1 320px", minWidth: "260px" }}>
          <Field
            label=""
            aria-label="Search locations"
            placeholder="Search by building, room, office, lab, facility, or keyword..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <SelectField
          label="TYPE"
          aria-label="TYPE"
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          <option>All Types</option>
          {[
            "Building",
            "Floor",
            "Laboratory",
            "Room",
            "Office",
            "Restroom",
            "Facility",
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </SelectField>
        <SelectField
          label="BUILDING"
          aria-label="BUILDING"
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
          aria-label="FLOOR"
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
          aria-label="STATUS"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option>All Statuses</option>
          <option>Active</option>
          <option>Inactive</option>
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
            setDraft(blankLocation());
            setDialog("add");
          }}
        >
          ＋ Add Location
        </Button>
      </Card>

      {notice && (
        <div className="notice" role="status" style={{ background: "#e6f7ec", color: "#0c7441", padding: "10px 16px", borderRadius: "12px" }}>
          {notice}
        </div>
      )}
      {error && (
        <div className="error" role="alert" style={{ background: "#fee2e2", color: "#dc2626", padding: "10px 16px", borderRadius: "12px" }}>
          {error}
        </div>
      )}

      {/* Success Dialogs */}
      {success && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ background: "#fff", borderRadius: "28px", padding: "32px", width: "480px", maxWidth: "90%", textAlign: "center", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <div style={{ width: "54px", height: "54px", background: "#d6ede0", color: "#0c7441", borderRadius: "50%", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 style={{ fontSize: "24px", color: "#191c1d", margin: "0 0 8px" }}>
              {success.kind === "added" ? "Location added" : "Location updated"}
            </h2>
            <p style={{ color: "#525c57", fontSize: "15px", margin: "0 0 24px" }}>
              <strong>{success.name}</strong> was {success.kind === "added" ? "added" : "updated"}
              {success.building ? ` under ${success.building}${success.floor ? ` / ${success.floor}` : ""}.` : "."}
            </p>
            <Button style={{ width: "100%", background: "#0c7441", color: "#fff", height: "48px", borderRadius: "999px" }} onClick={() => setSuccess(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {importSuccess !== null && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ background: "#fff", borderRadius: "28px", padding: "32px", width: "480px", maxWidth: "90%", textAlign: "center" }}>
            <div style={{ width: "54px", height: "54px", background: "#d6ede0", color: "#0c7441", borderRadius: "50%", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 style={{ fontSize: "24px", color: "#191c1d", margin: "0 0 8px" }}>Locations Imported</h2>
            <p style={{ color: "#525c57", fontSize: "15px", margin: "0 0 24px" }}>
              <strong>{importSuccess} locations</strong> were imported into the campus directory successfully.
            </p>
            <Button style={{ width: "100%", background: "#0c7441", color: "#fff", height: "48px", borderRadius: "999px" }} onClick={() => setImportSuccess(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {/* Main Table Card */}
      <Card className="table-card" style={{ background: "#fff", borderRadius: "20px", overflow: "visible" }}>
        <div className="table-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: "1px solid #e5e7eb" }}>
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: "bold", margin: "0", color: "#191c1d" }}>Location Directory</h2>
            <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: "14px" }}>
              {isLoading ? "Loading…" : `${hierarchyRows.length} locations`}
            </p>
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <button
              type="button"
              className="btn btn-subtle"
              style={{ padding: "8px 16px", borderRadius: "999px", fontSize: "13px", fontWeight: 600, border: "1px solid #d1d5db" }}
              aria-label="Toggle view mode"
              onClick={() => setViewMode(viewMode === "hierarchy" ? "flat" : "hierarchy")}
            >
              {viewMode === "hierarchy" ? "Switch to Flat View" : "Switch to Hierarchy View"}
            </button>
          </div>
        </div>

        <div className="table-wrap" style={{ overflowX: "visible" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb", color: "#4b5563", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                <th style={{ padding: "14px 20px" }}>NAME & ID</th>
                <th style={{ padding: "14px 20px" }}>TYPE</th>
                <th style={{ padding: "14px 20px" }}>FUNCTION / PURPOSE</th>
                <th style={{ padding: "14px 20px" }}>KEYWORDS</th>
                <th style={{ padding: "14px 20px" }}>STATUS</th>
                <th style={{ padding: "14px 20px", textAlign: "right" }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(({ item, level, hasChildren, isCollapsed }) => (
                <tr key={item.id} style={{ borderBottom: "1px solid #f3f4f6", transition: "background 0.15s" }}>
                  <td style={{ padding: "16px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", paddingLeft: `${level * 28}px` }}>
                      {/* Tree connector graphics */}
                      {level === 1 && (
                        <div style={{ display: "flex", alignItems: "center", marginRight: "10px", width: "20px" }}>
                          <div style={{ width: "14px", height: "30px", borderLeft: "2px solid #cbd5e1", borderBottom: "2px solid #cbd5e1", borderBottomLeftRadius: "6px", marginTop: "-16px" }} />
                        </div>
                      )}
                      {level === 2 && (
                        <div style={{ display: "flex", alignItems: "center", marginRight: "10px", width: "32px" }}>
                          <div style={{ width: "2px", height: "48px", background: "#cbd5e1", marginRight: "12px", marginTop: "-16px" }} />
                          <div style={{ width: "14px", height: "30px", borderLeft: "2px solid #cbd5e1", borderBottom: "2px solid #cbd5e1", borderBottomLeftRadius: "6px", marginTop: "-16px" }} />
                        </div>
                      )}
                      {hasChildren && (
                        <button
                          type="button"
                          aria-label={isCollapsed ? `Expand ${item.name}` : `Collapse ${item.name}`}
                          onClick={() => toggleCollapse(item.id)}
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            padding: "4px",
                            marginRight: "6px",
                            color: "#4b5563",
                            fontSize: "12px",
                            display: "grid",
                            placeItems: "center",
                          }}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                      )}
                      <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: "#d6ede0", display: "grid", placeItems: "center", marginRight: "12px", flexShrink: 0 }}>
                        {renderLocationTypeIcon(item.type)}
                      </div>
                      <div>
                        <strong style={{ display: "block", fontSize: "14px", color: "#111827" }}>{item.name}</strong>
                        <small style={{ color: "#6b7280", fontSize: "12px" }}>{item.code}</small>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "16px 20px" }}>
                    <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 500, background: "#d6ede0", color: "#0c7441" }}>
                      {item.type}
                    </span>
                  </td>
                  <td style={{ padding: "16px 20px", color: "#374151", fontSize: "14px" }}>
                    {item.function || "—"}
                  </td>
                  <td style={{ padding: "16px 20px", color: "#6b7280", fontSize: "13px" }}>
                    {item.keywords || "—"}
                  </td>
                  <td style={{ padding: "16px 20px" }}>
                    <span style={{ display: "inline-block", padding: "4px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 500, background: item.status === "Active" ? "#e6f7ec" : "#fee2e2", color: item.status === "Active" ? "#0c7441" : "#dc2626" }}>
                      {item.status}
                    </span>
                  </td>
                  <td style={{ padding: "16px 20px", textAlign: "right", position: "relative" }}>
                    <div style={{ display: "inline-flex", gap: "6px" }} ref={actionMenuId === item.id ? actionMenuRef : undefined}>
                      <button
                        className="table-action menu-trigger"
                        aria-label={`Actions for ${item.name}`}
                        aria-expanded={actionMenuId === item.id}
                        onClick={() => setActionMenuId((current) => (current === item.id ? null : item.id))}
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
                            top: "48px",
                            background: "#fff",
                            borderRadius: "14px",
                            boxShadow: "0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1)",
                            zIndex: 40,
                            padding: "6px",
                            minWidth: "165px",
                            border: "1px solid #e5e7eb",
                          }}
                        >
                          <button
                            role="menuitem"
                            style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", fontSize: "13px", cursor: "pointer", borderRadius: "8px", color: "#191c1d" }}
                            onClick={() => {
                              navigate(`/map-editor?location=${item.id}`);
                              setActionMenuId(null);
                            }}
                          >
                            Locate on map
                          </button>
                          <button
                            role="menuitem"
                            style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", fontSize: "13px", cursor: "pointer", borderRadius: "8px", color: "#191c1d" }}
                            onClick={() => {
                              openEdit(item);
                              setActionMenuId(null);
                            }}
                          >
                            Edit location
                          </button>
                          <button
                            role="menuitem"
                            style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", fontSize: "13px", cursor: "pointer", borderRadius: "8px", color: "#191c1d" }}
                            onClick={() => {
                              setSelected(item);
                              setDialog("history");
                              setActionMenuId(null);
                            }}
                          >
                            View history
                          </button>
                          <button
                            role="menuitem"
                            style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", fontSize: "13px", color: "#dc2626", cursor: "pointer", borderRadius: "8px" }}
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
          total={hierarchyRows.length}
          page={page}
          pageSize={pageSize}
          onChange={setPage}
        />
      </Card>

      {/* Add / Edit Location Modal */}
      {(dialog === "add" || dialog === "edit") && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ background: "#fff", borderRadius: "28px", overflow: "hidden", width: "720px", maxWidth: "95%", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            {/* Top Green Banner */}
            <div style={{ background: "#005931", color: "#fff", padding: "24px 30px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "grid", placeItems: "center" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 21h18M4 18h16M6 18V9M10 18V9M14 18V9M18 18V9M12 3l9 4.5H3L12 3z" />
                  </svg>
                </div>
                <div>
                  <h2 style={{ fontSize: "22px", fontWeight: "bold", margin: 0 }}>
                    {dialog === "add" ? "Add Location" : "Edit Location"}
                  </h2>
                  <p style={{ margin: "4px 0 0", color: "#d6ede0", fontSize: "13px" }}>
                    Add a building, floor, room, office, laboratory, restroom, or facility.
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setDialog(null)}
                style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: "50%", width: "36px", height: "36px", cursor: "pointer", display: "grid", placeItems: "center" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Form Body */}
            <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: "16px", maxHeight: "70vh", overflowY: "auto" }}>
              {error && (
                <div role="alert" style={{ background: "#fee2e2", color: "#dc2626", padding: "10px 14px", borderRadius: "10px", fontSize: "13px" }}>
                  {error}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <SelectField
                  label="LOCATION TYPE"
                  required
                  value={draft.type}
                  onChange={(event) => setDraft({ ...draft, type: event.target.value as LocationType })}
                >
                  {["Laboratory", "Room", "Office", "Facility", "Building", "Floor", "Restroom"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </SelectField>
                <SelectField
                  label="STATUS"
                  required
                  value={draft.status}
                  onChange={(event) => setDraft({ ...draft, status: event.target.value as Location["status"] })}
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </SelectField>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <Field
                  label="LOCATION NAME"
                  required
                  value={draft.name}
                  placeholder="Computer Lab 1"
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
                <Field
                  label="LOCATION CODE / ID"
                  required
                  value={draft.code}
                  placeholder="LAB-CCSICT-201"
                  onChange={(event) => setDraft({ ...draft, code: event.target.value })}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <SelectField
                  label="PARENT BUILDING"
                  value={draft.building ?? ""}
                  subhelper="Required for rooms, offices, laboratories, restrooms, and facilities."
                  onChange={(event) => setDraft({ ...draft, building: event.target.value })}
                >
                  <option value="">None / Standalone</option>
                  {buildingOptions.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </SelectField>
                <SelectField
                  label="PARENT FLOOR"
                  value={draft.floor ?? ""}
                  onChange={(event) => setDraft({ ...draft, floor: event.target.value })}
                >
                  <option value="">None</option>
                  {floorOptions.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </SelectField>
              </div>

              <Field
                label="FUNCTION / PURPOSE"
                required
                value={draft.function ?? ""}
                placeholder="Programming and computer-based activities"
                onChange={(event) => setDraft({ ...draft, function: event.target.value })}
              />

              <Field
                label="DESCRIPTION"
                value={draft.keywords ?? ""}
                placeholder="A computer laboratory used for programming, software development, and hands-on IT exercises."
                onChange={(event) => setDraft({ ...draft, keywords: event.target.value })}
              />

              <Field
                label="KEYWORDS / TAGS"
                value={draft.keywords ?? ""}
                placeholder="programming, coding, computer lab"
                onChange={(event) => setDraft({ ...draft, keywords: event.target.value })}
              />

              {/* Upload Box */}
              <div style={{ border: "1px dashed #d1d5db", borderRadius: "14px", padding: "20px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f9fafb" }}>
                <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                  <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "#d6ede0", display: "grid", placeItems: "center" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0c7441" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                    </svg>
                  </div>
                  <div>
                    <strong style={{ fontSize: "14px", color: "#191c1d" }}>Upload a campus location photo or image</strong>
                    <p style={{ margin: "2px 0 0", color: "#6b7280", fontSize: "12px" }}>PNG, JPG, or WEBP</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div style={{ padding: "18px 32px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <Button variant="subtle" style={{ borderRadius: "999px", padding: "0 22px" }} onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button style={{ borderRadius: "999px", padding: "0 24px", background: "#005931", color: "#fff" }} onClick={save}>
                Save Location
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {dialog === "remove" && selected && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ background: "#fff", borderRadius: "28px", padding: "32px", width: "460px", maxWidth: "90%", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#fee2e2", color: "#dc2626", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div>
                <h2 style={{ fontSize: "20px", fontWeight: "bold", margin: 0, color: "#191c1d" }}>Delete location?</h2>
                <p style={{ margin: "4px 0 0", color: "#525c57", fontSize: "14px" }}>
                  This will remove {selected.name} from {selected.building ?? "campus"}{selected.floor ? ` / ${selected.floor}` : ""}.
                </p>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "24px" }}>
              <Button variant="subtle" style={{ borderRadius: "999px", padding: "0 20px" }} onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button style={{ background: "#dc2626", color: "#fff", borderRadius: "999px", padding: "0 22px" }} onClick={remove}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* View History Modal */}
      {dialog === "history" && selected && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ background: "#fff", borderRadius: "28px", padding: "32px", width: "540px", maxWidth: "95%", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <h2 style={{ fontSize: "22px", fontWeight: "bold", margin: 0, color: "#191c1d" }}>Audit History</h2>
            <p style={{ color: "#0c7441", fontWeight: 600, margin: "4px 0 2px" }}>{selected.name}</p>
            <p style={{ color: "#6b7280", fontSize: "13px", margin: "0 0 20px" }}>Record changes for this location.</p>

            <div style={{ border: "1px solid #e5e7eb", borderRadius: "16px", padding: "16px", display: "flex", flexDirection: "column", gap: "16px", maxHeight: "360px", overflowY: "auto" }}>
              <div style={{ display: "flex", gap: "12px" }}>
                <span style={{ color: "#0c7441", fontSize: "10px", marginTop: "4px" }}>●</span>
                <div>
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>Aug 17, 2026 · 2:05 PM</div>
                  <div style={{ fontSize: "13px", color: "#0c7441", fontWeight: 600 }}>admin01</div>
                  <strong style={{ fontSize: "14px", color: "#191c1d", display: "block" }}>Updated Location</strong>
                  <p style={{ fontSize: "12px", color: "#4b5563", margin: "2px 0 0" }}>Location Type: Classroom → Laboratory</p>
                </div>
              </div>
              <div style={{ display: "flex", gap: "12px" }}>
                <span style={{ color: "#0c7441", fontSize: "10px", marginTop: "4px" }}>●</span>
                <div>
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>Aug 15, 2026 · 10:31 AM</div>
                  <div style={{ fontSize: "13px", color: "#0c7441", fontWeight: 600 }}>admin01</div>
                  <strong style={{ fontSize: "14px", color: "#191c1d", display: "block" }}>Changed Parent Floor</strong>
                  <p style={{ fontSize: "12px", color: "#4b5563", margin: "2px 0 0" }}>Parent Floor: Floor 1 → Floor 2</p>
                </div>
              </div>
              <div style={{ display: "flex", gap: "12px" }}>
                <span style={{ color: "#0c7441", fontSize: "10px", marginTop: "4px" }}>●</span>
                <div>
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>Aug 10, 2026 · 9:15 AM</div>
                  <div style={{ fontSize: "13px", color: "#0c7441", fontWeight: 600 }}>admin01</div>
                  <strong style={{ fontSize: "14px", color: "#191c1d", display: "block" }}>Created Location</strong>
                </div>
              </div>
            </div>

            <div style={{ marginTop: "24px", textAlign: "center" }}>
              <Button variant="subtle" style={{ borderRadius: "999px", width: "100%", border: "1px solid #0c7441", color: "#0c7441" }} onClick={() => setDialog(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Import JSON Modal */}
      {dialog === "import" && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ background: "#fff", borderRadius: "28px", overflow: "hidden", width: "560px", maxWidth: "95%", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <div style={{ background: "#005931", color: "#fff", padding: "20px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                <div style={{ width: "38px", height: "38px", borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "grid", placeItems: "center" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                </div>
                <div>
                  <h2 style={{ fontSize: "20px", fontWeight: "bold", margin: 0 }}>Import Locations JSON</h2>
                  <p style={{ margin: "2px 0 0", color: "#d6ede0", fontSize: "13px" }}>
                    Validate campus location records before importing.
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setDialog(null)}
                style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: "50%", width: "32px", height: "32px", cursor: "pointer", display: "grid", placeItems: "center" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Dropzone container */}
              <div style={{ border: "1px dashed #d1d5db", borderRadius: "16px", padding: "20px", textAlign: "center", background: "#f9fafb" }}>
                <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "#d6ede0", color: "#0c7441", display: "grid", placeItems: "center", margin: "0 auto 8px" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                </div>
                <strong style={{ fontSize: "15px", color: "#191c1d", display: "block" }}>Upload JSON file</strong>
                <p style={{ color: "#6b7280", fontSize: "13px", margin: "4px 0 14px" }}>Choose a .json file containing campus location records.</p>
                <textarea
                  className="json-input"
                  rows={4}
                  placeholder='[{"id":"loc-1","name":"Imported Facility","code":"IMP-01","type":"Facility","parentId":null,"status":"Active","lat":16.72,"lng":121.69}]'
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  style={{ width: "100%", borderRadius: "10px", border: "1px solid #d1d5db", padding: "8px 12px", fontFamily: "monospace", fontSize: "12px", boxSizing: "border-box" }}
                />
              </div>

              {/* Mode Selection */}
              <div>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "#4b5563", textTransform: "uppercase" }}>IMPORT MODE</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "6px", background: "#f3f4f6", padding: "4px", borderRadius: "12px" }}>
                  <button
                    type="button"
                    onClick={() => setImportMode("add")}
                    style={{
                      padding: "8px",
                      borderRadius: "10px",
                      border: "none",
                      background: importMode === "add" ? "#fff" : "transparent",
                      boxShadow: importMode === "add" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                      fontWeight: 600,
                      fontSize: "13px",
                      cursor: "pointer",
                      color: "#191c1d",
                    }}
                  >
                    Add new
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportMode("update")}
                    style={{
                      padding: "8px",
                      borderRadius: "10px",
                      border: "none",
                      background: importMode === "update" ? "#fff" : "transparent",
                      boxShadow: importMode === "update" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                      fontWeight: 600,
                      fontSize: "13px",
                      cursor: "pointer",
                      color: "#191c1d",
                    }}
                  >
                    Update existing
                  </button>
                </div>
              </div>

              {importResult && (
                <div style={{ padding: "10px 14px", borderRadius: "10px", background: importResult.errors.length ? "#fee2e2" : "#e6f7ec", color: importResult.errors.length ? "#dc2626" : "#0c7441", fontSize: "13px" }}>
                  {importResult.errors.length ? importResult.errors.join(", ") : `Validation passed for ${importResult.imported} locations.`}
                </div>
              )}
            </div>

            <div style={{ padding: "16px 28px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <Button variant="subtle" style={{ borderRadius: "999px", padding: "0 20px" }} onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                variant="subtle"
                style={{ borderRadius: "999px", padding: "0 20px", border: "1px solid #0c7441", color: "#0c7441" }}
                onClick={validateImport}
              >
                Validate
              </Button>
              <Button
                style={{ borderRadius: "999px", padding: "0 22px", background: "#0c7441", color: "#fff" }}
                onClick={applyImport}
              >
                Import Locations
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
