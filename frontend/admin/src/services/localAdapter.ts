import type { Building, Location, Pathway, RouteNode, Session } from "../types";

const LOCAL_SESSION_KEY = "isucamp_local_session";
const LOCAL_ADMIN = { username: "admin_justine", password: "password123" } as const;

type LocalMapData = {
  buildings: Building[];
  locations: Location[];
  nodes: RouteNode[];
  pathways: Pathway[];
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
    },
    map: {
      buildings: () => mapData.buildings,
      locations: () => mapData.locations,
      nodes: () => mapData.nodes,
      pathways: () => mapData.pathways,
      savePosition: (id: string, lat: number, lng: number): Location => {
        const location = mapData.locations.find((item) => item.id === id);
        if (!location) throw new Error("Location not found.");
        location.lat = lat;
        location.lng = lng;
        location.positioned = true;
        return location;
      },
    },
  };
};
