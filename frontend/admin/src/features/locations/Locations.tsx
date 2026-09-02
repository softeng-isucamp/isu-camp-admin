import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { API_MODE, createLocationsBulkImportTemplate, services, setMockFailure } from "../../services/api";
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
import { indoorLocationTypes, locationPolicy, standardFloorLevels } from "../../lib/locationPolicy";
import { LocationDetailsFields } from "./LocationDetailsModal";

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

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

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

  const [query, setQuery] = useState(() => new URLSearchParams(routeLocation.search).get("q") ?? "");
  useEffect(() => {
    const q = new URLSearchParams(routeLocation.search).get("q");
    setQuery(q ?? "");
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
  const [lockedParentId, setLockedParentId] = useState<string | null>(null);
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
  const [fieldErrors, setFieldErrors] = useState<Array<{ field?: keyof LocationDraft; message: string }>>([]);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [photoName, setPhotoName] = useState("");
  const [customFloorMode, setCustomFloorMode] = useState(false);
  const [success, setSuccess] = useState<{
    name: string;
    id: string;
    building?: string;
    floor?: string;
    mapTargetId: string;
    indoor: boolean;
    kind: "added" | "edited";
  } | null>(null);
  const [importSuccess, setImportSuccess] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(false);
  pendingRef.current = saving || validating || importing || deleting;

  const activeOverlay = success ? "success" : importSuccess !== null ? "import-success" : dialog;
  const openDialog = (next: NonNullable<typeof dialog>) => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialog(next);
  };
  const closeOverlay = () => {
    if (pendingRef.current) return;
    setDialog(null);
    setSuccess(null);
    setImportSuccess(null);
  };

  useEffect(() => {
    if (!activeOverlay) return;
    const overlay = document.querySelector<HTMLElement>(".locations-overlay");
    if (!overlay) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const page = document.querySelector<HTMLElement>(".locations-page");
    const backgroundNodes = page
      ? Array.from(page.children).filter((node) => !node.contains(overlay))
      : [];
    backgroundNodes.forEach((node) => {
      node.setAttribute("aria-hidden", "true");
      (node as HTMLElement).inert = true;
    });
    const focusable = () => Array.from(overlay.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    const initial = overlay.querySelector<HTMLElement>("[data-modal-initial]") ?? focusable()[0];
    window.setTimeout(() => initial?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!pendingRef.current) closeOverlay();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      backgroundNodes.forEach((node) => {
        node.removeAttribute("aria-hidden");
        (node as HTMLElement).inert = false;
      });
      if (openerRef.current?.isConnected) window.setTimeout(() => openerRef.current?.focus(), 0);
    };
  }, [activeOverlay]);

  const { data: directory } = useQuery({
    queryKey: ["locations", "directory"],
    queryFn: async () => {
      const first = await services.locations.list("", 1, 100);
      const pages = Math.ceil(first.total / first.pageSize);
      const remaining = await Promise.all(
        Array.from({ length: Math.max(0, pages - 1) }, (_, index) =>
          services.locations.list("", index + 2, first.pageSize)),
      );
      return [first, ...remaining].flatMap((result) => result.items);
    },
  });

  const { data: history } = useQuery({
    queryKey: ["logs", "location-history", selected?.id],
    queryFn: () => services.logs.forLocation(selected!.id, selected!.name),
    enabled: dialog === "history" && selected !== null,
  });

  const allLocations = directory ?? (API_MODE === "local" ? initialLocations : []);
  const isChildType = (type: LocationType) => locationPolicy.classify(type).requiresBuildingParent;
  const normalizeDraft = (next: LocationDraft) => locationPolicy.normalize(next, {
    directory: allLocations,
    previous: draft,
  });
  const buildingOptions = allLocations.filter((item) => item.type === "Building");
  const buildingsById = new Map(allLocations.filter((item) => item.type === "Building").map((item) => [item.id, item]));
  const floors = useMemo(() => {
    const compatibilityFloors = allLocations.filter((item) => item.type === "Floor" && item.parentId && buildingsById.has(item.parentId));
    const derivedFloors = allLocations
      .filter((item) => indoorLocationTypes.includes(item.type as typeof indoorLocationTypes[number]) && item.parentId && item.floor)
      .map((item) => {
        const parent = buildingsById.get(item.parentId!);
        return { id: `${item.parentId}-floor-${item.floor}`, name: item.floor!, code: `${parent?.code ?? "BLDG"}-${item.floor}`, type: "Floor" as const, parentId: item.parentId, building: parent?.name ?? item.building, status: parent?.status ?? item.status, lat: null, lng: null, positioned: false } satisfies Location;
      });
    const unique = new Map<string, Location>();
    const unspecifiedFloors = allLocations
      .filter((item) => indoorLocationTypes.includes(item.type as typeof indoorLocationTypes[number]) && item.parentId && !item.floor)
      .map((item) => {
        const parent = buildingsById.get(item.parentId!);
        return { id: `${item.parentId}-floor-Unspecified-Floor`, name: "Unspecified Floor", code: `${parent?.code ?? "BLDG"}-UNSPECIFIED`, type: "Floor" as const, parentId: item.parentId, building: parent?.name ?? item.building, status: parent?.status ?? item.status, lat: null, lng: null, positioned: false } satisfies Location;
      });
    [...compatibilityFloors, ...derivedFloors, ...unspecifiedFloors].forEach((floor) => {
      const key = `${floor.parentId}:${floor.name}`;
      if (!unique.has(key)) unique.set(key, floor);
    });
    return [...unique.values()];
  }, [allLocations, buildingsById]);
  const selectedBuildingRecord = allLocations.find((item) => item.type === "Building" && item.name === building);
  const availableFloors = useMemo(() => {
    if (building === "All Buildings" || !selectedBuildingRecord) return floors;
    return floors.filter((f) => f.parentId === selectedBuildingRecord.id);
  }, [floors, building, selectedBuildingRecord]);

  const selectedFloorRecord = floorId === "All Floors" ? undefined : floors.find((floor) => floor.id === floorId);
  const { data, isLoading, error: listError } = useQuery({
    queryKey: ["locations", "page", query, page, type, status, selectedBuildingRecord?.id, selectedFloorRecord?.name],
    queryFn: () => services.locations.list(query, page, pageSize, {
      type: type === "All Types" ? undefined : type as LocationType,
      status: status === "All Statuses" || status === "All Status" ? undefined : status as Location["status"],
      buildingId: selectedBuildingRecord?.id,
      floor: selectedFloorRecord?.name,
    }),
    placeholderData: (previous) => previous,
  });
  const rawItems = data?.items ?? [];
  const items = useMemo(() => {
    return rawItems.filter(
      (item) =>
        (type === "All Types" || item.type === type) &&
        (status === "All Statuses" || status === "All Status" || item.status === status) &&
        (building === "All Buildings" || item.building === building || item.name === building) &&
        (floorId === "All Floors" || item.id === floorId || item.parentId === floorId || (item.floor === selectedFloorRecord?.name && item.parentId === selectedFloorRecord?.parentId)),
    );
  }, [rawItems, type, status, building, floorId, selectedFloorRecord]);

  useEffect(() => setPage(1), [query, type, status, building, floorId, viewMode]);

  const matchingIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);

  // Build complete hierarchy families. Filtering can reduce a family to the
  // matching descendants, but a matching indoor record always keeps its root
  // Building and Floor Level context visible.
  const hierarchyFamilies = useMemo(() => {
    if (viewMode === "flat") return items.map((item) => [{ item, level: 0, hasChildren: false, isLast: false, isCollapsed: false }]);

    const result: Array<Array<{ item: Location; level: number; hasChildren: boolean; isLast: boolean; isCollapsed: boolean }>> = [];

    // Find roots
    const rootBuildings = allLocations.filter((loc) => loc.type === "Building" && (
      matchingIds.has(loc.id) || allLocations.some((child) => matchingIds.has(child.id) && (child.parentId === loc.id || child.building === loc.name))
    ));
    const standalone = items.filter((loc) => loc.parentId === null && loc.type === "Facility");

    for (const bldg of rootBuildings) {
      const rootWasMatched = matchingIds.has(bldg.id);
      const bldgCollapsed = collapsedNodes.has(bldg.id);
      const childLocations = allLocations.filter((loc) =>
        loc.type !== "Floor" && loc.type !== "Building" &&
        (loc.parentId === bldg.id || (!loc.parentId && loc.building === bldg.name)) &&
        (rootWasMatched || matchingIds.has(loc.id)),
      );
      const explicitFloors = allLocations.filter((loc) =>
        loc.parentId === bldg.id &&
        loc.type === "Floor" &&
        (rootWasMatched || childLocations.some((child) =>
          child.parentId === loc.id ||
          (child.floor === loc.name && (child.parentId === bldg.id || (!child.parentId && child.building === bldg.name)))
        )),
      );
      const knownFloorNames = new Set(explicitFloors.map((floor) => floor.name));
      const inferredFloorNames = Array.from(new Set(childLocations.map((loc) => loc.floor).filter(Boolean)));
      if (childLocations.some((loc) => !loc.floor)) inferredFloorNames.push("Unspecified Floor");
      const inferredFloors = inferredFloorNames
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
      const family: Array<{ item: Location; level: number; hasChildren: boolean; isLast: boolean; isCollapsed: boolean }> = [];
      family.push({ item: bldg, level: 0, hasChildren: childFloors.length > 0, isLast: false, isCollapsed: bldgCollapsed });

      if (!bldgCollapsed) {
        childFloors.forEach((flr, flrIndex) => {
          const flrCollapsed = collapsedNodes.has(flr.id);
          const childRooms = allLocations.filter(
            (loc) => matchingIds.has(loc.id) && (loc.parentId === flr.id || ((!loc.parentId || loc.parentId === bldg.id) && loc.building === bldg.name && (loc.floor === flr.name || (flr.name === "Unspecified Floor" && !loc.floor)) && loc.type !== "Floor" && loc.type !== "Building"))
          );
          family.push({
            item: flr,
            level: 1,
            hasChildren: childRooms.length > 0,
            isLast: flrIndex === childFloors.length - 1,
            isCollapsed: flrCollapsed,
          });

          if (!flrCollapsed) {
            childRooms.forEach((rm, rmIndex) => {
              family.push({
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
      result.push(family);
    }

    // Add standalone items
    for (const s of standalone) {
      result.push([{ item: s, level: 0, hasChildren: false, isLast: false, isCollapsed: false }]);
    }

    // If filter produced items not in tree, include them
    const includedIds = new Set(result.flat().map((r) => r.item.id));
    for (const item of items) {
      if (!includedIds.has(item.id)) {
        result.push([{ item, level: 0, hasChildren: false, isLast: false, isCollapsed: false }]);
      }
    }

    return result;
  }, [items, matchingIds, allLocations, viewMode, collapsedNodes]);

  const hierarchyRows = hierarchyFamilies.flat();
  const visibleRows = viewMode === "flat"
    ? hierarchyRows
    : hierarchyFamilies.flat();

  useEffect(() => {
    if (!data) return;
    const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
    setPage((current) => Math.min(current, totalPages));
  }, [data]);

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
    setFieldErrors([]);
    const adding = dialog === "add";
    const normalized = normalizeDraft(draft);
    const evaluation = locationPolicy.evaluate(normalized, { context: "record", directory: allLocations, requireFloorLevel: adding, currentId: adding ? "__new__" : selected?.id });
    const requiredIssues = [
      ["name", "Location name is required."],
      ["code", "Location code is required."],
      ["function", "Description / purpose is required."],
    ] as const;
    const validationIssues = [
      ...requiredIssues.filter(([field]) => !String(normalized[field] ?? "").trim()).map(([field, message]) => ({ field: field as keyof LocationDraft, message })),
      ...(adding && normalized.type === "Floor" ? [{ field: "type" as keyof LocationDraft, message: "Floor records are read-only compatibility data and cannot be created here." }] : []),
      ...evaluation.issues.map((issue) => ({ field: issue.field, message: issue.message })),
    ];
    if (validationIssues.length) {
      setFieldErrors(validationIssues.filter((issue, index, all) => all.findIndex((candidate) => candidate.field === issue.field && candidate.message === issue.message) === index));
      return;
    }
    setSaving(true);
    try {
      const saved = await services.locations.save(normalized);
      await refresh();
      setDialog(null);
      setNotice(`${draft.name || "Location"} saved successfully.`);
      setSuccess({
        name: saved.name || "Location",
        id: saved.id,
        building: normalized.building,
        floor: normalized.floor,
        mapTargetId: isChildType(saved.type) && saved.parentId ? saved.parentId : saved.id,
        indoor: isChildType(saved.type),
        kind: adding ? "added" : "edited",
      });
    } catch (cause) {
      const backendFields = (cause as Error & { fieldErrors?: Record<string, string> }).fieldErrors;
      if (backendFields) {
        setFieldErrors(Object.entries(backendFields).map(([field, message]) => ({ field: field as keyof LocationDraft, message })));
      }
      setError(
        cause instanceof Error ? cause.message : "Unable to save location.",
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    setError("");
    setDeleting(true);
    try {
      await services.locations.remove(selected.id);
      await refresh();
      setDialog(null);
      setNotice(`${selected.name} permanently deleted.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete location.");
    } finally {
      setDeleting(false);
    }
  };

  const validateImport = async () => {
    setValidating(true);
    try {
      setImportResult(await services.imports.locations({ json: importText, mode: importMode }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to validate locations.");
    } finally {
      setValidating(false);
    }
  };

  const applyImport = async () => {
    if (!importResult || importResult.errors.length) return;
    setImporting(true);
    let committed;
    try {
      committed = await services.imports.locations({ json: importText, commit: true, mode: importMode });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to import locations.");
      setImporting(false);
      return;
    }
    if (committed.errors.length) {
      setImportResult(committed);
      setImporting(false);
      return;
    }
    await refresh();
    setDialog(null);
    setNotice(`${committed.imported} locations imported successfully.`);
    setImportSuccess(committed.imported);
    setImporting(false);
  };

  const openEdit = (item: Location) => {
    setSelected(item);
    setDraft({ ...item, photoRemoved: false });
    setPhotoName(item.photo?.name ?? "");
    setCustomFloorMode(Boolean(item.floor && !(standardFloorLevels as readonly string[]).includes(item.floor)));
    setLockedParentId(null);
    openDialog("edit");
    if (item.hasPhoto && !item.photo) {
      void services.locations.getPhoto(item.id).then((blob) => {
        setDraft((current) => ({ ...current, photo: { name: "Location photo", type: blob.type, dataUrl: URL.createObjectURL(blob) }, photoRemoved: false }));
        setPhotoName("Location photo");
      }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load location photo."));
    }
  };

  const selectPhoto = (file: File | undefined) => {
    if (!file) return;
    const extension = file.name.toLowerCase().split(".").pop();
    const validType = PHOTO_TYPES.has(file.type) || (file.type === "" && ["png", "jpg", "jpeg", "webp"].includes(extension ?? ""));
    if (!validType) {
      setFieldErrors((current) => [...current.filter((issue) => issue.field !== "photo"), { field: "photo", message: "Choose a PNG, JPEG, or WebP image." }]);
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setFieldErrors((current) => [...current.filter((issue) => issue.field !== "photo"), { field: "photo", message: "Photo must be 5 MB or smaller." }]);
      return;
    }
    // Show the user's selection immediately, even while the preview is being decoded.
    setPhotoName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setDraft((current) => ({ ...current, photo: { name: file.name, type: file.type || `image/${extension}`, dataUrl: reader.result as string }, photoRemoved: false }));
      setPhotoName(file.name);
      setFieldErrors((current) => current.filter((issue) => issue.field !== "photo"));
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = () => {
    setDraft((current) => ({ ...current, photo: undefined, photoRemoved: current.id !== undefined && current.hasPhoto === true }));
    setPhotoName("");
    setFieldErrors((current) => current.filter((issue) => issue.field !== "photo"));
  };

  const openAddRoom = (parent: Location) => {
    setSelected(parent);
    setDraft({
      ...blankLocation(),
      type: "Room",
      parentId: parent.id,
      building: parent.name,
      floor: undefined,
    });
    setPhotoName("");
    setCustomFloorMode(false);
    setLockedParentId(parent.id);
    setActionMenuId(null);
    openDialog("add");
  };

  const isChildLocation = (item: Location) => isChildType(item.type);
  const isBuilding = (item: Location) => item.type === "Building";
  const selectedChildren = selected?.type === "Building"
    ? allLocations.filter((location) => isChildType(location.type) && location.parentId === selected.id)
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
  const errorFor = (field: keyof LocationDraft) => fieldErrors.find((issue) => issue.field === field)?.message;

  return (
    <div className="page locations-page">
      <div className="page-hero">
        <span className="page-icon" style={{ background: "#d6ede0", borderRadius: "12px", width: "48px", height: "48px", display: "grid", placeItems: "center" }}>
          <img src={locationsModuleIcon} alt="" style={{ width: "24px", height: "24px" }} />
        </span>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: "bold", margin: "0", color: "#191c1d" }}>Campus Locations</h1>
          <p style={{ color: "#525c57", marginTop: "4px", fontSize: "15px" }}>
            Manage Buildings and Indoor Locations. Create outdoor records in Map Editor.
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
                openDialog("import");
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              Bulk Import
            </Button>
            <Button
              variant="subtle"
              aria-label="Create Building in Map Editor"
              style={{ height: "46px", borderRadius: "999px", padding: "0 18px", border: "1.5px solid #0c7441", color: "#0c7441", background: "#fff", fontWeight: 600 }}
              onClick={() => navigate("/map-editor?create=building")}
            >
              ＋ Create Building
            </Button>
            <Button
              variant="subtle"
              aria-label="Create Outdoor Point Location in Map Editor"
              style={{ height: "46px", borderRadius: "999px", padding: "0 18px", border: "1.5px solid #0c7441", color: "#0c7441", background: "#fff", fontWeight: 600 }}
              onClick={() => navigate("/map-editor?create=outdoor-point")}
            >
              ＋ Create Outdoor Point Location
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
                setCustomFloorMode(false);
                setLockedParentId(null);
                openDialog("add");
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
      {error && !dialog && (
        <div className="error" role="alert" style={{ background: "#fee2e2", color: "#dc2626", padding: "10px 16px", borderRadius: "12px" }}>
          {error}
        </div>
      )}

      {/* Success Dialogs */}
      {success && (
        <div className="modal-backdrop locations-overlay">
          <div className="modal-card locations-modal-card" role="dialog" aria-modal="true" aria-labelledby="location-success-title" aria-describedby="location-success-description" style={{ background: "#fff", borderRadius: "28px", padding: "32px", width: "480px", maxWidth: "90%", textAlign: "center", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <div style={{ width: "54px", height: "54px", background: "#d6ede0", color: "#0c7441", borderRadius: "50%", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 id="location-success-title" tabIndex={-1} style={{ fontSize: "24px", color: "#191c1d", margin: "0 0 8px" }}>
              {success.kind === "added" ? "Location added" : "Location updated"}
            </h2>
            <p id="location-success-description" style={{ color: "#525c57", fontSize: "15px", margin: "0 0 24px" }}>
              <strong>{success.name}</strong> was {success.kind === "added" ? "added" : "updated"}
              {success.building ? ` under ${success.building}${success.floor ? ` / ${success.floor}` : ""}.` : "."}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <Button style={{ width: "100%", background: "#0c7441", color: "#fff", height: "48px", borderRadius: "999px" }} onClick={() => navigate(`/map-editor?location=${success.mapTargetId}`)}>
                {success.indoor ? "View parent building on map" : success.kind === "added" ? "Place on map" : "Edit position on map"}
              </Button>
              <Button data-modal-initial variant="subtle" style={{ width: "100%", height: "44px", borderRadius: "999px" }} onClick={() => setSuccess(null)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}

      {importSuccess !== null && (
        <div className="modal-backdrop locations-overlay">
          <div className="modal-card locations-modal-card" role="dialog" aria-modal="true" aria-labelledby="location-import-success-title" aria-describedby="location-import-success-description" style={{ background: "#fff", borderRadius: "28px", padding: "32px", width: "480px", maxWidth: "90%", textAlign: "center" }}>
            <div style={{ width: "54px", height: "54px", background: "#d6ede0", color: "#0c7441", borderRadius: "50%", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 id="location-import-success-title" tabIndex={-1} style={{ fontSize: "24px", color: "#191c1d", margin: "0 0 8px" }}>Locations Imported</h2>
            <p id="location-import-success-description" style={{ color: "#525c57", fontSize: "15px", margin: "0 0 24px" }}>
              <strong>{importSuccess} locations</strong> were imported into the campus directory successfully.
            </p>
            <Button data-modal-initial style={{ width: "100%", background: "#0c7441", color: "#fff", height: "48px", borderRadius: "999px" }} onClick={() => setImportSuccess(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {/* Main Table Card */}
      {listError && !dialog && <div className="error" role="alert" style={{ background: "#fee2e2", color: "#991b1b", padding: "10px 16px", borderRadius: "12px", marginBottom: "12px" }}>
        Unable to load campus locations. {listError instanceof Error ? listError.message : "The Locations service returned an error."}
      </div>}
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
          {isLoading && !data ? (
            <div role="status" aria-live="polite" style={{ padding: "48px 24px", textAlign: "center", color: "#525c57" }}>
              Loading campus locations…
            </div>
          ) : listError ? (
            <div role="alert" style={{ padding: "48px 24px", textAlign: "center", color: "#991b1b" }}>
              Campus locations are unavailable. No location records were loaded.
            </div>
          ) : (
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
                  <td style={{ padding: "16px 20px", textAlign: "right", position: "relative", zIndex: actionMenuId === item.id ? 50 : 0 }}>
                    {item.type !== "Floor" && <div style={{ display: "inline-flex", gap: "6px" }} ref={actionMenuId === item.id ? actionMenuRef : undefined}>
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
                          onMouseDown={(event) => event.stopPropagation()}
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
                              const parent = item.parentId ? allLocations.find((location) => location.id === item.parentId && location.type === "Building") : undefined;
                              if (isChildLocation(item) && !parent) {
                                setError(`Unable to locate ${item.name}: its parent Building is missing. Edit the location to restore its hierarchy.`);
                                setActionMenuId(null);
                                return;
                              }
                              const target = isChildLocation(item) && parent ? parent.id : item.id;
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
                              openDialog("history");
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
                              openDialog("remove");
                              setActionMenuId(null);
                            }}
                          >
                            Delete location
                          </button>
                        </div>
                      )}
                    </div>}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          )}
          {!isLoading && !listError && data && !items.length && (
            <Empty>{query ? "No campus location records matching filter criteria." : "No campus location records have been created yet."}</Empty>
          )}
        </div>
        <Pagination
          total={data?.total ?? 0}
          page={page}
          pageSize={pageSize}
          onChange={setPage}
        />
      </Card>

      {/* Add / Edit Location Modal */}
      {(dialog === "add" || dialog === "edit") && (
        <div className="modal-backdrop locations-overlay">
          <div className="modal-card locations-modal-card" role="dialog" aria-modal="true" aria-labelledby="location-form-title" aria-describedby="location-form-description" style={{ background: "#fff", borderRadius: "28px", overflow: "hidden", width: "720px", maxWidth: "95%", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            {/* Top Green Banner */}
            <div style={{ background: "#005931", color: "#fff", padding: "24px 30px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "grid", placeItems: "center" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 21h18M4 18h16M6 18V9M10 18V9M14 18V9M18 18V9M12 3l9 4.5H3L12 3z" />
                  </svg>
                </div>
                <div>
                  <h2 id="location-form-title" tabIndex={-1} style={{ fontSize: "22px", fontWeight: "bold", margin: 0 }}>
                    {dialog === "add" ? "Add Location" : "Edit Location"}
                  </h2>
                  <p id="location-form-description" style={{ margin: "4px 0 0", color: "#d6ede0", fontSize: "13px" }}>
                    Add a Room, Office, Laboratory, or Restroom under an existing Building.
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close location dialog"
                data-modal-initial
                onClick={closeOverlay}
                style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: "50%", width: "36px", height: "36px", cursor: "pointer", display: "grid", placeItems: "center" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Form Body */}
            <div className="locations-modal-body" style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: "16px", maxHeight: "70vh", overflowY: "auto" }}>
              {(error || fieldErrors.length > 0) && (
                <div role="alert" style={{ background: "#fee2e2", color: "#dc2626", padding: "10px 14px", borderRadius: "10px", fontSize: "13px" }}>
                  {error || <ul style={{ margin: 0, paddingLeft: "18px" }}>{fieldErrors.map(({ field, message }) => <li key={`${field}-${message}`}>{message}</li>)}</ul>}
                </div>
              )}
              <LocationDetailsFields
                draft={draft}
                allowedTypes={dialog === "add"
                  ? ["Laboratory", "Room", "Office", "Restroom"]
                  : ["Laboratory", "Room", "Office", "Facility", "Building", "Restroom", ...(draft.type === "Floor" ? ["Floor" as const] : [])]}
                errors={{ name: errorFor("name"), code: errorFor("code"), function: errorFor("function") }}
                statusEditable={API_MODE === "local"}
                onChange={setDraft}
                onTypeChange={(type) => setDraft(normalizeDraft({ ...draft, type }))}
              />

              {(isChildType(draft.type) || draft.parentId !== null) && (
                <div className="locations-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  <SelectField
                    label="PARENT BUILDING"
                    aria-label="PARENT BUILDING"
                    required
                    error={errorFor("parentId")}
                  value={draft.parentId ?? ""}
                    disabled={lockedParentId !== null}
                        onChange={(event) => {
                          const parent = buildingOptions.find((item) => item.id === event.target.value);
                          setCustomFloorMode(false);
                          setDraft(normalizeDraft({ ...draft, parentId: parent?.id ?? null, building: parent?.name }));
                    }}
                  >
                    <option value="">None / Standalone</option>
                    {buildingOptions.map((buildingOption) => (
                      <option key={buildingOption.id} value={buildingOption.id}>{buildingOption.name}</option>
                    ))}
                  </SelectField>
                  {lockedParentId && <p style={{ gridColumn: "1 / -1", margin: "-8px 0 0", color: "#365047", fontSize: "12px" }}>This Building was selected from its quick-add action and is locked to preserve that context.</p>}
                  {draft.type !== "Floor" && (
                    <div>
                      <SelectField
                        label="FLOOR LEVEL"
                        aria-label="FLOOR LEVEL"
                        required
                        error={!customFloorMode ? errorFor("floor") : undefined}
                        value={customFloorMode ? "__custom__" : draft.floor ?? ""}
                        onChange={(event) => {
                          const custom = event.target.value === "__custom__";
                          setCustomFloorMode(custom);
                          setDraft({ ...draft, floor: custom ? "" : event.target.value || undefined });
                        }}
                      >
                        <option value="">None</option>
                        {standardFloorLevels.map((floorLevel) => <option key={floorLevel} value={floorLevel}>{floorLevel}</option>)}
                        {dialog === "edit" && customFloorMode && <option value="__custom__">Custom Floor Level</option>}
                      </SelectField>
                      {customFloorMode && (
                        <Field label="CUSTOM FLOOR LEVEL" required value={draft.floor ?? ""} placeholder="Mezzanine" error={errorFor("floor")} onChange={(event) => setDraft({ ...draft, floor: event.target.value })} />
                      )}
                    </div>
                  )}
                </div>
              )}

              <p style={{ margin: 0, padding: "12px 14px", borderRadius: "10px", background: "#edf3f0", color: "#365047", fontSize: "13px" }}>
                {locationPolicy.classify(draft.type).kind === "indoor"
                  ? "Indoor Locations inherit map position and routing from their selected Building."
                  : "Spatial position is managed in Map Editor."}
              </p>

              {/* Upload Box */}
              <div style={{ border: `1px dashed ${errorFor("photo") ? "#dc2626" : "#d1d5db"}`, borderRadius: "14px", padding: "20px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f9fafb", gap: "16px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                  {draft.photo ? <img src={draft.photo.dataUrl} alt="Selected location photo preview" style={{ width: "56px", height: "56px", objectFit: "cover", borderRadius: "8px" }} /> : <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "#d6ede0", display: "grid", placeItems: "center" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0c7441" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                    </svg>
                  </div>}
                  <div>
                    <strong style={{ fontSize: "14px", color: "#191c1d" }}>Upload a campus location photo or image</strong>
                    <p style={{ margin: "2px 0 0", color: "#6b7280", fontSize: "12px" }}>{photoName || "PNG, JPEG, or WebP · max 5 MB"}</p>
                    <p style={{ margin: "3px 0 0", color: "#6b7280", fontSize: "11px" }}>{draft.hasPhoto && !draft.photo ? "Stored photo will be loaded from the photo service." : "PNG, JPEG, or WebP photos are stored with the Location."}</p>
                    {errorFor("photo") && <p role="alert" style={{ margin: "3px 0 0", color: "#dc2626", fontSize: "12px" }}>{errorFor("photo")}</p>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <label style={{ border: "1px solid #0c7441", borderRadius: "999px", padding: "8px 12px", color: "#0c7441", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}>
                    {draft.photo ? "Replace photo" : "Choose photo"}
                    <input aria-label="Upload location photo" type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={(event) => selectPhoto(event.target.files?.[0])} />
                  </label>
                  {(draft.photo || draft.hasPhoto) && <Button type="button" variant="subtle" onClick={removePhoto} style={{ padding: "8px 12px", fontSize: "12px" }}>Remove</Button>}
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div style={{ padding: "18px 32px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <Button variant="subtle" style={{ borderRadius: "999px", padding: "0 22px" }} onClick={closeOverlay}>
                Cancel
              </Button>
              <Button disabled={saving} aria-busy={saving} style={{ borderRadius: "999px", padding: "0 24px", background: "#005931", color: "#fff" }} onClick={save}>
                {saving ? "Saving…" : "Save Location"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {dialog === "remove" && selected && (
        <div className="modal-backdrop locations-overlay">
          <div className="modal-card locations-modal-card" role="dialog" aria-modal="true" aria-labelledby="location-delete-title" aria-describedby="location-delete-description" style={{ background: "#fff", borderRadius: "28px", padding: "32px", width: "460px", maxWidth: "90%", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#fee2e2", color: "#dc2626", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div>
                <h2 id="location-delete-title" tabIndex={-1} style={{ fontSize: "20px", fontWeight: "bold", margin: 0, color: "#191c1d" }}>Delete location?</h2>
                <strong style={{ display: "block", marginTop: "4px", color: "#191c1d", fontSize: "14px" }}>Delete {selected.name}?</strong>
                <p id="location-delete-description" style={{ margin: "4px 0 0", color: "#525c57", fontSize: "14px" }}>
                  {selectedChildren.length > 0
                    ? `This Building contains ${selectedChildren.length} associated Indoor Locations. Deleting this Building will permanently remove it and its child Locations. This action cannot be undone.`
                    : `This will permanently delete ${selected.name} from ${selected.building ?? "campus"}${selected.floor ? ` / ${selected.floor}` : ""}. This action cannot be undone.`}
                </p>
              </div>
            </div>
            {error && <div role="alert" aria-live="assertive" style={{ background: "#fee2e2", color: "#dc2626", padding: "10px 14px", borderRadius: "10px", fontSize: "13px", marginBottom: "16px" }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "24px" }}>
              <Button disabled={deleting} data-modal-initial variant="subtle" style={{ borderRadius: "999px", padding: "0 20px" }} onClick={closeOverlay}>
                Cancel
              </Button>
              <Button disabled={deleting} style={{ background: "#dc2626", color: "#fff", borderRadius: "999px", padding: "0 22px" }} onClick={remove}>
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* View History Modal */}
      {dialog === "history" && selected && (
        <div className="modal-backdrop locations-overlay">
          <div className="modal-card locations-modal-card" role="dialog" aria-modal="true" aria-labelledby="location-history-title" aria-describedby="location-history-description" style={{ background: "#fff", borderRadius: "28px", padding: "32px", width: "540px", maxWidth: "95%", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <h2 id="location-history-title" tabIndex={-1} style={{ fontSize: "22px", fontWeight: "bold", margin: 0, color: "#191c1d" }}>Audit History</h2>
            <p style={{ color: "#0c7441", fontWeight: 600, margin: "4px 0 2px" }}>{selected.name}</p>
            <p id="location-history-description" style={{ color: "#6b7280", fontSize: "13px", margin: "0 0 20px" }}>Record changes for this location.</p>

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
              <Button variant="subtle" data-modal-initial style={{ borderRadius: "999px", width: "100%", border: "1px solid #0c7441", color: "#0c7441" }} onClick={closeOverlay}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {dialog === "import" && (
        <div className="modal-backdrop locations-overlay">
          <div className="modal-card locations-modal-card" role="dialog" aria-modal="true" aria-labelledby="location-import-title" aria-describedby="location-import-description" style={{ background: "#fff", borderRadius: "28px", overflow: "hidden", width: "560px", maxWidth: "95%", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <div style={{ background: "#005931", color: "#fff", padding: "20px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
                <div style={{ width: "42px", height: "42px", borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "grid", placeItems: "center" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                  </svg>
                </div>
                <div>
                  <h2 id="location-import-title" tabIndex={-1} style={{ fontSize: "20px", fontWeight: "bold", margin: 0, color: "#fff" }}>Bulk Import Locations</h2>
                  <p id="location-import-description" style={{ margin: "2px 0 0", color: "#d6ede0", fontSize: "13px" }}>
                    Validate campus location records before importing.
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close import dialog"
                data-modal-initial
                onClick={closeOverlay}
                style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: "50%", width: "34px", height: "34px", cursor: "pointer", display: "grid", placeItems: "center" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="locations-modal-body" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: "20px" }}>
              {error && <div role="alert" aria-live="assertive" style={{ background: "#fee2e2", color: "#dc2626", padding: "10px 14px", borderRadius: "10px", fontSize: "13px" }}>{error}</div>}
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
                <div role={importResult.errors.length ? "alert" : "status"} aria-live="polite" style={{ padding: "10px 14px", borderRadius: "10px", background: importResult.errors.length ? "#fee2e2" : "#e6f7ec", color: importResult.errors.length ? "#dc2626" : "#0c7441", fontSize: "13px" }}>
                  {importResult.errors.length ? <ul style={{ margin: 0, paddingLeft: "18px" }}>{importResult.errors.map((message) => <li key={message}>{message}</li>)}</ul> : `Validation passed for ${importResult.imported} locations.`}
                </div>
              )}
            </div>

            <div style={{ padding: "18px 28px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", gap: "12px", alignItems: "center" }}>
              <Button variant="subtle" style={{ borderRadius: "999px", padding: "0 22px", height: "46px", border: "1px solid #d1d5db", color: "#191c1d" }} onClick={closeOverlay}>
                Cancel
              </Button>
              <Button
                variant="subtle"
                style={{ borderRadius: "999px", padding: "0 22px", height: "46px", border: "1.5px solid #0c7441", color: "#0c7441", fontWeight: 600 }}
                disabled={validating || importing}
                aria-busy={validating}
                onClick={validateImport}
              >
                {validating ? "Validating…" : "Validate"}
              </Button>
              <Button
                style={{ borderRadius: "999px", padding: "0 24px", height: "46px", background: "#005931", color: "#fff", fontWeight: 600 }}
                disabled={validating || importing || !importResult || importResult.errors.length > 0}
                aria-busy={importing}
                onClick={applyImport}
              >
                {importing ? "Importing…" : "Import Locations"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
