import type { Building, Location, LocationDraft, Pathway, RouteNode, Session } from "../types";
import { locationPolicy } from "../lib/locationPolicy";

const LOCAL_SESSION_KEY = "isucamp_local_session";
const LOCAL_ADMIN = { username: "admin_justine", password: "password123" } as const;

type LocalMapData = {
  locations: Location[];
  // Accepted for compatibility with callers that construct the local seed
  // as one object. Network records are owned by the canonical network seam;
  // this adapter must not expose a second mutable map collection.
  buildings?: Building[];
  nodes?: RouteNode[];
  pathways?: Pathway[];
};

const parseSession = (storage: Storage | null): Session | null => {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(LOCAL_SESSION_KEY) ?? "null");
    return value && typeof value.id === "string" && typeof value.username === "string" ? value : null;
  } catch {
    return null;
  }
};

export const createLocalAdapter = (mapData: LocalMapData, storage: Storage | null) => {
  let session = parseSession(storage);
  let resetUsername: string | null = null;

  return {
    auth: {
      login: async (username: string, password: string): Promise<Session> => {
        if (username.trim() !== LOCAL_ADMIN.username || password !== LOCAL_ADMIN.password) {
          throw new Error("Invalid username or password");
        }
        session = { id: "local-admin", username: LOCAL_ADMIN.username };
        storage?.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
        return session;
      },
      logout: async (): Promise<void> => {
        session = null;
        storage?.removeItem(LOCAL_SESSION_KEY);
      },
      me: async (): Promise<Session | null> => session,
      requestReset: async (username: string): Promise<void> => {
        if (username.trim() !== LOCAL_ADMIN.username) throw new Error("Admin username not found.");
        resetUsername = username.trim();
      },
      reset: async (username: string, code: string, _password: string): Promise<void> => {
        if (resetUsername !== username.trim() || code !== "000000") throw new Error("Invalid verification code.");
        resetUsername = null;
      },
    },
    locations: {
      savePosition: (id: string, lat: number | null, lng: number | null): Location => {
        const location = mapData.locations.find((item) => item.id === id);
        if (!location) throw new Error("Location not found.");
        if (location.type !== "Facility" || location.parentId !== null) throw new Error("Only standalone legacy Facility records can own an outdoor position.");
        if ((lat === null) !== (lng === null)) throw new Error("Latitude and longitude must be provided together.");
        if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) throw new Error("Latitude must be between -90 and 90.");
        if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) throw new Error("Longitude must be between -180 and 180.");
        location.lat = lat;
        location.lng = lng;
        location.positioned = lat !== null && lng !== null;
        return location;
      },
      save: (draft: LocationDraft): Location => {
        const location: Location = { ...draft, id: draft.id || `loc-${Date.now()}` };
        const evaluation = locationPolicy.evaluate(location, {
          context: "record",
          directory: mapData.locations,
          requireFloorLevel: !draft.id,
          currentId: draft.id ?? "__new__",
        });
        if (!evaluation.valid) throw new Error(evaluation.issues[0].message);
        const index = mapData.locations.findIndex((item) => item.id === location.id);
        if (index >= 0) mapData.locations[index] = structuredClone(location);
        else mapData.locations.push(structuredClone(location));

        // Locations own a Building's identity, while the linked Building record
        // owns its footprint. Keep that one local source of map geometry in sync
        // with a Location save so the next Map Editor read sees the same polygon.
        if ((location.type === "Building" || location.type === "Facility") && location.polygonCoordinates) {
          const building: Building = {
            id: location.id,
            name: location.name,
            code: location.code,
            type: location.type,
            points: structuredClone(location.polygonCoordinates),
            status: location.status,
          };
          const buildingIndex = mapData.buildings?.findIndex((item) => item.id === building.id) ?? -1;
          if (buildingIndex >= 0 && mapData.buildings) mapData.buildings[buildingIndex] = building;
          else mapData.buildings?.push(building);
        }
        return location;
      },
      remove: (id: string): Location | undefined => {
        const index = mapData.locations.findIndex((item) => item.id === id);
        if (index < 0) return undefined;
        const [location] = mapData.locations.splice(index, 1);
        return location;
      },
    },
    buildings: {
      list: (): Building[] => structuredClone(mapData.buildings ?? []),
    },
  };
};
