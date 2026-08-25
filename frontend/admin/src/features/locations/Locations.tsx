import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { createLocationsBulkImportTemplate, services, setMockFailure } from "../../services/api";
import {
  Button,
  Card,
  Empty,
  Field,
  Pagination,
  SelectField,
} from "../../components/UI";
import type { Location, LocationDraft, LocationType } from "../../types";
import { locations as initialLocations } from "../../services/mockData";
import locationsModuleIcon from "../../assets/figma/modules/locations.svg";

const childLocationTypes = new Set<LocationType>(["Room", "Office", "Laboratory", "Restroom"]);
const standardFloorLevels = ["Ground Floor", "1st Floor", "2nd Floor", "3rd Floor", "4th Floor", "5th Floor", "Basement"] as const;

const blankLocation = (): LocationDraft => ({
  name: "",
  code: `LOC-${Date.now().toString().slice(-4)}`,
  type: "Laboratory",
  parentId: null,
  building: undefined,
  floor: undefined,
  function: "Academic and laboratory activities",
  keywords: "",
  status: "Active",
  lat: null,
  lng: null,
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
    if (failure === "locationSave" || failure === "locationRemove") {
      setMockFailure(failure, true);
      return () => setMockFailure(failure, false);
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
  const [floorId, setFloorId] = useState("All Floors");
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

  const [draft, setDraft] = useState<LocationDraft>(blankLocation());
  const [selected, setSelected] = useState<Location | null>(null);
  const [importText, setImportText] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importMode, setImportMode] = useState<"add" | "update">("add");
  const [importResult, setImportResult] = useState<{
    imported: number;
    errors: string[];
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [photoName, setPhotoName] = useState("");
  const [success, setSuccess] = useState<{
    name: string;
    id: string;
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

  const { data: history } = useQuery({
    queryKey: ["logs", "location-history", selected?.id],
    queryFn: () => services.logs.forLocation(selected!.id, selected!.name),
    enabled: dialog === "history" && selected !== null,
  });

  const allLocations = directory?.items ?? data?.items ?? initialLocations;
  const buildingOptions = allLocations.filter((item) => item.type === "Building");
  const buildingsById = new Map(allLocations.filter((item) => item.type === "Building").map((item) => [item.id, item]));
  const floors = allLocations.filter((item) => item.type === "Floor" && item.parentId && buildingsById.has(item.parentId));
  const selectedBuildingRecord = allLocations.find((item) => item.type === "Building" && item.name === building);
  const availableFloors = useMemo(() => {
    if (building === "All Buildings" || !selectedBuildingRecord) return floors;
    return floors.filter((f) => f.parentId === selectedBuildingRecord.id);
  }, [floors, building, selectedBuildingRecord]);

  const rawItems = data?.items ?? initialLocations;
  const items = useMemo(() => {
    return rawItems.filter(
      (item) =>
        (type === "All Types" || item.type === type) &&
        (status === "All Statuses" || status === "All Status" || item.status === status) &&
        (building === "All Buildings" || item.building === building || item.name === building) &&
        (floorId === "All Floors" || item.id === floorId || item.parentId === floorId),
    );
  }, [rawItems, type, status, building, floorId]);

  useEffect(() => setPage(1), [query, type, status, building, floorId]);

  // Build hierarchy tree
  const hierarchyRows = useMemo(() => {
    if (viewMode === "flat") return items.map((item) => ({ item, level: 0, hasChildren: false, isLast: false, isCollapsed: false }));

    const result: Array<{ item: Location; level: number; hasChildren: boolean; isLast: boolean; isCollapsed: boolean }> = [];

    // Find roots
    const rootBuildings = items.filter((loc) => loc.type === "Building");
    const standalone = items.filter((loc) => loc.parentId === null && loc.type === "Facility");

    for (const bldg of rootBuildings) {
      const bldgCollapsed = collapsedNodes.has(bldg.id);
      const explicitFloors = allLocations.filter((loc) => loc.parentId === bldg.id && loc.type === "Floor");
      const childLocations = allLocations.filter((loc) =>
        loc.type !== "Floor" && loc.type !== "Building" &&
        (loc.parentId === bldg.id || loc.building === bldg.name),
      );
      const knownFloorNames = new Set(explicitFloors.map((floor) => floor.name));
      const inferredFloors = Array.from(new Set(childLocations.map((loc) => loc.floor).filter(Boolean)))
        .filter((floorName) => !knownFloorNames.has(floorName as string))
        .map((floorName) => ({
          id: `${bldg.id}-floor-${floorName}`,
          name: floorName as string,
          code: `${bldg.code}-${floorName}`,
          type: "Floor" as const,
          parentId: bldg.id,
          building: bldg.name,
          status: bldg.status,
          lat: null,
          lng: null,
          positioned: false,
        }));
      const childFloors = [...explicitFloors, ...inferredFloors];
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
      const saved = await services.locations.save(draft);
      await refresh();
      setDialog(null);
      setNotice(`${draft.name || "Location"} saved successfully.`);
      setSuccess({
        name: saved.name || "Location",
        id: saved.id,
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
    setError("");
    try {
      await services.locations.remove(selected.id);
      await refresh();
      setDialog(null);
      setNotice(`${selected.name} removed successfully.`);
    } catch (cause) {
      setDialog(null);
      setError(cause instanceof Error ? cause.message : "Unable to delete location.");
    }
  };

  const validateImport = async () => {
    setImportResult(await services.imports.locations({ json: importText, mode: importMode }));
  };

  const applyImport = async () => {
    if (!importResult || importResult.errors.length) return;
    const committed = await services.imports.locations({ json: importText, commit: true, mode: importMode });
    if (committed.errors.length) {
      setImportResult(committed);
      return;
    }
    await refresh();
    setDialog(null);
    setNotice(`${committed.imported} locations imported successfully.`);
    setImportSuccess(committed.imported);
  };

  const openEdit = (item: Location) => {
    setSelected(item);
    setDraft({ ...item });
    setPhotoName("");
    setDialog("edit");
  };

  const openAddRoom = (parent: Location) => {
    setSelected(parent);
    setDraft({
      ...blankLocation(),
      type: "Room",
      parentId: parent.id,
      building: parent.name,
      floor: "1st Floor",
    });
    setPhotoName("");
    setActionMenuId(null);
    setDialog("add");
  };

  const isChildLocation = (item: Location) => childLocationTypes.has(item.type);
  const isBuilding = (item: Location) => item.type === "Building";
  const selectedChildren = selected?.type === "Building"
    ? allLocations.filter((location) => childLocationTypes.has(location.type) && (location.parentId === selected.id || location.building === selected.name))
    : [];

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

      <Card
        className="filters"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          padding: "20px 24px",
          background: "#edf3f0",
          borderRadius: "24px",
          marginBottom: "20px",
        }}
      >
        {/* Full-width search bar */}
        <div style={{ position: "relative", width: "100%" }}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#525c57"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              position: "absolute",
              left: "18px",
              top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: "none",
            }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            aria-label="Search locations"
            placeholder="Search by building, room, office, lab, facility, or keyword..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{
              width: "100%",
              height: "48px",
              borderRadius: "999px",
              border: "1px solid #d1d5db",
              background: "#ffffff",
              padding: "0 20px 0 52px",
              fontSize: "14px",
              color: "#191c1d",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Filters and Actions Row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            flexWrap: "wrap",
            gap: "16px",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              flexWrap: "wrap",
              gap: "12px",
            }}
          >
            <SelectField
              label="TYPE"
              aria-label="TYPE"
              value={type}
              onChange={(event) => setType(event.target.value)}
              style={{ background: "#ffffff", borderRadius: "18px", minWidth: "120px", height: "46px" }}
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
              onChange={(event) => {
                setBuilding(event.target.value);
                setFloorId("All Floors");
              }}
              style={{ background: "#ffffff", borderRadius: "18px", minWidth: "140px", height: "46px" }}
            >
              <option>All Buildings</option>
              {buildingOptions.map((value) => (
                <option key={value.id}>{value.name}</option>
              ))}
            </SelectField>
            <SelectField
              label="FLOOR"
              aria-label="FLOOR"
              value={floorId}
              onChange={(event) => setFloorId(event.target.value)}
              style={{ background: "#ffffff", borderRadius: "18px", minWidth: "120px", height: "46px" }}
            >
              <option>All Floors</option>
              {availableFloors.map((value) => (
                <option key={value.id} value={value.id}>{value.name}</option>
              ))}
            </SelectField>
            <SelectField
              label="STATUS"
              aria-label="STATUS"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              style={{ background: "#ffffff", borderRadius: "18px", minWidth: "120px", height: "46px" }}
            >
              <option>All Statuses</option>
              <option>Active</option>
              <option>Inactive</option>
            </SelectField>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            <Button
              variant="subtle"
              style={{
                height: "46px",
                borderRadius: "999px",
                padding: "0 22px",
                border: "1.5px solid #0c7441",
                color: "#0c7441",
                background: "#ffffff",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                fontWeight: 600,
              }}
              onClick={() => {
                setImportText("");
                setImportFileName("");
                setImportResult(null);
                setDialog("import");
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              Bulk Import
            </Button>
            <Button
              style={{
                height: "46px",
                borderRadius: "999px",
                padding: "0 24px",
                background: "#005931",
                color: "#fff",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
              onClick={() => {
                setDraft(blankLocation());
                setPhotoName("");
                setDialog("add");
              }}
            >
              ＋ Add Location
            </Button>
          </div>
        </div>
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
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <Button style={{ width: "100%", background: "#0c7441", color: "#fff", height: "48px", borderRadius: "999px" }} onClick={() => navigate(`/map-editor?location=${success.id}`)}>
                {success.kind === "added" ? "Place on map" : "Edit position on map"}
              </Button>
              <Button variant="subtle" style={{ width: "100%", height: "44px", borderRadius: "999px" }} onClick={() => setSuccess(null)}>
                Done
              </Button>
            </div>
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

        <div className="table-wrap" style={{ overflow: "visible", minHeight: "220px" }}>
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
              {visibleRows.map(({ item, level, hasChildren, isCollapsed }, index) => {
                const isNearBottom = index >= 3 && index >= visibleRows.length - 2;
                return (
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
                      <div aria-label={item.positioned ? "Positioned location" : "Unpositioned location"} style={{ width: "34px", height: "34px", borderRadius: "10px", background: item.positioned ? "#d6ede0" : "#f3f4f6", display: "grid", placeItems: "center", marginRight: "12px", flexShrink: 0, filter: item.positioned ? undefined : "grayscale(1)", opacity: item.positioned ? 1 : 0.55 }}>
                        {renderLocationTypeIcon(item.type)}
                      </div>
                      <div>
                        <strong style={{ display: "block", fontSize: "14px", color: "#111827" }}>{item.name}</strong>
                        <small style={{ color: "#6b7280", fontSize: "12px" }}>{item.code}</small>
                        {level > 0 && item.floor && (
                          <span style={{ display: "inline-block", marginTop: "5px", padding: "2px 8px", borderRadius: "999px", background: "#eef6f1", color: "#0c7441", fontSize: "11px", fontWeight: 600 }}>
                            {item.floor}
                          </span>
                        )}
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
                            onClick={() => {
                              const target = isChildLocation(item) && item.parentId ? item.parentId : item.id;
                              navigate(`/map-editor?location=${target}`);
                              setActionMenuId(null);
                            }}
                          >
                            {isChildLocation(item) ? "Locate parent building on map" : "Locate on map"}
                          </button>
                          {isBuilding(item) && (
                            <button
                              role="menuitem"
                              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", fontSize: "13px", cursor: "pointer", borderRadius: "8px", color: "#191c1d" }}
                              onClick={() => openAddRoom(item)}
                            >
                              ＋ Add room to this building
                            </button>
                          )}
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
                );
              })}
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
                  onChange={(event) => {
                    const nextType = event.target.value as LocationType;
                    setDraft(childLocationTypes.has(nextType) || nextType === "Floor"
                      ? { ...draft, type: nextType, floor: childLocationTypes.has(nextType) ? draft.floor : undefined }
                      : { ...draft, type: nextType, parentId: null, building: undefined, floor: undefined });
                  }}
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
                  <option value="Unknown">Unknown</option>
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

              {(childLocationTypes.has(draft.type) || draft.type === "Floor") && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  <SelectField
                    label="PARENT BUILDING"
                    value={draft.parentId ?? ""}
                    disabled={dialog === "add" && draft.type === "Room" && draft.parentId !== null}
                    onChange={(event) => {
                      const parent = buildingOptions.find((item) => item.id === event.target.value);
                      setDraft({ ...draft, parentId: parent?.id ?? null, building: parent?.name });
                    }}
                  >
                    <option value="">None / Standalone</option>
                    {buildingOptions.map((buildingOption) => (
                      <option key={buildingOption.id} value={buildingOption.id}>{buildingOption.name}</option>
                    ))}
                  </SelectField>
                  {childLocationTypes.has(draft.type) && (
                    <SelectField
                      label="FLOOR LEVEL"
                      value={draft.floor ?? ""}
                      onChange={(event) => setDraft({ ...draft, floor: event.target.value || undefined })}
                    >
                      <option value="">None</option>
                      {standardFloorLevels.map((floorLevel) => (
                        <option key={floorLevel} value={floorLevel}>{floorLevel}</option>
                      ))}
                    </SelectField>
                  )}
                </div>
              )}

              <Field
                label="FUNCTION / PURPOSE"
                required
                value={draft.function ?? ""}
                placeholder="Programming and computer-based activities"
                onChange={(event) => setDraft({ ...draft, function: event.target.value })}
              />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <Field label="LATITUDE (OPTIONAL)" type="number" value={draft.lat ?? ""} placeholder="16.721020" onChange={(event) => setDraft({ ...draft, lat: event.target.value === "" ? null : Number(event.target.value), positioned: event.target.value !== "" && draft.lng !== null })} />
                <Field label="LONGITUDE (OPTIONAL)" type="number" value={draft.lng ?? ""} placeholder="121.689290" onChange={(event) => setDraft({ ...draft, lng: event.target.value === "" ? null : Number(event.target.value), positioned: event.target.value !== "" && draft.lat !== null })} />
              </div>
              <p style={{ margin: "-8px 0 0", color: "#6b7280", fontSize: "12px" }}>Leave both blank to place this location later on the map.</p>

              <Field
                label="DESCRIPTION"
                value={draft.function ?? ""}
                placeholder="A computer laboratory used for programming, software development, and hands-on IT exercises."
                onChange={(event) => setDraft({ ...draft, function: event.target.value })}
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
                    <p style={{ margin: "2px 0 0", color: "#6b7280", fontSize: "12px" }}>{photoName || "PNG, JPG, or WEBP"}</p>
                  </div>
                </div>
                <input aria-label="Upload location photo" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setPhotoName(event.target.files?.[0]?.name ?? "")} />
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
                  {selectedChildren.length > 0
                    ? `This building contains ${selectedChildren.length} connected rooms/offices. Deactivating this building will mark it and its child rooms as Inactive.`
                    : `This will remove ${selected.name} from ${selected.building ?? "campus"}${selected.floor ? ` / ${selected.floor}` : ""}.`}
                </p>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "24px" }}>
              <Button variant="subtle" style={{ borderRadius: "999px", padding: "0 20px" }} onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button style={{ background: "#dc2626", color: "#fff", borderRadius: "999px", padding: "0 22px" }} onClick={remove}>
                {selectedChildren.length > 0 ? "Deactivate" : "Delete"}
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
              {history?.items.length ? history.items.map((entry) => (
                <div key={entry.id} style={{ display: "flex", gap: "12px" }}>
                  <span style={{ color: "#0c7441", fontSize: "10px", marginTop: "4px" }}>●</span>
                  <div>
                    <div style={{ fontSize: "12px", color: "#6b7280" }}>{entry.createdAt}</div>
                    <div style={{ fontSize: "13px", color: "#0c7441", fontWeight: 600 }}>{entry.actor}</div>
                    <strong style={{ fontSize: "14px", color: "#191c1d", display: "block" }}>{entry.action}</strong>
                    {entry.detail && <p style={{ fontSize: "12px", color: "#4b5563", margin: "2px 0 0" }}>{entry.detail}</p>}
                  </div>
                </div>
              )) : <p style={{ margin: 0, color: "#6b7280", fontSize: "13px" }}>No recorded changes for this location yet.</p>}
            </div>

            <div style={{ marginTop: "24px", textAlign: "center" }}>
              <Button variant="subtle" style={{ borderRadius: "999px", width: "100%", border: "1px solid #0c7441", color: "#0c7441" }} onClick={() => setDialog(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {dialog === "import" && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ background: "#fff", borderRadius: "28px", overflow: "hidden", width: "560px", maxWidth: "95%", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <div style={{ background: "#005931", color: "#fff", padding: "20px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
                <div style={{ width: "42px", height: "42px", borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "grid", placeItems: "center" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                  </svg>
                </div>
                <div>
                  <h2 style={{ fontSize: "20px", fontWeight: "bold", margin: 0, color: "#fff" }}>Bulk Import Locations</h2>
                  <p style={{ margin: "2px 0 0", color: "#d6ede0", fontSize: "13px" }}>
                    Validate campus location records before importing.
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setDialog(null)}
                style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: "50%", width: "34px", height: "34px", cursor: "pointer", display: "grid", placeItems: "center" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Dropzone container */}
              <div style={{ border: "1.5px dashed #c2d6cb", borderRadius: "20px", padding: "20px 24px", background: "#f8faf9", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <div style={{ width: "46px", height: "46px", borderRadius: "12px", background: "#d6ede0", color: "#0c7441", display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="12" />
                      <line x1="9" y1="15" x2="12" y2="12" />
                      <line x1="15" y1="15" x2="12" y2="12" />
                    </svg>
                  </div>
                  <div>
                    <strong style={{ fontSize: "16px", color: "#191c1d", display: "block" }}>Upload JSON file</strong>
                    <p style={{ color: "#525c57", fontSize: "13px", margin: "3px 0 0" }}>Choose a .json file containing campus location records.</p>
                    {importFileName && <p style={{ color: "#0c7441", fontSize: "12px", margin: "6px 0 0", fontWeight: 600 }}>{importFileName} selected</p>}
                  </div>
                </div>

                <label
                  style={{
                    border: "1.5px solid #0c7441",
                    borderRadius: "999px",
                    padding: "10px 28px",
                    color: "#0c7441",
                    fontWeight: 600,
                    fontSize: "14px",
                    background: "#fff",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  Browse
                  <input
                    aria-label="Choose location JSON file"
                    type="file"
                    accept="application/json,.json"
                    style={{ display: "none" }}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      setImportResult(null);
                      setImportFileName(file?.name ?? "");
                      if (!file) return setImportText("");
                      void file.text().then(setImportText);
                    }}
                  />
                </label>
              </div>

              {/* Mode Selection */}
              <div>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#525c57", textTransform: "uppercase", letterSpacing: "0.5px" }}>IMPORT MODE</span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px", marginTop: "8px", background: "#edf2ee", padding: "4px", borderRadius: "14px" }}>
                  <button
                    type="button"
                    onClick={() => { setImportMode("add"); setImportResult(null); }}
                    style={{
                      padding: "10px",
                      borderRadius: "10px",
                      border: "none",
                      background: importMode === "add" ? "#fff" : "transparent",
                      boxShadow: importMode === "add" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                      fontWeight: importMode === "add" ? 700 : 500,
                      fontSize: "14px",
                      cursor: "pointer",
                      color: importMode === "add" ? "#005931" : "#525c57",
                      transition: "all 0.15s ease",
                    }}
                  >
                    Add new
                  </button>
                  <button
                    type="button"
                    onClick={() => { setImportMode("update"); setImportResult(null); }}
                    style={{
                      padding: "10px",
                      borderRadius: "10px",
                      border: "none",
                      background: importMode === "update" ? "#fff" : "transparent",
                      boxShadow: importMode === "update" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                      fontWeight: importMode === "update" ? 700 : 500,
                      fontSize: "14px",
                      cursor: "pointer",
                      color: importMode === "update" ? "#005931" : "#525c57",
                      transition: "all 0.15s ease",
                    }}
                  >
                    Update existing
                  </button>
                </div>
              </div>

              {/* Download Template Link */}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <a
                  href={`data:application/json;charset=utf-8,${encodeURIComponent(createLocationsBulkImportTemplate())}`}
                  download="locations-bulk-template.json"
                  style={{ display: "inline-flex", alignItems: "center", gap: "8px", color: "#0c7441", fontSize: "14px", fontWeight: 600, textDecoration: "none" }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                  Download template
                </a>
              </div>

              {importResult && (
                <div style={{ padding: "10px 14px", borderRadius: "10px", background: importResult.errors.length ? "#fee2e2" : "#e6f7ec", color: importResult.errors.length ? "#dc2626" : "#0c7441", fontSize: "13px" }}>
                  {importResult.errors.length ? <ul style={{ margin: 0, paddingLeft: "18px" }}>{importResult.errors.map((message) => <li key={message}>{message}</li>)}</ul> : `Validation passed for ${importResult.imported} locations.`}
                </div>
              )}
            </div>

            <div style={{ padding: "18px 28px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", gap: "12px", alignItems: "center" }}>
              <Button variant="subtle" style={{ borderRadius: "999px", padding: "0 22px", height: "46px", border: "1px solid #d1d5db", color: "#191c1d" }} onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                variant="subtle"
                style={{ borderRadius: "999px", padding: "0 22px", height: "46px", border: "1.5px solid #0c7441", color: "#0c7441", fontWeight: 600 }}
                onClick={validateImport}
              >
                Validate
              </Button>
              <Button
                style={{ borderRadius: "999px", padding: "0 24px", height: "46px", background: "#005931", color: "#fff", fontWeight: 600 }}
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
