import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { API_MODE, services, setMockFailure } from "../../services/api";
import {
  Button,
  Card,
  Empty,
  Field,
  Pagination,
  SelectField,
} from "../../components/UI";
import type { Location, LocationDraft, LocationPhotoDraft, LocationType } from "../../types";
import { locations as initialLocations } from "../../services/mockData";
import locationsModuleIcon from "../../assets/figma/modules/locations.svg";
import { indoorLocationTypes, locationIdentityKey, locationPolicy, standardFloorLevels } from "../../lib/locationPolicy";
import { LocationCoordinatesFields, LocationDetailsFields } from "./LocationDetailsModal";
import { LocationTypeIcon } from "./LocationTypeIcon";
import { LocationPhotoUpload } from "./LocationPhotoUpload";

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

type LocationsRouteState = {
  indoorLocationParent?: Location;
};

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
  const [targetKey, setTargetKey] = useState<string | null>(() => new URLSearchParams(routeLocation.search).get("locationKey"));
  useEffect(() => {
    const params = new URLSearchParams(routeLocation.search);
    const q = params.get("q");
    setQuery(q ?? "");
    setTargetKey(params.get("locationKey"));
  }, [routeLocation.search]);

  const [type, setType] = useState("All Types");
  const [status, setStatus] = useState("All Statuses");
  const [buildingId, setBuildingId] = useState("All Buildings");
  const [floorId, setFloorId] = useState("All Floors");
  const [viewMode, setViewMode] = useState<"hierarchy" | "flat">("hierarchy");
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());

  const [dialog, setDialog] = useState<
    "add" | "edit" | "history" | "remove" | null
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
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Array<{ field?: keyof LocationDraft; message: string }>>([]);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [photos, setPhotos] = useState<LocationPhotoDraft[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [photoLoadFailed, setPhotoLoadFailed] = useState(false);
  const photoLoadSequence = useRef(0);
  const photosRef = useRef<LocationPhotoDraft[]>([]);
  photosRef.current = photos;
  const releasePhotoPreviews = () => {
    photosRef.current.forEach((photo) => { if (photo.previewUrl.startsWith("blob:")) URL.revokeObjectURL(photo.previewUrl); });
  };
  const [customFloorMode, setCustomFloorMode] = useState(false);
  const [success, setSuccess] = useState<{
    name: string;
    id: string;
    building?: string;
    floor?: string;
    mapTargetId: string;
    indoor: boolean;
    positioned: boolean;
    kind: "added" | "edited";
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const processedIndoorHandoffRef = useRef<string | null>(null);
  const pendingRef = useRef(false);
  pendingRef.current = saving || deleting;

  const activeOverlay = success ? "success" : dialog;
  const openDialog = (next: NonNullable<typeof dialog>) => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialog(next);
  };
  const closeOverlay = () => {
    if (pendingRef.current) return;
    photoLoadSequence.current += 1;
    releasePhotoPreviews();
    setPhotos([]);
    setDialog(null);
    setSuccess(null);
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
    const focusable = () => Array.from(overlay.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    const initial = overlay.querySelector<HTMLElement>("[data-modal-initial]") ?? focusable()[0];
    // Move focus into the dialog before hiding the opener's container. Chrome
    // otherwise rejects aria-hidden while the opener still owns focus.
    initial?.focus();
    backgroundNodes.forEach((node) => {
      node.setAttribute("aria-hidden", "true");
      (node as HTMLElement).inert = true;
    });
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
    queryKey: ["logs", "location-history", selected ? locationIdentityKey(selected) : null],
    queryFn: () => services.logs.forLocation(selected!.id, selected!.name, selected!.type),
    enabled: dialog === "history" && selected !== null,
  });

  const routeState = routeLocation.state as LocationsRouteState | null;
  const handoffParent = routeState?.indoorLocationParent;
  const allLocations = useMemo(() => {
    const locations = directory ?? (API_MODE === "local" ? initialLocations : []);
    const withHandoff = !handoffParent || locations.some((item) => locationIdentityKey(item) === locationIdentityKey(handoffParent))
      ? locations
      : [...locations, handoffParent];
    return [...new Map(withHandoff.map((item) => [locationIdentityKey(item), item])).values()];
  }, [directory, handoffParent]);
  const isChildType = (type: LocationType) => locationPolicy.classify(type).requiresBuildingParent;
  const normalizeDraft = (next: LocationDraft) => locationPolicy.normalize(next, {
    directory: allLocations,
    previous: draft,
  });

  useEffect(() => {
    const params = new URLSearchParams(routeLocation.search);
    if (params.get("add") !== "indoor") {
      processedIndoorHandoffRef.current = null;
      return;
    }
    const parentId = params.get("parentId") ?? params.get("buildingId");
    const handoffKey = `${parentId ?? ""}:${params.get("floor") ?? ""}`;
    if (processedIndoorHandoffRef.current === handoffKey) return;
    const parent = parentId ? allLocations.find((item) => item.id === parentId && item.type === "Building") : undefined;
    if (!parent) {
      if (allLocations.length) setError("The selected Building is unavailable for an Indoor Location handoff.");
      return;
    }
    processedIndoorHandoffRef.current = handoffKey;
    const floor = params.get("floor") ?? "";
    photoLoadSequence.current += 1;
    releasePhotoPreviews();
    setPhotos([]);
    setLoadingPhotos(false);
    setPhotoLoadFailed(false);
    setSelected(parent);
    setDraft({ ...blankLocation(), type: "Room", parentId: parent.id, building: parent.name, floor: floor || undefined });
    setLockedParentId(parent.id);
    setCustomFloorMode(Boolean(floor && !standardFloorLevels.includes(floor as typeof standardFloorLevels[number])));
    setFieldErrors([]);
    setError("");
    openDialog("add");
  }, [allLocations, routeLocation.search]);
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
  const selectedBuildingRecord = allLocations.find((item) => item.type === "Building" && item.id === buildingId);
  const availableFloors = useMemo(() => {
    if (buildingId === "All Buildings" || !selectedBuildingRecord) return floors;
    return floors.filter((f) => f.parentId === selectedBuildingRecord.id);
  }, [floors, buildingId, selectedBuildingRecord]);

  useEffect(() => {
    const buildingIsValid = buildingId === "All Buildings" || buildingOptions.some((option) => option.id === buildingId);
    if (!buildingIsValid) {
      setBuildingId("All Buildings");
      setFloorId("All Floors");
      return;
    }
    if (floorId !== "All Floors" && !availableFloors.some((floor) => floor.id === floorId)) {
      setFloorId("All Floors");
    }
  }, [buildingId, buildingOptions, floorId, availableFloors]);

  const selectedFloorRecord = floorId === "All Floors" ? undefined : floors.find((floor) => floor.id === floorId);
  const { data, isLoading, error: listError } = useQuery({
    queryKey: ["locations", "page", query, page, type, status, buildingId, selectedFloorRecord?.name],
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
        (!targetKey || locationIdentityKey(item) === targetKey) &&
        (type === "All Types" || item.type === type) &&
        (status === "All Statuses" || status === "All Status" || item.status === status) &&
        (buildingId === "All Buildings" || item.parentId === buildingId || ((item.type === "Building" || item.type === "Facility") && item.id === buildingId)) &&
        (floorId === "All Floors" || (item.type === "Floor" && item.id === floorId) || item.parentId === floorId || (item.floor === selectedFloorRecord?.name && item.parentId === selectedFloorRecord?.parentId)),
    );
  }, [rawItems, targetKey, type, status, buildingId, floorId, selectedFloorRecord]);

  useEffect(() => setPage(1), [query, type, status, buildingId, floorId, viewMode]);

  const hierarchyItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return allLocations.filter((item) =>
      (!targetKey || locationIdentityKey(item) === targetKey) &&
      (!normalizedQuery || [item.name, item.code, item.type, item.function ?? "", item.keywords ?? "", item.building ?? "", item.floor ?? ""]
        .some((value) => value.toLowerCase().includes(normalizedQuery))) &&
      (type === "All Types" || item.type === type) &&
      (status === "All Statuses" || status === "All Status" || item.status === status) &&
      (buildingId === "All Buildings" || item.parentId === buildingId || ((item.type === "Building" || item.type === "Facility") && item.id === buildingId)) &&
      (floorId === "All Floors" || (item.type === "Floor" && item.id === floorId) || item.parentId === floorId || (item.floor === selectedFloorRecord?.name && item.parentId === selectedFloorRecord?.parentId))
    );
  }, [allLocations, query, targetKey, type, status, buildingId, floorId, selectedFloorRecord]);

  const matchingKeys = useMemo(() => new Set((viewMode === "hierarchy" ? hierarchyItems : items).map(locationIdentityKey)), [hierarchyItems, items, viewMode]);

  // Build complete hierarchy families. Filtering can reduce a family to the
  // matching descendants, but a matching indoor record always keeps its root
  // Building and Floor Level context visible.
  const hierarchyFamilies = useMemo(() => {
    if (viewMode === "flat") return items.map((item) => [{ item, level: 0, hasChildren: false, isLast: false, isCollapsed: false }]);

    const result: Array<Array<{ item: Location; level: number; hasChildren: boolean; isLast: boolean; isCollapsed: boolean }>> = [];

    // Find roots
    const rootBuildings = allLocations.filter((loc) => loc.type === "Building" && (
      matchingKeys.has(locationIdentityKey(loc)) || allLocations.some((child) => matchingKeys.has(locationIdentityKey(child)) && child.parentId === loc.id)
    ));
    const standalone = hierarchyItems.filter((loc) => loc.parentId === null && loc.type === "Facility");

    for (const bldg of rootBuildings) {
      const rootWasMatched = matchingKeys.has(locationIdentityKey(bldg));
      const bldgCollapsed = collapsedNodes.has(bldg.id);
      const childLocations = allLocations.filter((loc) =>
        loc.type !== "Floor" && loc.type !== "Building" &&
        loc.parentId === bldg.id &&
        (rootWasMatched || matchingKeys.has(locationIdentityKey(loc))),
      );
      const explicitFloors = allLocations.filter((loc) =>
        loc.parentId === bldg.id &&
        loc.type === "Floor" &&
        (rootWasMatched || childLocations.some((child) =>
          child.parentId === loc.id ||
          (child.floor === loc.name && child.parentId === bldg.id)
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
            (loc) => matchingKeys.has(locationIdentityKey(loc)) && (loc.parentId === flr.id || (loc.parentId === bldg.id && loc.floor === flr.name && loc.type !== "Floor" && loc.type !== "Building"))
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
    const includedKeys = new Set(result.flat().map((r) => locationIdentityKey(r.item)));
    for (const item of hierarchyItems) {
      if (!includedKeys.has(locationIdentityKey(item))) {
        result.push([{ item, level: 0, hasChildren: false, isLast: false, isCollapsed: false }]);
      }
    }

    return result;
  }, [items, hierarchyItems, matchingKeys, allLocations, viewMode, collapsedNodes]);

  const hierarchyRows = hierarchyFamilies.flat();
  const hierarchyTotal = hierarchyFamilies.length;
  const hierarchyDisplayCount = hierarchyItems.filter((item) => item.type !== "Floor").length;
  const hierarchyPageCount = Math.max(1, Math.ceil(hierarchyTotal / pageSize));
  const effectiveHierarchyPage = Math.min(page, hierarchyPageCount);
  const pagedFamilies = viewMode === "hierarchy"
    ? hierarchyFamilies.slice((effectiveHierarchyPage - 1) * pageSize, effectiveHierarchyPage * pageSize)
    : hierarchyFamilies;
  const visibleRows = pagedFamilies.flat();
  const uniqueVisibleRows = visibleRows.filter(({ item }, index, rows) => rows.findIndex((row) => locationIdentityKey(row.item) === locationIdentityKey(item)) === index);

  useEffect(() => {
    if (viewMode !== "hierarchy") return;
    setPage((current) => Math.min(current, hierarchyPageCount));
  }, [viewMode, hierarchyPageCount]);

  useEffect(() => {
    if (!data || viewMode === "hierarchy") return;
    const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
    setPage((current) => Math.min(current, totalPages));
  }, [data, viewMode]);

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

  const save = async (): Promise<Location | null> => {
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
      return null;
    }
    setSaving(true);
    try {
      // A Map Editor Building can be handed off before its directory query has
      // refreshed. Register that local draft in the same fixture store before
      // saving its child so the parent relationship remains valid end to end.
      if (adding && API_MODE === "local" && handoffParent && !directory?.some((item) => item.id === handoffParent.id)) {
        await services.locations.save(handoffParent);
      }
      let saved = await services.locations.save(normalized, photos);
      if (isChildType(saved.type) && saved.parentId && normalized.lat !== null && normalized.lng !== null) {
        saved = await services.locations.saveIndoorPosition({
          id: saved.id,
          buildingId: saved.parentId,
          lat: normalized.lat ?? null,
          lng: normalized.lng ?? null,
        });
      }
      await refresh();
      releasePhotoPreviews();
      setPhotos([]);
      setDialog(null);
      setNotice(`${draft.name || "Location"} saved successfully.`);
      setSuccess({
        name: saved.name || "Location",
        id: saved.id,
        building: normalized.building,
        floor: normalized.floor,
        mapTargetId: isChildType(saved.type) && saved.parentId ? saved.parentId : saved.id,
        indoor: isChildType(saved.type),
        positioned: saved.positioned,
        kind: adding ? "added" : "edited",
      });
      return saved;
    } catch (cause) {
      const backendFields = (cause as Error & { fieldErrors?: Record<string, string> }).fieldErrors;
      if (backendFields) {
        setFieldErrors(Object.entries(backendFields).map(([field, message]) => ({ field: field as keyof LocationDraft, message })));
      }
      setError(
        cause instanceof Error ? cause.message : "Unable to save location.",
      );
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveAndLocateIndoorLocation = async () => {
    if (!isChildType(draft.type)) return;
    const saved = await save();
    if (saved?.parentId) navigate(`/map-editor?indoorLocation=${encodeURIComponent(saved.id)}`);
  };

  const remove = async () => {
    if (!selected) return;
    setError("");
    setDeleting(true);
    try {
      await services.locations.remove(selected.id, selected.type);
      await refresh();
      setDialog(null);
      setNotice(`${selected.name} permanently deleted.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete location.");
    } finally {
      setDeleting(false);
    }
  };

  const openEdit = (item: Location) => {
    setSelected(item);
    setDraft({ ...item, photoRemoved: false });
    releasePhotoPreviews();
    setPhotos([]);
    setLoadingPhotos(true);
    setPhotoLoadFailed(false);
    setCustomFloorMode(Boolean(item.floor && !(standardFloorLevels as readonly string[]).includes(item.floor)));
    setLockedParentId(null);
    openDialog("edit");
    const sequence = ++photoLoadSequence.current;
    void services.locations.getPhotos(item.id, item.type).then((loaded) => {
      if (sequence !== photoLoadSequence.current) {
        loaded.forEach((photo) => { if (photo.previewUrl.startsWith("blob:")) URL.revokeObjectURL(photo.previewUrl); });
        return;
      }
      setPhotos(loaded);
    }).catch((cause) => {
      if (sequence === photoLoadSequence.current) {
        setPhotoLoadFailed(true);
        setError(cause instanceof Error ? cause.message : "Unable to load location photos.");
      }
    }).finally(() => {
      if (sequence === photoLoadSequence.current) setLoadingPhotos(false);
    });
  };

  const openAddRoom = (parent: Location) => {
    photoLoadSequence.current += 1;
    setLoadingPhotos(false);
    setPhotoLoadFailed(false);
    setSelected(parent);
    setDraft({
      ...blankLocation(),
      type: "Room",
      parentId: parent.id,
      building: parent.name,
      floor: undefined,
    });
    releasePhotoPreviews();
    setPhotos([]);
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
            Manage Buildings and Indoor Locations. Create mapped campus places in Map Editor.
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
            onChange={(event) => {
              setTargetKey(null);
              setQuery(event.target.value);
            }}
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
              value={buildingId}
              onChange={(event) => {
                setBuildingId(event.target.value);
                setFloorId("All Floors");
              }}
              style={{ background: "#ffffff", borderRadius: "18px", minWidth: "140px", height: "46px" }}
            >
              <option>All Buildings</option>
              {buildingOptions.map((value) => (
                <option key={value.id} value={value.id}>{value.name}</option>
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
                photoLoadSequence.current += 1;
                setLoadingPhotos(false);
                setPhotoLoadFailed(false);
                setDraft(blankLocation());
                releasePhotoPreviews();
                setPhotos([]);
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
              <Button style={{ width: "100%", background: "#0c7441", color: "#fff", height: "48px", borderRadius: "999px" }} onClick={() => navigate(success.indoor ? `/map-editor?indoorLocation=${encodeURIComponent(success.id)}` : `/map-editor?location=${encodeURIComponent(success.mapTargetId)}`)}>
                {success.indoor ? success.positioned ? "View location on map" : "Place location on map" : success.kind === "added" ? "Place on map" : "Edit position on map"}
              </Button>
              <Button data-modal-initial variant="subtle" style={{ width: "100%", height: "44px", borderRadius: "999px" }} onClick={() => setSuccess(null)}>
                Done
              </Button>
            </div>
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
              {isLoading ? "Loading…" : `${viewMode === "hierarchy" ? hierarchyDisplayCount : data?.total ?? 0} locations`}
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
              {uniqueVisibleRows.map(({ item, level, hasChildren, isCollapsed }, index) => {
                const isNearBottom = index >= 3 && index >= uniqueVisibleRows.length - 2;
                return (
                <tr key={locationIdentityKey(item)} style={{ borderBottom: "1px solid #f3f4f6", transition: "background 0.15s" }}>
                  <td colSpan={item.type === "Floor" ? 6 : undefined} style={{ padding: "16px 20px" }}>
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
                      <div className="location-type-symbol" aria-hidden="true" style={{ width: "34px", height: "34px", borderRadius: "10px", background: "#f3f4f6", display: "grid", placeItems: "center", marginRight: "12px", flexShrink: 0, opacity: 1 }}>
                        <LocationTypeIcon type={item.type} />
                      </div>
                      <div>
                        <strong style={{ display: "block", fontSize: "14px", color: "#111827" }}>{item.name}</strong>
                        {item.type !== "Floor" && (
                          <small style={{ color: "#6b7280", fontSize: "12px" }}>{item.code}</small>
                        )}
                        {level > 0 && item.floor && (
                          <span style={{ display: "inline-block", marginTop: "5px", padding: "2px 8px", borderRadius: "999px", background: "#eef6f1", color: "#0c7441", fontSize: "11px", fontWeight: 600 }}>
                            {item.floor}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  {item.type !== "Floor" && <>
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
                  <td style={{ padding: "16px 20px", textAlign: "right", position: "relative", zIndex: actionMenuId === locationIdentityKey(item) ? 50 : 0 }}>
                    <div style={{ display: "inline-flex", gap: "6px" }} ref={actionMenuId === locationIdentityKey(item) ? actionMenuRef : undefined}>
                      <button
                        className="table-action menu-trigger"
                        aria-label={`Actions for ${item.name}`}
                        aria-expanded={actionMenuId === locationIdentityKey(item)}
                        onClick={() => setActionMenuId((current) => (current === locationIdentityKey(item) ? null : locationIdentityKey(item)))}
                        style={{ background: "#f3f4f6", border: "none", borderRadius: "8px", width: "34px", height: "34px", cursor: "pointer", fontSize: "16px", color: "#4b5563" }}
                      >
                        •••
                      </button>
                      {actionMenuId === locationIdentityKey(item) && (
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
                              const parent = item.parentId
                                ? allLocations.find((location) => location.id === item.parentId && location.type === "Building")
                                  ?? allLocations.find((location) => location.name === item.building && location.type === "Building")
                                : undefined;
                              if (isChildLocation(item) && !parent) {
                                setError(`Unable to locate ${item.name}: its parent Building is missing. Edit the location to restore its hierarchy.`);
                                setActionMenuId(null);
                                return;
                              }
                              if (isChildLocation(item)) navigate(`/map-editor?indoorLocation=${encodeURIComponent(item.id)}`);
                              else navigate(`/map-editor?location=${encodeURIComponent(item.id)}`);
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
                    </div>
                  </td>
                  </>}
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
          total={viewMode === "hierarchy" ? hierarchyTotal : data?.total ?? 0}
          page={viewMode === "hierarchy" ? effectiveHierarchyPage : page}
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
                  : draft.type === "Building"
                    ? ["Building", "Facility"]
                    : draft.type === "Facility"
                      ? ["Facility"]
                    : ["Laboratory", "Room", "Office", "Restroom", ...(draft.type === "Floor" ? ["Floor" as const] : [])]}
                errors={{ name: errorFor("name"), code: errorFor("code"), function: errorFor("function") }}
                statusEditable={API_MODE === "local"}
                onChange={setDraft}
                onTypeChange={(type) => setDraft(normalizeDraft({ ...draft, type }))}
              />

              <LocationCoordinatesFields
                lat={draft.lat}
                lng={draft.lng}
                positioned={draft.positioned}
                parentLabel={draft.building}
                onPickOnMap={isChildType(draft.type)
                  ? () => { void saveAndLocateIndoorLocation(); }
                  : undefined}
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

              {locationPolicy.classify(draft.type).kind === "indoor" && <p style={{ margin: 0, padding: "12px 14px", borderRadius: "10px", background: "#edf3f0", color: "#365047", fontSize: "13px" }}>
                Indoor Locations inherit map position and routing from their selected Building.
              </p>}

              {/* Upload Box */}
              <LocationPhotoUpload photos={photos} onChange={setPhotos} loading={loadingPhotos} error={errorFor("photo")} />
            </div>

            {/* Bottom Actions */}
            <div style={{ padding: "18px 32px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <Button variant="subtle" style={{ borderRadius: "999px", padding: "0 22px" }} onClick={closeOverlay}>
                Cancel
              </Button>
              <Button disabled={saving || loadingPhotos || photoLoadFailed} aria-busy={saving} style={{ borderRadius: "999px", padding: "0 24px", background: "#005931", color: "#fff" }} onClick={save}>
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

    </div>
  );
}
