import type {
  AuditEntry,
  DashboardSummary,
  Location,
  Page,
  Pathway,
  RouteNode,
  Session,
  UserAccount,
} from "../types";
import {
  auditEntries,
  buildings,
  locations,
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

const wait = <T>(value: T, delay = 120) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), delay));
const clone = <T>(value: T): T => structuredClone(value);
const matches = (value: string, query: string) =>
  value.toLowerCase().includes(query.trim().toLowerCase());
export type FailureKey =
  "locationSave" | "routeSave" | "userUpdate" | "mapSave";
export const mockFailures: Record<FailureKey, boolean> = {
  locationSave: false,
  routeSave: false,
  userUpdate: false,
  mapSave: false,
};
export const setMockFailure = (key: FailureKey, enabled: boolean) => {
  mockFailures[key] = enabled;
};
const failIfConfigured = (key: FailureKey) => {
  if (mockFailures[key]) throw new Error(`Mock ${key} failed.`);
};
let adminPassword = "password123";

export interface Services {
  auth: {
    login(username: string, password: string): Promise<Session>;
    logout(): Promise<void>;
    reset(code: string, password: string): Promise<void>;
  };
  dashboard: { summary(): Promise<DashboardSummary> };
  locations: {
    list(query?: string): Promise<Page<Location>>;
    save(location: Location): Promise<Location>;
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
      date?: string,
    ): Promise<Page<AuditEntry>>;
  };
  map: {
    buildings(): Promise<typeof buildings>;
    locations(): Promise<Location[]>;
    nodes(): Promise<RouteNode[]>;
    pathways(): Promise<Pathway[]>;
    save(edit?: {
      selected?: { type: string; id: string };
      place?: [number, number] | null;
      pathPoints?: [number, number][];
    }): Promise<void>;
  };
  imports: {
    locations(
      json: string,
      commit?: boolean,
    ): Promise<{ imported: number; errors: string[] }>;
    routes(
      json: string,
      commit?: boolean,
    ): Promise<{ imported: number; errors: string[] }>;
  };
}

const addAudit = (
  action: string,
  target: string,
  category: AuditEntry["category"] = "Admin",
) =>
  auditEntries.unshift({
    id: `a-${Date.now()}`,
    actor: "admin01",
    action,
    target,
    createdAt: "Just now",
    category,
  });
export const services: Services = {
  auth: {
    login: async (username, password) => {
      if (username !== "admin_justine" || password !== adminPassword)
        throw new Error("Invalid username or password.");
      return wait({ username, role: "Administrator" });
    },
    logout: async () => wait(undefined),
    reset: async (code, password) => {
      if (code !== "000000" || password.length < 8)
        throw new Error("Invalid verification code or password.");
      adminPassword = password;
      return wait(undefined);
    },
  },
  dashboard: {
    summary: async () =>
      wait({
        buildings: 142,
        offices: 1854,
        locations: locations.length,
        pathways: pathways.filter((path) => path.status === "Open").length,
        searches: 438,
        topSearched: clone(topSearchedLocations),
        recent: clone(auditEntries.slice(0, 3)),
      }),
  },
  locations: {
    list: async (q) => {
      const filtered = q
        ? locations.filter((l) =>
            [l.name, l.code, l.type, l.function ?? "", l.keywords ?? ""].some(
              (v) => matches(v, q),
            ),
          )
        : locations;
      return wait({
        items: clone(filtered),
        total: filtered.length,
        page: 1,
        pageSize: 20,
      });
    },
    save: async (location) => {
      failIfConfigured("locationSave");
      locationSchema.parse(location);
      const i = locations.findIndex((l) => l.id === location.id);
      if (i >= 0) locations[i] = clone(location);
      else locations.push(clone(location));
      addAudit("Updated Location", location.name);
      return wait(clone(location));
    },
    remove: async (id) => {
      const i = locations.findIndex((l) => l.id === id);
      if (i >= 0) addAudit("Removed Location", locations.splice(i, 1)[0].name);
      return wait(undefined);
    },
  },
  routes: {
    list: async (q) => {
      const filtered = q
        ? pathways.filter((p) => matches(p.name, q))
        : pathways;
      return wait({
        items: clone(filtered),
        total: filtered.length,
        page: 1,
        pageSize: 20,
      });
    },
    save: async (path) => {
      failIfConfigured("routeSave");
      pathwaySchema.parse(path);
      const i = pathways.findIndex((p) => p.id === path.id);
      if (i >= 0) pathways[i] = clone(path);
      else pathways.push(clone(path));
      addAudit("Updated Route", path.name);
      return wait(clone(path));
    },
    remove: async (id) => {
      const i = pathways.findIndex((p) => p.id === id);
      if (i >= 0) addAudit("Removed Route", pathways.splice(i, 1)[0].name);
      return wait(undefined);
    },
  },
  users: {
    list: async (q) => {
      const filtered = q ? users.filter((u) => matches(u.username, q)) : users;
      return wait({
        items: clone(filtered),
        total: filtered.length,
        page: 1,
        pageSize: 20,
      });
    },
    create: async (user) => {
      failIfConfigured("userUpdate");
      userAccountSchema.parse(user);
      users.push(clone(user));
      addAudit("Created User", user.username);
      return wait(clone(user));
    },
    update: async (user) => {
      failIfConfigured("userUpdate");
      userAccountSchema.parse(user);
      const i = users.findIndex((u) => u.id === user.id);
      if (i >= 0) users[i] = clone(user);
      addAudit("Updated User", user.username);
      return wait(clone(user));
    },
    reset: async (id) => {
      failIfConfigured("userUpdate");
      const user = users.find((item) => item.id === id);
      if (user) addAudit("Reset User Password", user.username);
      return wait(undefined);
    },
    remove: async (id) => {
      const i = users.findIndex((u) => u.id === id);
      if (i >= 0) addAudit("Removed User", users.splice(i, 1)[0].username);
      return wait(undefined);
    },
  },
  logs: {
    list: async (category, q, actor, date) => {
      const filtered = auditEntries.filter((e) => {
        const categoryMatch =
          !category || category === "All" || e.category === category;
        const queryMatch =
          !q || [e.action, e.actor, e.target].some((v) => matches(v, q));
        const actorMatch =
          !actor || actor === "All Actors" || e.actor === actor;
        const dateMatch =
          !date || date === "All Dates" || e.createdAt.includes(date);
        return categoryMatch && queryMatch && actorMatch && dateMatch;
      });
      return wait({
        items: clone(filtered),
        total: filtered.length,
        page: 1,
        pageSize: 20,
      });
    },
  },
  map: {
    buildings: async () => wait(clone(buildings)),
    locations: async () => wait(clone(locations)),
    nodes: async () => wait(clone(routeNodes)),
    pathways: async () => wait(clone(pathways)),
    save: async (edit) => {
      failIfConfigured("mapSave");
      if (edit?.selected && edit.place) {
        const location = locations.find(
          (item) => item.id === edit.selected?.id,
        );
        const node = routeNodes.find((item) => item.id === edit.selected?.id);
        if (location) {
          location.lat = edit.place[0];
          location.lng = edit.place[1];
        } else if (node) {
          node.lat = edit.place[0];
          node.lng = edit.place[1];
        }
      }
      if (edit?.selected && edit.pathPoints) {
        const path = pathways.find((item) => item.id === edit.selected?.id);
        if (path) path.pathPoints = clone(edit.pathPoints);
      }
      addAudit("Updated Map", "Campus geometry");
      return wait(undefined);
    },
  },
  imports: {
    locations: async (json, commit = false) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        return { imported: 0, errors: ["Invalid JSON file."] };
      }
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      const errors: string[] = [];
      const pending: Location[] = [];
      rows.forEach((row, i) => {
        const result = locationImportSchema.safeParse(row);
        if (!result.success)
          errors.push(`Row ${i + 1}: invalid location fields.`);
        else if (
          result.data.parentId &&
          !locations.some((l) => l.id === result.data.parentId)
        )
          errors.push(`Row ${i + 1}: parent location reference not found.`);
        else {
          pending.push({
            ...result.data,
            function: "",
            keywords: "",
            building: undefined,
            floor: undefined,
            positioned: true,
          });
        }
      });
      if (commit && errors.length === 0) {
        locations.push(...pending);
        if (pending.length)
          addAudit("Imported Locations", `${pending.length} locations`);
      }
      return wait({
        imported: errors.length === 0 ? pending.length : 0,
        errors,
      });
    },
    routes: async (json, commit = false) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        return { imported: 0, errors: ["Invalid JSON file."] };
      }
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      const errors: string[] = [];
      const pending: Pathway[] = [];
      rows.forEach((row, i) => {
        const result = routeImportSchema.safeParse(row);
        if (!result.success) errors.push(`Row ${i + 1}: invalid route fields.`);
        else if (
          !routeNodes.some((n) => n.id === result.data.sourceNodeId) ||
          !routeNodes.some((n) => n.id === result.data.destinationNodeId)
        )
          errors.push(`Row ${i + 1}: node reference not found.`);
        else {
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
      });
      if (commit && errors.length === 0) {
        pathways.push(...pending);
        if (pending.length)
          addAudit("Imported Routes", `${pending.length} routes`);
      }
      return wait({
        imported: errors.length === 0 ? pending.length : 0,
        errors,
      });
    },
  },
};
