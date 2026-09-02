import type {
  AuditEntry,
  DashboardSummary,
  Location,
  LocationDraft,
  LocationPosition,
  MapSavePayload,
  NotificationItem,
  Page,
  Pathway,
  RouteNode,
  Session,
  UserAccount,
} from "../types";
import { z } from "zod";
export { createLocationsBulkImportTemplate } from "./locationImport";
import type { LocationImportRequest } from "./locationImport";

import {
  auditEntries,
  buildings,
  locations,
  notifications,
  pathways,
  routeNodes,
  users,
  topSearchedLocations,
} from "./mockData";

import {
  locationImportSchema,
  locationSchema,
  pathwaySchema,
  routeImportSchema,
  userAccountSchema,
} from "./schemas";
import { generatedMapFixture } from "./generatedMapFixture";
import { createLocalAdapter } from "./localAdapter";
import { LocationPolicyError, locationPolicy } from "../lib/locationPolicy";
import type { Building as NetworkBuilding, BuildingWriteRequest, MapDraftSaveRequest, NetworkSnapshot, Pathway as NetworkPathway, PathwayWriteRequest, RouteNode as NetworkRouteNode, RouteNodeWriteRequest } from "./network";
import { createCanonicalNetworkStore, normalizeBuilding, normalizePathway, normalizeRouteNode, validatePathway } from "./network";


// ==========================================
// Backend API
// ==========================================

export type ApiMode = "local" | "mock" | "real";

export type LocationListFilters = {
  type?: Location["type"];
  status?: Location["status"];
  buildingId?: string;
  floor?: string;
};

type BackendLocation = {
  id?: unknown; location_id?: unknown; name?: unknown; location_name?: unknown;
  code?: unknown; location_code?: unknown; type?: unknown; type_id?: unknown;
  parentId?: unknown; building_id?: unknown; building?: unknown; floor_id?: unknown; floor?: unknown;
  function?: unknown; description?: unknown; keywords?: unknown; status?: unknown;
  lat?: unknown; lng?: unknown; positioned?: unknown; hasPhoto?: unknown;
};

const locationTypes = ["Building", "Floor", "Room", "Office", "Laboratory", "Restroom", "Facility"] as const;
const locationStatuses = ["Active", "Inactive", "Open", "Closed", "Unknown"] as const;

export const normalizeBackendLocation = (raw: BackendLocation): Location => {
  const id = raw.id ?? raw.location_id;
  const name = raw.name ?? raw.location_name;
  const code = raw.code ?? raw.location_code;
  const type = raw.type ?? (typeof raw.type_id === "number" ? locationTypes[raw.type_id - 1] : undefined);
  if (id === undefined || typeof name !== "string" || typeof code !== "string" || !locationTypes.includes(type as typeof locationTypes[number])) {
    throw new Error("Backend returned a malformed location record.");
  }
  const status = raw.status ?? "Active";
  if (!locationStatuses.includes(status as typeof locationStatuses[number])) throw new Error("Backend returned an invalid location status.");
  const lat = raw.lat === null || raw.lat === undefined ? null : Number(raw.lat);
  const lng = raw.lng === null || raw.lng === undefined ? null : Number(raw.lng);
  if ((lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) ||
      (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) ||
      ((lat === null) !== (lng === null))) {
    throw new Error("Backend returned malformed location coordinates.");
  }
  const hasPosition = lat !== null && lng !== null;
  if (raw.positioned !== undefined && (typeof raw.positioned !== "boolean" || raw.positioned !== hasPosition)) {
    throw new Error("Backend returned inconsistent location position.");
  }
  const normalized: Location = {
    id: String(id), name, code, type: type as Location["type"],
    parentId: raw.parentId === null || raw.parentId === undefined ? (raw.building_id == null ? null : String(raw.building_id)) : String(raw.parentId),
    status: status as Location["status"], lat, lng,
    positioned: hasPosition,
  };
  if (raw.building != null) normalized.building = String(raw.building);
  if (raw.floor != null) normalized.floor = String(raw.floor);
  if (raw.function != null || raw.description != null) normalized.function = String(raw.function ?? raw.description);
  if (raw.keywords != null) normalized.keywords = String(raw.keywords);
  if (Object.prototype.hasOwnProperty.call(raw, "hasPhoto")) normalized.hasPhoto = raw.hasPhoto === true;
  return normalized;
};

export const normalizeBackendLocationPage = (raw: unknown): Page<Location> => {
  const envelope = raw && typeof raw === "object" && "data" in raw ? (raw as { data: unknown }).data : raw;
  const value = envelope && typeof envelope === "object" ? envelope as Record<string, unknown> : {};
  const rows = value.items ?? value.locations;
  if (!Array.isArray(rows) || typeof value.total !== "number" || typeof value.page !== "number" || typeof value.pageSize !== "number") {
    throw new Error("Backend returned a malformed locations page.");
  }
  return { items: rows.map((row) => normalizeBackendLocation(row as BackendLocation)), total: value.total, page: value.page, pageSize: value.pageSize };
};

const locationWritePayload = (location: LocationDraft) => {
  const { id: _id, lat: _lat, lng: _lng, positioned: _positioned, hasPhoto: _hasPhoto, photo: _photo, photoRemoved: _photoRemoved, ...payload } = location;
  return payload;
};

export const normalizeBackendLocationMutation = (raw: unknown): Location => {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const record = value.location ?? value.data ?? raw;
  return normalizeBackendLocation(record as BackendLocation);
};

// The application always uses the real backend. Only Vitest's dedicated test
// flag may opt into the adapter selected by the test harness; runtime
// environment variables cannot switch the application to fixture data.
export const API_MODE: ApiMode = import.meta.env.VITE_TEST_LOCAL_ADAPTER === "true"
  ? ((import.meta.env.VITE_API_MODE as ApiMode | undefined) ?? "local")
  : "real";
export const USE_GENERATED_MAP_FIXTURE = import.meta.env.VITE_MAP_FIXTURE === "osm";
const API_URL =
  import.meta.env.VITE_API_BASE_URL ??
  "http://localhost:5000";
const USE_HTTP_API = API_MODE === "mock" || API_MODE === "real";
const localAdapter = createLocalAdapter(
  USE_GENERATED_MAP_FIXTURE
    ? { buildings: generatedMapFixture.buildings, locations: generatedMapFixture.locations,
        nodes: generatedMapFixture.nodes, pathways: generatedMapFixture.pathways }
    : { buildings, locations, nodes: routeNodes, pathways },
  !USE_HTTP_API && typeof sessionStorage !== "undefined" ? sessionStorage : null,
);
const canonicalNetwork = createCanonicalNetworkStore(
  USE_GENERATED_MAP_FIXTURE
    ? { buildings: generatedMapFixture.buildings, nodes: generatedMapFixture.nodes, pathways: generatedMapFixture.pathways, locationBuildings: generatedMapFixture.locations.filter((location: { type: string; }) => location.type === "Building") }
    : { buildings, nodes: routeNodes, pathways, locationBuildings: locations.filter((location) => location.type === "Building").map((location) => ({ id: location.id, name: location.name })) },
  !USE_HTTP_API && typeof sessionStorage !== "undefined" ? sessionStorage : null,
);

const apiJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const isMultipart = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: { ...(isMultipart ? {} : { "Content-Type": "application/json" }), ...(init?.headers ?? {}) },
    ...init,
  });
  const data = (await response.json().catch(() => null)) as T & { message?: string; fields?: Record<string, string>; relationships?: Record<string, string> } | null;
  if (!response.ok) {
    const error = new Error(data?.message ?? `Request failed (${response.status})`) as Error & { fieldErrors?: Record<string, string> };
    error.fieldErrors = { ...data?.fields, ...data?.relationships };
    throw error;
  }
  return data as T;
};


// ==========================================
// Mock Helper
// ==========================================

const wait = <T>(value: T, delay = 120) =>
  new Promise<T>((resolve) =>
    setTimeout(() => resolve(value), delay)
  );


// ==========================================
// Utility Functions
// ==========================================

const clone = <T>(value: T): T =>
  structuredClone(value);

const matches = (value: string, query: string) =>
  value
    .toLowerCase()
    .includes(query.trim().toLowerCase());


// ==========================================
// Mock Failure Configuration
// ==========================================

export type FailureKey =
  | "locationSave"
  | "locationRemove"
  | "buildingRemove"
  | "routeSave"
  | "userUpdate"
  | "mapSave";

export const mockFailures: Record<FailureKey, boolean> = {
  locationSave: false,
  locationRemove: false,
  buildingRemove: false,
  routeSave: false,
  userUpdate: false,
  mapSave: false,
};

export const setMockFailure = (
  key: FailureKey,
  enabled: boolean
) => {
  mockFailures[key] = enabled;
};

const failIfConfigured = (key: FailureKey) => {
  if (mockFailures[key]) {
    throw new Error(`Mock ${key} failed.`);
  }
};


// ==========================================
// Services Interface
// ==========================================

export interface Services {
  network: {
    snapshot(): Promise<NetworkSnapshot>;
    buildings(): Promise<NetworkBuilding[]>;
    routeNodes(): Promise<NetworkRouteNode[]>;
    pathways(): Promise<NetworkPathway[]>;
    saveBuilding(building: BuildingWriteRequest): Promise<NetworkBuilding>;
    saveRouteNode(node: RouteNodeWriteRequest): Promise<NetworkRouteNode>;
    associateEntrance(nodeId: string, buildingId: string): Promise<NetworkRouteNode>;
    clearEntranceAssociation(nodeId: string): Promise<NetworkRouteNode>;
    savePathway(pathway: PathwayWriteRequest): Promise<NetworkPathway>;
    closePathway(id: string): Promise<NetworkPathway>;
    reopenPathway(id: string): Promise<NetworkPathway>;
    removePathway(id: string, confirmed?: boolean): Promise<void>;
    saveMapDraft(draft: MapDraftSaveRequest): Promise<NetworkSnapshot>;
  };

  auth: {
    login(
      username: string,
      password: string
    ): Promise<Session>;

    logout(): Promise<unknown>;

    me(): Promise<Session | null>;

    requestReset(username: string): Promise<void>;

    reset(
      username: string,
      code: string,
      password: string
    ): Promise<void>;
  };

  dashboard: {
    summary(): Promise<DashboardSummary>;
  };

  locations: {
    list(query?: string, page?: number, pageSize?: number, filters?: LocationListFilters): Promise<Page<Location>>;

    save(location: LocationDraft): Promise<Location>;

    savePosition(position: LocationPosition): Promise<Location>;

    getPhoto(id: string): Promise<Blob>;

    remove(id: string): Promise<void>;
  };

  routes: {
    list(query?: string): Promise<Page<Pathway>>;

    save(path: Pathway): Promise<Pathway>;

    close(id: string): Promise<Pathway>;
    reopen(id: string): Promise<Pathway>;
    remove(id: string, confirmed?: boolean): Promise<void>;
  };

  users: {
    list(query?: string): Promise<Page<UserAccount>>;

    create(user: UserAccount): Promise<UserAccount>;

    update(user: UserAccount): Promise<UserAccount>;

    reset(id: string): Promise<void>;

    remove(id: string): Promise<void>;
  };

  logs: {
    list(
      category?: string,
      query?: string,
      actor?: string,
      date?: string
    ): Promise<Page<AuditEntry>>;

    forLocation(id: string, name?: string): Promise<Page<AuditEntry>>;
  };

  notifications: {
    list(): Promise<NotificationItem[]>;

    markRead(id: string): Promise<void>;

    markAllRead(): Promise<void>;
  };

  map: {
    buildings(): Promise<typeof buildings>;

    removeBuilding(id: string): Promise<void>;

    locations(): Promise<Location[]>;

    nodes(): Promise<RouteNode[]>;

    pathways(): Promise<Pathway[]>;

    save(
      edit?: MapSavePayload
    ): Promise<void>;
  };

  imports: {
    locations(
      request: LocationImportRequest
    ): Promise<{
      imported: number;
      errors: string[];
    }>;

    routes(
      json: string,
      commit?: boolean,
      mode?: "add" | "update"
    ): Promise<{
      imported: number;
      errors: string[];
    }>;
  };
}


// ==========================================
// Audit Helper
// ==========================================

const addAudit = (
  action: string,
  target: string,
  category: AuditEntry["category"] = "Admin",
  targetId?: string,
) => {
  auditEntries.unshift({
    id: `a-${Date.now()}`,
    actor: "admin01",
    action,
    target,
    targetId,
    createdAt: "Just now",
    category,
  });
};

const locationAuditActions = new Set([
  "Updated Location", "Positioned Location", "Deleted Location",
  "Bulk Imported Location", "Bulk Updated Location",
]);

const enrichLegacyLocationAuditIds = () => {
  auditEntries.forEach((entry) => {
    if (entry.targetId || !locationAuditActions.has(entry.action)) return;
    const namedLocations = locations.filter((location) => location.name === entry.target);
    if (namedLocations.length === 1) entry.targetId = namedLocations[0].id;
  });
};

// Link unambiguous seeded history before any location can be renamed.
enrichLegacyLocationAuditIds();

// ==========================================
// Services
// ==========================================

function checkRateLimit(response: Response): void {
  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    const seconds = retryAfter ? parseInt(retryAfter, 10) : 60;
    throw new Error(
      `Too many requests. Please wait ${seconds} second${seconds === 1 ? "" : "s"}.`
    );
  }
}

export const services: Services = {

  // ========================================
  // CANONICAL WALKING NETWORK
  // ========================================

  network: {
    snapshot: async () => USE_HTTP_API
      ? apiJson<NetworkSnapshot>("/api/network")
      : wait(canonicalNetwork.snapshot()),
    buildings: async () => USE_HTTP_API
      ? apiJson<NetworkBuilding[]>("/api/network/buildings")
      : wait(canonicalNetwork.buildings()),
    routeNodes: async () => USE_HTTP_API
      ? apiJson<NetworkRouteNode[]>("/api/network/route-nodes")
      : wait(canonicalNetwork.routeNodes()),
    pathways: async () => USE_HTTP_API
      ? apiJson<NetworkPathway[]>("/api/network/pathways")
      : wait(canonicalNetwork.pathways()),
    saveBuilding: async (building) => {
      const next = { ...building, id: building.id ?? `building-${Date.now()}` };
      if (USE_HTTP_API) return apiJson<NetworkBuilding>(`/api/network/buildings${building.id ? `/${encodeURIComponent(building.id)}` : ""}`, { method: building.id ? "PUT" : "POST", body: JSON.stringify(next) });
      const current = canonicalNetwork.snapshot();
      const index = current.buildings.findIndex((item) => item.id === next.id);
      if (index >= 0) current.buildings[index] = next;
      else current.buildings.push(next);
      return wait(canonicalNetwork.save(current).buildings.find((item) => item.id === next.id)!);
    },
    saveRouteNode: async (node) => {
      const next = { ...node, id: node.id ?? `node-${Date.now()}` } as NetworkRouteNode;
      if (USE_HTTP_API) return apiJson<NetworkRouteNode>(`/api/network/route-nodes${node.id ? `/${encodeURIComponent(node.id)}` : ""}`, { method: node.id ? "PUT" : "POST", body: JSON.stringify(next) });
      const current = canonicalNetwork.snapshot();
      const index = current.routeNodes.findIndex((item) => item.id === next.id);
      if (index >= 0) current.routeNodes[index] = next;
      else current.routeNodes.push(next);
      return wait(canonicalNetwork.save(current).routeNodes.find((item) => item.id === next.id)!);
    },
    associateEntrance: async (nodeId, buildingId) => {
      if (USE_HTTP_API) return apiJson<NetworkRouteNode>(`/api/network/route-nodes/${encodeURIComponent(nodeId)}/entrance`, { method: "POST", body: JSON.stringify({ buildingId }) });
      return wait(canonicalNetwork.associateEntrance(nodeId, buildingId));
    },
    clearEntranceAssociation: async (nodeId) => {
      if (USE_HTTP_API) return apiJson<NetworkRouteNode>(`/api/network/route-nodes/${encodeURIComponent(nodeId)}/entrance`, { method: "DELETE" });
      return wait(canonicalNetwork.clearEntranceAssociation(nodeId));
    },
    savePathway: async (pathway) => {
      const next = { ...pathway, id: pathway.id ?? `pathway-${Date.now()}` } as NetworkPathway;
      if (USE_HTTP_API) return apiJson<NetworkPathway>(`/api/network/pathways${pathway.id ? `/${encodeURIComponent(pathway.id)}` : ""}`, { method: pathway.id ? "PUT" : "POST", body: JSON.stringify(next) });
      return wait(canonicalNetwork.savePathway(next));
    },
    closePathway: async (id) => {
      if (USE_HTTP_API) return apiJson<NetworkPathway>(`/api/network/pathways/${encodeURIComponent(id)}/close`, { method: "POST" });
      return wait(canonicalNetwork.closePathway(id));
    },
    reopenPathway: async (id) => {
      if (USE_HTTP_API) return apiJson<NetworkPathway>(`/api/network/pathways/${encodeURIComponent(id)}/reopen`, { method: "POST" });
      return wait(canonicalNetwork.reopenPathway(id));
    },
    removePathway: async (id, confirmed = false) => {
      if (USE_HTTP_API) {
        await apiJson<unknown>(`/api/network/pathways/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ confirmed }) });
        return;
      }
      canonicalNetwork.removePathway(id, confirmed);
      await wait(undefined);
    },
    saveMapDraft: async (draft) => {
      if (USE_HTTP_API) return apiJson<NetworkSnapshot>("/api/network/map-draft", { method: "POST", body: JSON.stringify(draft) });
      const current = canonicalNetwork.snapshot();
      const next = { ...current, ...draft };
      return wait(canonicalNetwork.save(next));
    },
  },

  // ========================================
  // AUTHENTICATION
  // ========================================

  auth: {

    // --------------------------------------
    // Login
    // --------------------------------------

    login: async (
      username,
      password
    ) => {

      if (!USE_HTTP_API) {
        return localAdapter.auth.login(username, password);
      }

      const response = await fetch(
        `${API_URL}/api/login`,
        {
          method: "POST",

          credentials: "include",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            username,
            password,
          }),
        }
      );

      let data: any;

      try {
        data = await response.json();
      } catch {
        throw new Error(
          "Unable to connect to the backend."
        );
      }

      checkRateLimit(response);

      if (!response.ok) {
        throw new Error(
          data.message ||
          "Invalid username or password"
        );
      }

      if (
        data.success === false ||
        !data.admin
      ) {
        throw new Error(
          data.message ||
          "Login failed"
        );
      }

      return {
        id: data.admin.id,
        username: data.admin.username,
      };
    },


    // --------------------------------------
    // Logout
    // --------------------------------------

    logout: async () => {

      if (!USE_HTTP_API) {
        return localAdapter.auth.logout();
      }

      const response = await fetch(
        `${API_URL}/api/logout`,
        {
          method: "POST",

          credentials: "include",

          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      let data: any;

      try {
        data = await response.json();
      } catch {
        throw new Error(
          "Unable to connect to the backend."
        );
      }

      if (!response.ok) {
        throw new Error(
          data.message ||
          "Logout failed"
        );
      }

      return data;
    },


    // --------------------------------------
    // Current Admin
    // --------------------------------------

    me: async () => {

      if (!USE_HTTP_API) return localAdapter.auth.me();

      const response = await fetch(
        `${API_URL}/api/me`,
        {
          method: "GET",

          credentials: "include",

          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      if (
        !data.authenticated ||
        !data.admin
      ) {
        return null;
      }

      return {
        id: data.admin.id,
        username: data.admin.username,
      };
    },

    requestReset: async (username) => {
      const response = await fetch(`${API_URL}/api/reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      let data: { message?: string };
      try {
        data = await response.json();
      } catch {
        throw new Error("Unable to connect to the backend.");
      }
      checkRateLimit(response);
      if (!response.ok) {
        throw new Error(data.message || "Failed to send verification code");
      }
    },


    // --------------------------------------
    // Password Reset
    // --------------------------------------

    reset: async (
      username,
      code,
      password
    ) => {
      const response = await fetch(`${API_URL}/api/reset-password`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, code, password }),
      });
      let data: { message?: string };
      try {
        data = await response.json();
      } catch {
        throw new Error("Unable to connect to the backend.");
      }
      checkRateLimit(response);
      if (!response.ok) {
        throw new Error(data.message || "Password reset failed");
      }
    },
  },


  // ========================================
  // DASHBOARD
  // ========================================

  dashboard: {

    summary: async () =>
      wait({
        buildings: 142,

        offices: 1854,

        locations:
          locations.length,

        pathways:
          pathways.filter(
            (path) =>
              path.status === "Open"
          ).length,

        searches: 438,

        topSearched:
          clone(topSearchedLocations),

        recent:
          clone(
            auditEntries.slice(0, 3)
          ),
      }),
  },


  // ========================================
  // LOCATIONS
  // ========================================

  locations: {

    list: async (q, page = 1, pageSize, filters = {}) => {

      if (USE_HTTP_API) {
        const resolvedPageSize = pageSize ?? 20;
        const params = new URLSearchParams({ page: String(page), pageSize: String(resolvedPageSize) });
        if (q) params.set("q", q);
        if (filters.type) params.set("type", filters.type);
        if (filters.status) params.set("status", filters.status);
        if (filters.buildingId) params.set("buildingId", filters.buildingId);
        if (filters.floor) params.set("floor", filters.floor);
        const response = await apiJson<unknown>(`/api/locations?${params}`);
        return normalizeBackendLocationPage(response);
      }

      const filtered = locations.filter((location) =>
          (!q ||
            [
              location.name,
              location.code,
              location.type,
              location.function ?? "",
              location.keywords ?? "",
              location.building ?? "",
              location.floor ?? "",
            ].some((value) =>
              matches(value, q)
            )) &&
          (!filters.type || location.type === filters.type) &&
          (!filters.status || location.status === filters.status) &&
          (!filters.buildingId || location.parentId === filters.buildingId) &&
          (!filters.floor || location.floor === filters.floor)
        );
      const resolvedPageSize = pageSize ?? Math.max(filtered.length, 1);

      return wait({
        items: clone(filtered.slice((page - 1) * resolvedPageSize, page * resolvedPageSize)),

        total:
          filtered.length,

        page,

        pageSize: resolvedPageSize,
      });
    },


    save: async (location) => {

      if (USE_HTTP_API) {
        if (location.id) throw new Error("Updating locations is not available yet.");
        const uploadsNewPhoto = location.photo?.dataUrl.startsWith("data:") === true;
        const body = uploadsNewPhoto
          ? (() => {
              const form = new FormData();
              Object.entries(locationWritePayload(location)).forEach(([key, value]) => {
                if (value === undefined || value === null) return;
                form.append(key, String(value));
              });
              if (location.photo) {
                const comma = location.photo.dataUrl.indexOf(",");
                const encoded = location.photo.dataUrl.slice(comma + 1);
                const binary = atob(encoded);
                const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
                form.append("photo", new Blob([bytes], { type: location.photo.type }), location.photo.name);
              }
              return form;
            })()
          : JSON.stringify(locationWritePayload(location));
        const response = await apiJson<unknown>("/api/locations", {
          method: "POST",
          body,
        });
        const saved = normalizeBackendLocationMutation(response);
        return saved;
      }

      failIfConfigured(
        "locationSave"
      );

      const nextLocation: Location = { ...location, id: location.id || `loc-${Date.now()}` };
      locationSchema.parse(nextLocation);

      const previous = locations.find((item) => item.id === nextLocation.id) ?? nextLocation;
      const normalized = locationPolicy.normalize(nextLocation, {
        directory: locations,
        previous,
      });
      const evaluation = locationPolicy.evaluate(normalized, {
        context: "record",
        directory: locations,
        requireFloorLevel: !location.id,
      });
      if (!evaluation.valid) throw new LocationPolicyError(evaluation.issues);

      const saved = localAdapter.locations.save(normalized);
      addAudit("Updated Location", saved.name, "Admin", saved.id);
      return wait(clone(saved));
    },

    savePosition: async (position) => {
      if (USE_HTTP_API) {
        throw new Error("Updating location positions is not available yet.");
      }
      const location = localAdapter.locations.savePosition(position.id, position.lat, position.lng);
      addAudit("Positioned Location", location.name, "Admin", location.id);
      return wait(clone(location));
    },

    getPhoto: async (id) => {
      if (USE_HTTP_API) {
        throw new Error("Location photo retrieval is not available yet.");
      }
      const location = locations.find((item) => item.id === id);
      if (!location?.photo?.dataUrl) throw new Error("Location photo not found.");
      return fetch(location.photo.dataUrl).then((response) => response.blob());
    },


    remove: async (id) => {

      if (USE_HTTP_API) {
        throw new Error("Deleting locations is not available yet.");
      }

      failIfConfigured("locationRemove");

      const target = locations.find((location) => location.id === id);
      if (target?.type === "Building") failIfConfigured("buildingRemove");
      const children = target?.type === "Building"
        ? locations.filter((location) => location.parentId === id)
        : [];
      const affected = target ? [target, ...children.filter((child) => child.id !== target.id)] : [];
      affected.forEach((location) => {
        localAdapter.locations.remove(location.id);
        addAudit("Deleted Location", location.name, "Admin", location.id);
      });
      return wait(undefined);

    },
  },


  // ========================================
  // ROUTES
  // ========================================

  routes: {

    list: async (q) => {

      if (USE_HTTP_API) {
        return apiJson<Page<Pathway>>(`/api/routes${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      }

      const filtered = q
        ? pathways.filter((path) =>
            matches(
              path.name,
              q
            )
          )
        : pathways;

      return wait({
        items:
          clone(filtered),

        total:
          filtered.length,

        page: 1,

        pageSize: 20,
      });
    },


    save: async (path) => {

      if (USE_HTTP_API) {
        return apiJson<Pathway>(`/api/routes${path.id ? `/${encodeURIComponent(path.id)}` : ""}`, {
          method: path.id ? "PUT" : "POST",
          body: JSON.stringify(path),
        });
      }

      failIfConfigured(
        "routeSave"
      );

      pathwaySchema.parse(
        path
      );
      canonicalNetwork.savePathway(normalizePathway(path));

      const index =
        pathways.findIndex(
          (item) =>
            item.id === path.id
        );

      if (index >= 0) {

        pathways[index] =
          clone(path);

      } else {

        pathways.push(
          clone(path)
        );
      }

      addAudit(
        "Updated Route",
        path.name
      );

      return wait(
        clone(path)
      );
    },


    close: async (id) => {
      if (USE_HTTP_API) return apiJson<Pathway>(`/api/routes/${encodeURIComponent(id)}/close`, { method: "POST" });
      canonicalNetwork.closePathway(id);
      const pathway = pathways.find((candidate) => candidate.id === id);
      if (!pathway) throw new Error("Pathway not found.");
      pathway.status = "Closed";
      return wait(clone(pathway));
    },

    reopen: async (id) => {
      if (USE_HTTP_API) return apiJson<Pathway>(`/api/routes/${encodeURIComponent(id)}/reopen`, { method: "POST" });
      canonicalNetwork.reopenPathway(id);
      const pathway = pathways.find((candidate) => candidate.id === id);
      if (!pathway) throw new Error("Pathway not found.");
      pathway.status = "Open";
      return wait(clone(pathway));
    },

    remove: async (id, confirmed = false) => {

      if (USE_HTTP_API) {
        await apiJson<unknown>(`/api/routes/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ confirmed }) });
        return;
      }

      canonicalNetwork.removePathway(id, confirmed);

      const index =
        pathways.findIndex(
          (path) =>
            path.id === id
        );

      if (index >= 0) {

        const removed =
          pathways.splice(
            index,
            1
          )[0];

        addAudit(
          "Removed Route",
          removed.name
        );
      }

      return wait(undefined);
    },
  },


  // ========================================
  // USERS
  // ========================================

  users: {

    list: async (q) => {

      const filtered = q
        ? users.filter((user) =>
            matches(
              user.username,
              q
            )
          )
        : users;

      return wait({
        items:
          clone(filtered),

        total:
          filtered.length,

        page: 1,

        pageSize: 20,
      });
    },


    create: async (user) => {

      failIfConfigured(
        "userUpdate"
      );

      userAccountSchema.parse(
        user
      );

      users.push(
        clone(user)
      );

      addAudit(
        "Created User",
        user.username
      );

      return wait(
        clone(user)
      );
    },


    update: async (user) => {

      failIfConfigured(
        "userUpdate"
      );

      userAccountSchema.parse(
        user
      );

      const index =
        users.findIndex(
          (item) =>
            item.id === user.id
        );

      if (index >= 0) {

        users[index] =
          clone(user);
      }

      addAudit(
        "Updated User",
        user.username
      );

      return wait(
        clone(user)
      );
    },


    reset: async (id) => {

      failIfConfigured(
        "userUpdate"
      );

      const user =
        users.find(
          (item) =>
            item.id === id
        );

      if (user) {

        addAudit(
          "Reset User Password",
          user.username
        );
      }

      return wait(undefined);
    },


    remove: async (id) => {

      const index =
        users.findIndex(
          (user) =>
            user.id === id
        );

      if (index >= 0) {

        const removed =
          users.splice(
            index,
            1
          )[0];

        addAudit(
          "Removed User",
          removed.username
        );
      }

      return wait(undefined);
    },
  },


  // ========================================
  // LOGS
  // ========================================

  logs: {

    list: async (
      category,
      q,
      actor,
      date
    ) => {

      const filtered =
        auditEntries.filter(
          (entry) => {

            const categoryMatch =
              !category ||
              category === "All" ||
              entry.category ===
                category;

            const queryMatch =
              !q ||
              [
                entry.action,
                entry.actor,
                entry.target,
              ].some((value) =>
                matches(value, q)
              );

            const actorMatch =
              !actor ||
              actor === "All Actors" ||
              entry.actor === actor;

            const dateMatch =
              !date ||
              date === "All Dates" ||
              entry.createdAt.includes(
                date
              );

            return (
              categoryMatch &&
              queryMatch &&
              actorMatch &&
              dateMatch
            );
          }
        );

      return wait({
        items:
          clone(filtered),

        total:
          filtered.length,

        page: 1,

        pageSize: 20,
      });
    },

    forLocation: async (id) => {
      enrichLegacyLocationAuditIds();
      const entries = auditEntries.filter((entry) => entry.targetId === id);
      return wait({ items: clone(entries), total: entries.length, page: 1, pageSize: 20 });
    },
  },


  // ========================================
  // NOTIFICATIONS
  // ========================================

  notifications: {

    list: async () =>
      wait(
        clone(notifications)
      ),


    markRead: async (id) => {

      const item =
        notifications.find(
          (notification) =>
            notification.id === id
        );

      if (item) {
        item.read = true;
      }

      return wait(undefined);
    },


    markAllRead: async () => {

      notifications.forEach(
        (notification) => {
          notification.read = true;
        }
      );

      return wait(undefined);
    },
  },


  // ========================================
  // MAP
  // ========================================

  map: {

    buildings: async () => USE_HTTP_API
      ? apiJson<typeof buildings>("/api/map/buildings")
    : wait(clone(localAdapter.map.buildings())),

    removeBuilding: async (id) => {
      if (USE_HTTP_API) {
        await apiJson<unknown>(`/api/map/buildings/${encodeURIComponent(id)}`, { method: "DELETE" });
        return;
      }

      failIfConfigured("buildingRemove");
      const removed = localAdapter.map.removeBuilding(id);
      if (removed) addAudit("Removed Building", removed.name, "Admin", removed.id);
      return wait(undefined);
    },


    locations: async () => USE_HTTP_API
      ? apiJson<Location[]>("/api/map/locations")
      : wait(clone(localAdapter.map.locations())),


    nodes: async () => USE_HTTP_API
      ? apiJson<RouteNode[]>("/api/map/nodes")
      : wait(clone(localAdapter.map.nodes())),


    pathways: async () => USE_HTTP_API
      ? apiJson<Pathway[]>("/api/map/pathways")
      : wait(clone(localAdapter.map.pathways())),


    save: async (edit) => {

      if (USE_HTTP_API) {
        // Location coordinates are authoritative in Locations. Keep the
        // broader map draft endpoint for geometry/network data, but route
        // point writes through the narrow operation first.
        if (edit?.selected?.type === "location" && edit.place) {
          await services.locations.savePosition({ id: edit.selected.id, lat: edit.place[0], lng: edit.place[1] });
        }
        if (edit?.movedLocation) {
          await services.locations.savePosition(edit.movedLocation);
        }
        await apiJson<unknown>("/api/map/save", {
          method: "POST",
          body: JSON.stringify(edit ? { ...edit, selected: edit.selected?.type === "location" ? undefined : edit.selected, place: edit.selected?.type === "location" ? undefined : edit.place, movedLocation: undefined } : {}),
        });
        return;
      }

      failIfConfigured(
        "mapSave"
      );


      // ------------------------------------
      // Selected Location / Node
      // ------------------------------------

      if (
        edit?.selected &&
        edit.place
      ) {

        const location =
          locations.find(
            (item) =>
              item.id ===
              edit.selected?.id
          );

        const node =
          routeNodes.find(
            (item) =>
              item.id ===
              edit.selected?.id
          );


        if (location) {
          localAdapter.locations.savePosition(location.id, edit.place[0], edit.place[1]);

        } else if (node) {

          node.lat =
            edit.place[0];

          node.lng =
            edit.place[1];
        }
      }


      // ------------------------------------
      // Moved Location
      // ------------------------------------

      if (
        edit?.movedLocation
      ) {

        const location =
          locations.find(
            (item) =>
              item.id ===
              edit.movedLocation?.id
          );

        if (location) {
          localAdapter.locations.savePosition(location.id, edit.movedLocation.lat, edit.movedLocation.lng);
        }
      }


      // ------------------------------------
      // Moved Node
      // ------------------------------------

      if (
        edit?.movedNode
      ) {

        const node =
          routeNodes.find(
            (item) =>
              item.id ===
              edit.movedNode?.id
          );

        if (node) {

          node.lat =
            edit.movedNode.lat;

          node.lng =
            edit.movedNode.lng;
        }
      }


      // ------------------------------------
      // New Node
      // ------------------------------------

      if (
        edit?.newNode
      ) {

        routeNodes.push({

          id:
            `node-${Date.now()}`,

          name:
            edit.newNode.name,

          nodeType:
            edit.newNode.nodeType,

          associatedPlaceId:
            edit.newNode
              .associatedPlaceId ||
            null,

          lat:
            edit.newNode.lat,

          lng:
            edit.newNode.lng,
        });
      }

      if (edit?.locations) {
        edit.locations.forEach((location) => {
          const index = locations.findIndex((item) => item.id === location.id);
          if (index >= 0) locations[index] = clone(location);
          else locations.push(clone(location));
        });
      }
      if (edit?.nodes) {
        edit.nodes.forEach((node) => {
          const index = routeNodes.findIndex((item) => item.id === node.id);
          if (index >= 0) routeNodes[index] = clone(node);
          else routeNodes.push(clone(node));
        });
      }
      if (edit?.buildings) {
        edit.buildings.forEach((building) => {
          const index = buildings.findIndex((item) => item.id === building.id);
          if (index >= 0) buildings[index] = clone(building);
          else buildings.push(clone(building));
        });
      }
      if (edit?.pathways) {
        edit.pathways.forEach((pathway) => {
          const index = pathways.findIndex((item) => item.id === pathway.id);
          if (index >= 0) pathways[index] = clone(pathway);
          else pathways.push(clone(pathway));
        });
      }


      // ------------------------------------
      // Path Points
      // ------------------------------------

      if (
        edit?.selected &&
        edit.pathPoints
      ) {

        const path =
          pathways.find(
            (item) =>
              item.id ===
              edit.selected?.id
          );

        if (path) {

          path.pathPoints =
            clone(
              edit.pathPoints
            );
        }
      }


      // ------------------------------------
      // Updated Path
      // ------------------------------------

      if (
        edit?.updatedPath
      ) {

        const path =
          pathways.find(
            (item) =>
              item.id ===
              edit.updatedPath?.id
          );

        if (path) {

          path.pathPoints =
            clone(
              edit.updatedPath
                .pathPoints
            );
        }
      }


      // ------------------------------------
      // Area Points
      // ------------------------------------

      if (
        edit?.areaPoints &&
        edit.areaPoints.length >= 3
      ) {

        buildings.push({

          id:
            `area-${Date.now()}`,

          name:
            "Drawn Campus Area",

          code:
            "AREA-DRAFT",

          points:
            clone(
              edit.areaPoints
            ),
        });
      }

      // Keep the legacy-shaped Map Editor payload and the canonical network
      // store in sync. Routes and Map Editor share these records, so a draft
      // saved by one module must be visible to the other module immediately.
      const canonical = canonicalNetwork.snapshot();
      const mergeById = <T extends { id: string }>(original: T[], changed: T[]) => {
        const changes = new Map(changed.map((item) => [item.id, item]));
        return original
          .map((item) => changes.get(item.id) ?? item)
          .concat(changed.filter((item) => !original.some((candidate) => candidate.id === item.id)));
      };
      const changedNodes = (edit?.nodes ?? []).map(normalizeRouteNode);
      const toCanonicalPathway = (pathway: Pathway): NetworkPathway => {
        const normalized = normalizePathway(pathway);
        return { ...normalized, type: normalized.type ?? "Campus walkway", direction: normalized.direction ?? "two_way" };
      };
      const changedPathways: NetworkPathway[] = (edit?.pathways ?? []).map(toCanonicalPathway);
      const changedBuildings = (edit?.buildings ?? []).map((building) => normalizeBuilding(building));
      if (edit?.movedNode) {
        const node = routeNodes.find((candidate) => candidate.id === edit.movedNode?.id);
        if (node) changedNodes.push(normalizeRouteNode(node));
      }
      if (edit?.selected?.type === "node" && edit.place) {
        const node = routeNodes.find((candidate) => candidate.id === edit.selected?.id);
        if (node) changedNodes.push(normalizeRouteNode(node));
      }
      if (edit?.updatedPath) {
        const pathway = pathways.find((candidate) => candidate.id === edit.updatedPath?.id);
        if (pathway) changedPathways.push(toCanonicalPathway(pathway));
      }
      if (edit?.selected?.type === "pathway" && edit.pathPoints) {
        const pathway = pathways.find((candidate) => candidate.id === edit.selected?.id);
        if (pathway) changedPathways.push(toCanonicalPathway(pathway));
      }
      if (changedNodes.length || changedPathways.length || changedBuildings.length) {
        canonicalNetwork.save({
          ...canonical,
          routeNodes: mergeById(canonical.routeNodes, changedNodes),
          pathways: mergeById(canonical.pathways, changedPathways).map((pathway) => ({
            ...pathway,
            type: pathway.type ?? "Campus walkway",
            direction: pathway.direction ?? "two_way",
          })),
          buildings: mergeById(canonical.buildings, changedBuildings),
        });
      }


      addAudit(
        "Updated Map",
        "Campus geometry"
      );

      return wait(undefined);
    },
  },


  // ========================================
  // IMPORTS
  // ========================================

  imports: {

    // --------------------------------------
    // Locations Import
    // --------------------------------------

    locations: async ({ json, commit = false, mode = "add" }) => {

      let parsed: unknown;

      try {

        parsed =
          JSON.parse(json);

      } catch {

        return {
          imported: 0,
          errors: [
            "Invalid JSON file.",
          ],
        };
      }


      const rows =
        Array.isArray(parsed)
          ? parsed
          : [parsed];

      const errors: string[] = [];
      const validRows: Array<{ row: z.infer<typeof locationImportSchema>; index: number }> = [];

      rows.forEach((row, index) => {
        const result = locationImportSchema.safeParse(row);
        if (!result.success) {
          result.error.issues.forEach((issue) => {
            const field = issue.path.join(".") || "record";
            errors.push(`Row ${index + 1}, ${field}: ${issue.message}`);
          });
          return;
        }
        validRows.push({ row: result.data, index });
      });

      const batchIds = new Set(validRows.flatMap(({ row }) => row.id ? [row.id] : []));
      const seenIds = new Set<string>();
      const seenCodes = new Set<string>();
      const pending: Array<{ location: Location; existingIndex: number | null; rowIndex: number }> = [];

      validRows.forEach(({ row, index }) => {
        if (row.type === "Floor") {
          errors.push(`Row ${index + 1}, type: Floor records are legacy compatibility data and cannot be imported.`);
        }
        const matchedById = row.id ? locations.findIndex((location) => location.id === row.id) : -1;
        const matchedByCode = locations.findIndex((location) => location.code === row.code);
        const existingIndex = matchedById >= 0 ? matchedById : matchedByCode;
        const id = row.id || `loc-import-${Date.now()}-${index}`;

        if (seenIds.has(id)) errors.push(`Row ${index + 1}, id: duplicates another row in this file.`);
        if (seenCodes.has(row.code)) errors.push(`Row ${index + 1}, code: duplicates another row in this file.`);
        seenIds.add(id);
        seenCodes.add(row.code);

        if (mode === "add" && existingIndex >= 0) {
          errors.push(`Row ${index + 1}, ${matchedById >= 0 ? "id" : "code"}: already exists.`);
        }
        if (mode === "update" && existingIndex < 0) {
          errors.push(`Row ${index + 1}, id/code: no existing location matches this row.`);
        }
        if (row.parentId && !locations.some((location) => location.id === row.parentId) && !batchIds.has(row.parentId)) {
          errors.push(`Row ${index + 1}, parentId: parent location reference not found.`);
        }

        const existing = existingIndex >= 0 ? locations[existingIndex] : undefined;
        pending.push({
          existingIndex: existingIndex >= 0 ? existingIndex : null,
          rowIndex: index,
          location: {
            ...existing,
            ...row,
            id: mode === "update" && existing ? existing.id : id,
            function: existing?.function ?? "",
            keywords: existing?.keywords ?? "",
            building: row.building ?? existing?.building,
            floor: row.floor ?? existing?.floor,
            positioned: row.lat !== null && row.lng !== null,
          },
        });
      });

      // A row can identify an existing parent by code while its children still
      // reference the ID supplied in this file. Resolve that temporary ID to
      // the parent's durable curated ID before committing the batch.
      const effectiveIdsByImportedId = new Map(
        validRows.flatMap(({ row }, pendingIndex) => row.id
          ? [[row.id, pending[pendingIndex].location.id] as const]
          : []),
      );
      pending.forEach(({ location }) => {
        if (location.parentId) {
          location.parentId = effectiveIdsByImportedId.get(location.parentId) ?? location.parentId;
        }
      });

      const batchDirectory = [...locations, ...pending.map(({ location }) => location)];
      pending.forEach((entry) => {
        const existing = entry.existingIndex === null ? undefined : locations[entry.existingIndex];
        const parent = batchDirectory.find((candidate) => candidate.id === entry.location.parentId);
        const candidate = parent?.type === "Building"
          ? { ...entry.location, building: parent.name }
          : entry.location;
        const evaluation = locationPolicy.evaluate(candidate, {
          context: "record",
          directory: batchDirectory,
          requireFloorLevel: true,
        });
        if (!evaluation.valid) {
          evaluation.issues.forEach((issue) => errors.push(`Row ${entry.rowIndex + 1}, ${issue.field}: ${issue.message}`));
          return;
        }
        entry.location = locationPolicy.normalize(candidate, {
          directory: batchDirectory,
          previous: existing ?? candidate,
        }) as Location;
      });


      if (
        commit &&
        errors.length === 0
      ) {

        pending.forEach(({ location, existingIndex }) => {
          if (existingIndex === null) locations.push(clone(location));
          else locations[existingIndex] = clone(location);
        });

        pending.forEach(({ location }) => addAudit(
          mode === "update" ? "Bulk Updated Location" : "Bulk Imported Location",
          location.name,
          "Admin",
          location.id,
        ));
      }


      return wait({

        imported:
          errors.length === 0
            ? pending.length
            : 0,

        errors,
      });
    },


    // --------------------------------------
    // Routes Import
    // --------------------------------------

    routes: async (json, commit = false, mode = "add") => {

      let parsed: unknown;

      try {

        parsed =
          JSON.parse(json);

      } catch {

        return {
          imported: 0,
          errors: [
            "Invalid JSON file.",
          ],
        };
      }


      const rows =
        Array.isArray(parsed)
          ? parsed
          : [parsed];

      const errors: string[] = [];
      const current = canonicalNetwork.snapshot();
      const pending: NetworkPathway[] = [];
      const seenIds = new Set<string>();
      const seenConnections = new Set<string>();
      rows.forEach((row, index) => {
        const detailed = pathwaySchema.safeParse(row);
        const legacy = routeImportSchema.safeParse(row);
        if (!detailed.success && !legacy.success) {
          const result = detailed;
          result.error.issues.forEach((issue) => errors.push(`Row ${index + 1}, ${issue.path.join(".") || "record"}: ${issue.message}`));
          return;
        }
        const value = detailed.success ? detailed.data : {
          ...legacy.data!, distance: "—", time: "—", shade: "Unknown" as const,
          type: "Campus walkway", direction: "Two-way" as const, status: "Open" as const,
        };
        const id = value.id;
        if (seenIds.has(id)) errors.push(`Row ${index + 1}, id: duplicates another row in this file.`);
        seenIds.add(id);
        const existing = current.pathways.find((pathway) => pathway.id === id);
        if (mode === "add" && existing) errors.push(`Row ${index + 1}, id: already exists.`);
        if (mode === "update" && !existing) errors.push(`Row ${index + 1}, id: no existing Pathway matches this row.`);
        const candidate = {
          id,
          name: value.name,
          sourceNodeId: value.sourceNodeId,
          destinationNodeId: value.destinationNodeId,
          pathSequence: { points: value.pathPoints.map(([latitude, longitude]) => ({ latitude, longitude })) },
          distanceMeters: existing?.distanceMeters ?? null,
          estimatedTimeSeconds: existing?.estimatedTimeSeconds ?? null,
          type: value.type,
          shade: value.shade === "Unknown" ? null : value.shade,
          direction: value.direction === "Two-way" ? "two_way" as const : value.direction === "One-way" ? "one_way" as const : null,
          status: value.status === "Open" ? "open" as const : value.status === "Closed" ? "closed" as const : "closed" as const,
        } satisfies NetworkPathway;
        try {
          if (!current.routeNodes.some((node) => node.id === candidate.sourceNodeId) ||
            !current.routeNodes.some((node) => node.id === candidate.destinationNodeId)) {
            throw new Error("node reference not found.");
          }
          const connection = [candidate.sourceNodeId, candidate.destinationNodeId].sort().join("::");
          if (seenConnections.has(connection)) throw new Error("duplicate physical connection in this file.");
          seenConnections.add(connection);
          validatePathway(candidate, current, { existingPathwayId: mode === "update" ? id : undefined });
          pending.push(candidate);
        } catch (cause) {
          errors.push(`Row ${index + 1}: ${cause instanceof Error ? cause.message : "invalid Pathway."}`);
        }
      });
      if (commit && errors.length === 0) {
        const next = current;
        pending.forEach((pathway) => {
          const index = next.pathways.findIndex((candidate) => candidate.id === pathway.id);
          if (index >= 0) next.pathways[index] = pathway;
          else next.pathways.push(pathway);
          const legacyIndex = pathways.findIndex((candidate) => candidate.id === pathway.id);
          const legacy = {
            id: pathway.id,
            name: pathway.name,
            sourceNodeId: pathway.sourceNodeId,
            destinationNodeId: pathway.destinationNodeId,
            pathPoints: pathway.pathSequence.points.map((point) => [point.latitude, point.longitude] as [number, number]),
            distance: "—",
            time: "—",
            shade: (pathway.shade ?? "Unknown") as Pathway["shade"],
            type: pathway.type ?? "Campus walkway",
            direction: pathway.direction === "one_way" ? "One-way" as const : "Two-way" as const,
            status: pathway.status === "open" ? "Open" as const : "Closed" as const,
          };
          if (legacyIndex >= 0) pathways[legacyIndex] = legacy;
          else pathways.push(legacy);
        });
        canonicalNetwork.save(next);
        if (pending.length) addAudit("Imported Pathways", `${pending.length} pathways`);
      }
      return wait({ imported: errors.length === 0 ? pending.length : 0, errors });
    },
  },
};
