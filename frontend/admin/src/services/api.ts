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


// ==========================================
// Backend API
// ==========================================

export type ApiMode = "local" | "mock" | "real";

// `local` is the explicit development/test adapter for deterministic in-browser fixtures.
// HTTP-backed environments use `mock` for the mock API or `real` for production,
// with VITE_API_BASE_URL selecting the backend when needed.
export const API_MODE: ApiMode =
  (import.meta.env.VITE_API_MODE as ApiMode | undefined) ?? "local";
export const USE_GENERATED_MAP_FIXTURE = import.meta.env.VITE_MAP_FIXTURE === "osm";
const API_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (API_MODE === "mock" ? "http://127.0.0.1:5001" : "");
const USE_HTTP_API = API_MODE === "mock" || API_MODE === "real";
const localAdapter = createLocalAdapter(
  USE_GENERATED_MAP_FIXTURE
    ? { buildings: generatedMapFixture.buildings, locations: generatedMapFixture.locations,
        nodes: generatedMapFixture.nodes, pathways: generatedMapFixture.pathways }
    : { buildings, locations, nodes: routeNodes, pathways },
  !USE_HTTP_API && typeof sessionStorage !== "undefined" ? sessionStorage : null,
);

const apiJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const data = (await response.json().catch(() => null)) as T & { message?: string } | null;
  if (!response.ok) throw new Error(data?.message ?? `Request failed (${response.status})`);
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
  | "routeSave"
  | "userUpdate"
  | "mapSave";

export const mockFailures: Record<FailureKey, boolean> = {
  locationSave: false,
  locationRemove: false,
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
    list(query?: string): Promise<Page<Location>>;

    save(location: LocationDraft): Promise<Location>;

    savePosition(position: LocationPosition): Promise<Location>;

    remove(id: string): Promise<void>;
  };

  routes: {
    list(query?: string): Promise<Page<Pathway>>;

    save(path: Pathway): Promise<Pathway>;

    remove(id: string): Promise<void>;
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
      commit?: boolean
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
  "Updated Location", "Positioned Location", "Removed Location",
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

    list: async (q) => {

      if (USE_HTTP_API) {
        return apiJson<Page<Location>>(`/api/locations${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      }

      const filtered = q
        ? locations.filter((location) =>
            [
              location.name,
              location.code,
              location.type,
              location.function ?? "",
              location.keywords ?? "",
            ].some((value) =>
              matches(value, q)
            )
          )
        : locations;

      return wait({
        items: clone(filtered),

        total:
          filtered.length,

        page: 1,

        pageSize: 20,
      });
    },


    save: async (location) => {

      if (USE_HTTP_API) {
        return apiJson<Location>(`/api/locations${location.id ? `/${encodeURIComponent(location.id)}` : ""}`, {
          method: location.id ? "PUT" : "POST",
          body: JSON.stringify(location),
        });
      }

      failIfConfigured(
        "locationSave"
      );

      const nextLocation: Location = { ...location, id: location.id || `loc-${Date.now()}` };
      locationSchema.parse(nextLocation);

      const index =
        locations.findIndex(
          (item) =>
            item.id === nextLocation.id
        );

      if (index >= 0) {

        locations[index] =
          clone(nextLocation);

      } else {

        locations.push(
          clone(nextLocation)
        );
      }

      addAudit(
        "Updated Location",
        nextLocation.name,
        "Admin",
        nextLocation.id,
      );

      return wait(
        clone(nextLocation)
      );
    },

    savePosition: async (position) => {
      if (USE_HTTP_API) return apiJson<Location>(`/api/locations/${encodeURIComponent(position.id)}/position`, { method: "PATCH", body: JSON.stringify({ lat: position.lat, lng: position.lng, positioned: true }) });
      const location = localAdapter.map.savePosition(position.id, position.lat, position.lng);
      addAudit("Positioned Location", location.name, "Admin", location.id);
      return wait(clone(location));
    },


    remove: async (id) => {

      if (USE_HTTP_API) {
        await apiJson<unknown>(`/api/locations/${encodeURIComponent(id)}`, { method: "DELETE" });
        return;
      }

      failIfConfigured("locationRemove");

      const index =
        locations.findIndex(
          (location) =>
            location.id === id
        );

      if (index >= 0) {

        const removed =
          locations.splice(
            index,
            1
          )[0];

        addAudit("Removed Location", removed.name, "Admin", removed.id);
      }

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


    remove: async (id) => {

      if (USE_HTTP_API) {
        await apiJson<unknown>(`/api/routes/${encodeURIComponent(id)}`, { method: "DELETE" });
        return;
      }

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
        await apiJson<unknown>("/api/map/save", {
          method: "POST",
          body: JSON.stringify(edit ?? {}),
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

          location.lat =
            edit.place[0];

          location.lng =
            edit.place[1];

          location.positioned =
            true;

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

          location.lat =
            edit.movedLocation.lat;

          location.lng =
            edit.movedLocation.lng;

          location.positioned =
            true;
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
      const pending: Array<{ location: Location; existingIndex: number | null }> = [];

      validRows.forEach(({ row, index }) => {
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
          location: {
            ...existing,
            ...row,
            id: mode === "update" && existing ? existing.id : id,
            function: existing?.function ?? "",
            keywords: existing?.keywords ?? "",
            building: existing?.building,
            floor: existing?.floor,
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

    routes: async (
      json,
      commit = false
    ) => {

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

      const pending: Pathway[] =
        [];


      rows.forEach(
        (row, index) => {

          const result =
            routeImportSchema.safeParse(
              row
            );


          if (!result.success) {

            errors.push(
              `Row ${
                index + 1
              }: invalid route fields.`
            );

          } else if (
            !routeNodes.some(
              (node) =>
                node.id ===
                result.data.sourceNodeId
            ) ||
            !routeNodes.some(
              (node) =>
                node.id ===
                result.data.destinationNodeId
            )
          ) {

            errors.push(
              `Row ${
                index + 1
              }: node reference not found.`
            );

          } else {

            pending.push({

              ...result.data,

              distance: "—",

              time: "—",

              shade: "Unshaded",

              type: "Campus walkway",

              direction: "Two-way",

              status: "Open",
            });
          }
        }
      );


      if (
        commit &&
        errors.length === 0
      ) {

        pathways.push(
          ...pending
        );

        if (pending.length) {

          addAudit(
            "Imported Routes",
            `${pending.length} routes`
          );
        }
      }


      return wait({

        imported:
          errors.length === 0
            ? pending.length
            : 0,

        errors,
      });
    },
  },
};
