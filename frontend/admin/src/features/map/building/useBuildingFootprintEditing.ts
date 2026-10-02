import { useCallback, useEffect, useMemo, useState } from "react";
import { services } from "../../../services/api";
import type { Building, Location, RouteNode } from "../../../types";
import { geometryOnCampus, type MapPoint } from "../campusBoundary";
import { polygonFeatureAnchor, polygonIsNonDegenerate, polygonSelfIntersects, translatePolygon } from "../mapEditing";
import type { MapOverlay } from "../session/useMapOverlay";
import type { SavingAction } from "../session/useSavingAction";
import type { ActiveToolDraft } from "../types";
import type { WorkingSessionManager } from "../WorkingSessionManager";
import {
  detectBuildingFootprintOverlap,
  getBuildingAttachmentEligibility,
  validateBuildingFootprintGeometry,
  validateBuildingIdentityDetails,
  type BuildingIdentityInput,
} from "./buildingFootprint";
import { createBuildingFootprintWorkflow } from "./BuildingFootprintWorkflow";

const blankBuildingForm = (): BuildingIdentityInput => ({
  name: "",
  code: `BLDG-${Date.now().toString().slice(-4)}`,
  function: "",
  keywords: "",
  status: "Active",
});

export interface BuildingEditingContext {
  sessionBuildings: Building[];
  associationOptions: Building[];
  locations: Location[];
  nodes: RouteNode[];
  campusBoundary: MapPoint[];
}

/** How the polygon tool finished: the caller returns to selection accordingly. */
export type BuildingEditingOutcome =
  | { kind: "cancelled" }
  | { kind: "reshaped"; buildingId: string }
  | { kind: "placed"; buildingId: string };

interface UseBuildingFootprintEditingOptions {
  workingSession: WorkingSessionManager;
  overlay: MapOverlay;
  saving: SavingAction;
  context: BuildingEditingContext;
  drawing: boolean;
  refreshMapData: () => Promise<void>;
  onError: (message: string) => void;
  onFinished: (outcome: BuildingEditingOutcome) => void;
}

/**
 * The polygon tool: drawing, reshaping, and moving a Building footprint, then
 * creating a new Building, attaching the footprint to an existing one, or
 * saving the reshape.
 */
export function useBuildingFootprintEditing({
  workingSession,
  overlay,
  saving,
  context,
  drawing,
  refreshMapData,
  onError,
  onFinished,
}: UseBuildingFootprintEditingOptions) {
  const {
    sessionBuildings,
    associationOptions: buildingAssociationOptions,
    locations: currentLocations,
    nodes: currentNodes,
    campusBoundary,
  } = context;
  const { beginSaving, endSaving } = saving;
  const setError = onError;

  const buildingFootprintWorkflow = useMemo(() => createBuildingFootprintWorkflow({
    adapter: {
      createBuilding: async (draft) => {
        if (typeof services.locations.save === "function") return services.locations.save(draft);
        return { ...draft, id: draft.id ?? `building-${Date.now()}` } as Location;
      },
      saveFootprint: async (building, footprintPoints) => {
        await services.map.save({ buildings: [{ ...building, points: [...footprintPoints] }] });
      },
    },
    workingSession,
  }), [workingSession]);

  const [points, setPoints] = useState<[number, number][]>([]);
  const [polygonInteraction, setPolygonInteraction] = useState<"draw" | "reshape" | "move">("draw");
  const [polygonClosed, setPolygonClosed] = useState(false);
  const [buildingWorkflowMode, setBuildingWorkflowMode] = useState<"create" | "attach">("create");
  const [buildingDetailsModalOpen, setBuildingDetailsModalOpen] = useState(false);
  const [buildingClassification, setBuildingClassification] = useState<"Building" | "Facility">("Building");
  const [attachBuildingSearch, setAttachBuildingSearch] = useState("");
  const [selectedAttachBuildingId, setSelectedAttachBuildingId] = useState<string | null>(null);
  const [nonRoutableBuildingId, setNonRoutableBuildingId] = useState<string | null>(null);
  const [buildingForm, setBuildingForm] = useState<BuildingIdentityInput>(blankBuildingForm);
  const buildingName = buildingForm.name;
  const buildingCode = buildingForm.code;
  const buildingFunction = buildingForm.function ?? "";
  const buildingKeywords = buildingForm.keywords ?? "";
  const resetBuildingForm = () => {
    setBuildingForm(blankBuildingForm());
    setBuildingClassification("Building");
  };
  const [editingBuildingId, setEditingBuildingId] = useState<string | null>(null);
  const polygonInvalid = polygonSelfIntersects(points) || !polygonIsNonDegenerate(points);

  const buildingAttachmentEligibility = (building: Building) =>
    getBuildingAttachmentEligibility(building);
  const selectedAttachBuilding = buildingAssociationOptions.find((b) => b.id === selectedAttachBuildingId);
  const selectedAttachEligibility = selectedAttachBuilding ? buildingAttachmentEligibility(selectedAttachBuilding) : null;
  const attachCandidateBuildings = useMemo(() => {
    const query = attachBuildingSearch.trim().toLowerCase();
    return buildingAssociationOptions.filter((building) => {
      if (building.id === "pending-building" || building.id === editingBuildingId) return false;
      const eligibility = getBuildingAttachmentEligibility(building);
      if (!eligibility.eligible) return false;
      return !query || `${building.name} ${building.code}`.toLowerCase().includes(query);
    });
  }, [attachBuildingSearch, buildingAssociationOptions, editingBuildingId]);
  const currentBuildings = useMemo(() => {
    const validMerged = sessionBuildings.filter((building) => building.points.length >= 3);
    if (!drawing || points.length === 0) return validMerged;
    const pending: Building = { id: editingBuildingId ?? "pending-building", name: buildingName, code: buildingCode, points };
    return editingBuildingId && validMerged.some((building) => building.id === editingBuildingId)
      ? validMerged.map((building) => building.id === editingBuildingId ? pending : building)
      : [...validMerged, pending];
  }, [buildingCode, buildingName, editingBuildingId, drawing, points, sessionBuildings]);
  const footprintGeometryIssues = useMemo(
    () => drawing ? validateBuildingFootprintGeometry(points, campusBoundary) : [],
    [campusBoundary, drawing, points],
  );
  const footprintOverlapWarning = useMemo(
    () => drawing
      ? detectBuildingFootprintOverlap(points, currentBuildings, editingBuildingId ?? "pending-building")
      : null,
    [currentBuildings, editingBuildingId, drawing, points],
  );
  const buildingIdentityIssues = useMemo(
    () => drawing && (polygonClosed || points.length >= 3) && buildingWorkflowMode === "create"
      ? validateBuildingIdentityDetails(
          { name: buildingName, code: buildingCode, function: buildingFunction, keywords: buildingKeywords, status: "Active" },
          currentLocations,
          editingBuildingId,
        )
      : [],
    [buildingCode, buildingFunction, buildingKeywords, buildingName, buildingWorkflowMode, currentLocations, editingBuildingId, drawing, points.length, polygonClosed],
  );
  const canFinishFootprint = points.length >= 3 && footprintGeometryIssues.length === 0;
  const canSaveBuilding = canFinishFootprint && buildingIdentityIssues.length === 0 && Boolean(buildingName.trim()) && Boolean(buildingCode.trim());

  const closePolygon = useCallback(() => {
    if (!drawing || points.length < 3) return;
    const geometryIssues = validateBuildingFootprintGeometry(points, campusBoundary);
    if (geometryIssues.length > 0) {
      setError(geometryIssues[0].message);
      return;
    }
    setPolygonClosed(true);
    setPolygonInteraction("draw");
    if (buildingWorkflowMode === "create") setBuildingDetailsModalOpen(true);
    setError("");
  }, [buildingWorkflowMode, campusBoundary, drawing, points]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") closePolygon();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePolygon]);

  const updatePolygonVertex = (index: number, point: [number, number]) => {
    setPoints((current) => {
      const next = current.map((candidate, candidateIndex) => candidateIndex === index ? point : candidate);
      if (!geometryOnCampus(next, campusBoundary)) {
        setError("The building footprint must stay inside the ISU Echague campus boundary.");
        return current;
      }
      setError("");
      return next;
    });
  };

  const insertPolygonVertex = (index: number) => {
    setPoints((current) => {
      const next = current[(index + 1) % current.length];
      const point: [number, number] = [(current[index][0] + next[0]) / 2, (current[index][1] + next[1]) / 2];
      return [...current.slice(0, index + 1), point, ...current.slice(index + 1)];
    });
  };

  const deletePolygonVertex = (index: number) => {
    if (points.length <= 3) return;
    setPoints((current) => current.filter((_, candidateIndex) => candidateIndex !== index));
  };

  const movePolygon = (point: [number, number]) => {
    if (!points.length) return;
    const anchor = polygonFeatureAnchor(points);
    const delta: [number, number] = [point[0] - anchor[0], point[1] - anchor[1]];
    const translated = translatePolygon(points, delta);
    if (geometryOnCampus(translated, campusBoundary)) setPoints(translated);
    else setError("The building footprint must stay inside the ISU Echague campus boundary.");
  };

  const clearDraft = () => {
    setPoints([]);
    resetBuildingForm();
    setEditingBuildingId(null);
    setAttachBuildingSearch("");
    setSelectedAttachBuildingId(null);
    setPolygonClosed(false);
    setPolygonInteraction("draw");
    setError("");
    setBuildingDetailsModalOpen(false);
  };

  const cancelDraft = () => {
    clearDraft();
    onFinished({ kind: "cancelled" });
  };

  const closeDetailsModal = () => {
    setBuildingDetailsModalOpen(false);
    setError("");
  };

  const saveBuilding = async () => {
    if (editingBuildingId) {
      if (!canFinishFootprint) return;
      if (!beginSaving("building")) return;
      const buildingForSave = currentBuildings.find((building) => building.id === editingBuildingId);
      if (!buildingForSave) {
        setError("This Building is no longer available. Reload the map and retry the footprint update.");
        endSaving();
        return;
      }
      const result = await buildingFootprintWorkflow.finalize({
        kind: "reshape",
        building: buildingForSave,
        points: [...points],
        context: { locations: currentLocations, campusBoundary },
      });
      if (!result.ok) {
        setError(result.message);
        endSaving();
        return;
      }
      overlay.refreshBuilding(result.building);
      void refreshMapData();
      clearDraft();
      onFinished({ kind: "reshaped", buildingId: editingBuildingId });
      endSaving();
    } else {
      if (!canSaveBuilding) return;
      createBuilding();
    }
  };

  const completeBuildingWorkflow = (
    result: Extract<Awaited<ReturnType<typeof buildingFootprintWorkflow.finalize>>, { ok: true }>,
  ) => {
    if (result.location) {
      overlay.putLocation(result.location!);
    }
    overlay.putBuilding(result.building);
    setPoints([]);
    resetBuildingForm();
    setAttachBuildingSearch("");
    setSelectedAttachBuildingId(null);
    setPolygonClosed(false);
    setPolygonInteraction("draw");
    const hasActiveEntrance = currentNodes.some((node) =>
      node.nodeType === "Entrance"
      && node.associatedPlaceId === result.building.id
      && node.status !== "Inactive",
    );
    setNonRoutableBuildingId(hasActiveEntrance ? null : result.building.id);
    onFinished({ kind: "placed", buildingId: result.building.id });
  };

  const createBuilding = async () => {
    if (!canSaveBuilding) {
      setError(buildingIdentityIssues[0]?.message ?? "Complete the required Building details.");
      return;
    }
    if (!beginSaving("building")) return;
    const result = await buildingFootprintWorkflow.finalize({
      kind: "create",
      identity: {
        name: buildingName,
        code: buildingCode,
        type: buildingClassification,
        function: buildingFunction,
        keywords: buildingKeywords,
        status: "Active",
      },
      points: [...points],
      context: { locations: currentLocations, campusBoundary },
    });
    if (!result.ok) {
      setError(result.message);
      endSaving();
      return;
    }
    setError("");
    setBuildingDetailsModalOpen(false);
    completeBuildingWorkflow(result);
    try {
      await refreshMapData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Building was saved, but the map could not refresh.");
    }
    endSaving();
  };

  const attachBuilding = async () => {
    const existing = buildingAssociationOptions.find((building) => building.id === selectedAttachBuildingId);
    if (!existing) return;
    if (!beginSaving("building")) return;
    const result = await buildingFootprintWorkflow.finalize({
      kind: "attach",
      building: existing,
      points: [...points],
      context: { locations: currentLocations, campusBoundary },
    });
    if (!result.ok) {
      setError(result.message);
      endSaving();
      return;
    }
    completeBuildingWorkflow(result);
    try {
      await refreshMapData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Building was saved, but the map could not refresh.");
    } finally {
      endSaving();
    }
  };

  const initializeFootprintEdit = (
    building: Building,
    interaction: "draw" | "reshape" | "move" = "draw",
  ) => {
    setEditingBuildingId(building.id);
    setBuildingForm({
      name: building.name,
      code: building.code,
      function: "",
      keywords: "",
      status: building.status ?? "Active",
    });
    setPoints([...building.points]);
    setPolygonInteraction(interaction);
    setPolygonClosed(true);
  };

  /** The polygon tool's draft, as persisted in the Working Session. */
  const draftSnapshot = useMemo<Omit<ActiveToolDraft, "id" | "isSuspended"> | null>(() => {
    return points.length > 0 ? ({
      toolType: "polygon",
      label: "Building Polygon draft",
      provisionalGeometry: {
        points: points.map(([lat, lng]) => ({ x: lng, y: lat, lat, lng })),
        isClosed: polygonClosed,
      },
      nestedRecords: {
        buildingForm,
        buildingName,
        buildingCode,
        buildingFunction,
        buildingKeywords,
        buildingClassification,
        editingBuildingId,
        polygonClosed,
        buildingDetailsModalOpen,
        polygonInteraction,
        buildingWorkflowMode,
        buildingRecordMode: buildingWorkflowMode,
        selectedAttachBuildingId,
        selectedBuildingRecordId: selectedAttachBuildingId,
        attachBuildingSearch,
        buildingRecordSearch: attachBuildingSearch,
      },
    }) : null;
  }, [
    attachBuildingSearch,
    buildingDetailsModalOpen,
    buildingForm,
    buildingWorkflowMode,
    editingBuildingId,
    points,
    polygonClosed,
    polygonInteraction,
    selectedAttachBuildingId,
  ]);

  /** Discards the polygon tool's draft geometry and form. */
  const clearToolDraft = () => {
    setPoints([]);
    setPolygonClosed(false);
    setBuildingWorkflowMode("create");
    setBuildingDetailsModalOpen(false);
    setAttachBuildingSearch("");
    setSelectedAttachBuildingId(null);
    resetBuildingForm();
    setEditingBuildingId(null);
  };

  /** Starts the polygon tool in drawing mode. */
  const activate = () => {
    setPolygonInteraction("draw");
    setPolygonClosed(false);
  };

  /** Restores a suspended or recovered polygon-tool draft. */
  const restoreDraft = (restoredPoints: MapPoint[], records: Record<string, unknown>) => {
    setPoints(restoredPoints);
    if (records.buildingForm && typeof records.buildingForm === "object") {
      const form = records.buildingForm as Record<string, unknown>;
      setBuildingForm({
        name: typeof form.name === "string" ? form.name : "",
        code: typeof form.code === "string" ? form.code : "",
        function: typeof form.function === "string" ? form.function : "",
        keywords: typeof form.keywords === "string" ? form.keywords : "",
        status: "Active",
      });
    } else {
      setBuildingForm({
        name: typeof records.buildingName === "string" ? records.buildingName : "",
        code: typeof records.buildingCode === "string" ? records.buildingCode : "",
        function: typeof records.buildingFunction === "string" ? records.buildingFunction : "",
        keywords: typeof records.buildingKeywords === "string" ? records.buildingKeywords : "",
        status: "Active",
      });
    }
    setBuildingClassification(records.buildingClassification === "Facility" ? "Facility" : "Building");
    setEditingBuildingId(typeof records.editingBuildingId === "string" ? records.editingBuildingId : null);
    setPolygonClosed(records.polygonClosed === true);
    setBuildingDetailsModalOpen(records.buildingDetailsModalOpen === true);
    if (records.polygonInteraction === "draw" || records.polygonInteraction === "reshape" || records.polygonInteraction === "move") {
      setPolygonInteraction(records.polygonInteraction);
    } else {
      setPolygonInteraction("draw");
    }
    const restoredWorkflowMode = records.buildingWorkflowMode ?? records.buildingRecordMode;
    if (restoredWorkflowMode === "create" || restoredWorkflowMode === "attach") {
      setBuildingWorkflowMode(restoredWorkflowMode);
    }
    const restoredSelectedId = typeof records.selectedAttachBuildingId === "string"
      ? records.selectedAttachBuildingId
      : typeof records.selectedBuildingRecordId === "string"
        ? records.selectedBuildingRecordId
        : null;
    setSelectedAttachBuildingId(restoredSelectedId);
    const restoredSearch = typeof records.attachBuildingSearch === "string"
      ? records.attachBuildingSearch
      : typeof records.buildingRecordSearch === "string"
        ? records.buildingRecordSearch
        : "";
    setAttachBuildingSearch(restoredSearch);
  };

  return {
    points,
    setPoints,
    polygonInteraction,
    setPolygonInteraction,
    polygonClosed,
    setPolygonClosed,
    polygonInvalid,
    buildingWorkflowMode,
    setBuildingWorkflowMode,
    buildingDetailsModalOpen,
    setBuildingDetailsModalOpen,
    buildingClassification,
    setBuildingClassification,
    attachBuildingSearch,
    setAttachBuildingSearch,
    selectedAttachBuildingId,
    setSelectedAttachBuildingId,
    nonRoutableBuildingId,
    setNonRoutableBuildingId,
    buildingForm,
    setBuildingForm,
    buildingName,
    buildingCode,
    buildingFunction,
    buildingKeywords,
    resetBuildingForm,
    editingBuildingId,
    setEditingBuildingId,
    buildingAttachmentEligibility,
    selectedAttachBuilding,
    selectedAttachEligibility,
    attachCandidateBuildings,
    currentBuildings,
    footprintGeometryIssues,
    footprintOverlapWarning,
    buildingIdentityIssues,
    canFinishFootprint,
    canSaveBuilding,
    closePolygon,
    updatePolygonVertex,
    insertPolygonVertex,
    deletePolygonVertex,
    movePolygon,
    clearDraft,
    cancelDraft,
    closeDetailsModal,
    saveBuilding,
    createBuilding,
    attachBuilding,
    initializeFootprintEdit,
    draftSnapshot,
    clearToolDraft,
    activate,
    restoreDraft,
  };
}
