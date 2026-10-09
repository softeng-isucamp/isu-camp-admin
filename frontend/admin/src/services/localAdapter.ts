import type { AccountProfile, ProfileChanges, PasswordChange } from "./profile";
import type { Building, Location, LocationDraft, Pathway, RouteNode, Session } from "../types";
import { locationPolicy } from "../lib/locationPolicy";
import { pointInPolygon } from "../features/map/campusBoundary";
import { AuthError, RateLimitError } from "./errors";
import type { CodeRequestResult, RecoveryPurpose, RecoveryResult } from "./recovery";

const LOCAL_SESSION_KEY = "isucamp_local_session";
const LOCAL_ADMIN = { username: "admin_justine", password: "password123" } as const;
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_LOCKOUT_SECONDS = 60;
const LOCAL_ADMIN_EMAIL = "admin@isu.edu.ph";
const RECOVERY_TEST_CODE = "000000";
const RECOVERY_ATTEMPT_LIMIT = 5;
const RECOVERY_EXPIRES_SECONDS = 600;
const RECOVERY_RESEND_SECONDS = 60;

/** A code the fixture handed out. `valid` is false for emails with no account, which still behave like they have one. */
type IssuedCode = { valid: boolean; attempts: number; expiresAt: number };

const normalizeEmail = (email: string) => email.trim().toLowerCase();

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
  let account: AccountProfile = { id: "local-admin", username: session?.username ?? LOCAL_ADMIN.username, email: session?.email ?? LOCAL_ADMIN_EMAIL, role: "superadmin" };
  let accountPassword: string = LOCAL_ADMIN.password;
  const issuedCodes = new Map<string, IssuedCode>();
  let failedLogins = 0;
  let lockedUntil = 0;

  const issueCode = (email: string, purpose: RecoveryPurpose): IssuedCode => {
    const issued = {
      valid: normalizeEmail(email) === normalizeEmail(account.email),
      attempts: 0,
      expiresAt: Date.now() + RECOVERY_EXPIRES_SECONDS * 1000,
    };
    issuedCodes.set(`${purpose}:${normalizeEmail(email)}`, issued);
    return issued;
  };

  // An email nobody asked a code for gets one on its first guess, so a wrong
  // code looks the same whether or not the email has an account.
  const checkCode = (email: string, purpose: RecoveryPurpose, code: string): IssuedCode => {
    const key = `${purpose}:${normalizeEmail(email)}`;
    const issued = issuedCodes.get(key) ?? issueCode(email, purpose);
    if (Date.now() >= issued.expiresAt) throw new AuthError("code_expired", "This code has expired. Request a new one.");
    if (issued.attempts >= RECOVERY_ATTEMPT_LIMIT) {
      throw new AuthError("code_exhausted", "Too many incorrect codes. Request a new one.", 0);
    }
    if (!issued.valid || code !== RECOVERY_TEST_CODE) {
      issued.attempts += 1;
      const remaining = RECOVERY_ATTEMPT_LIMIT - issued.attempts;
      if (remaining <= 0) throw new AuthError("code_exhausted", "Too many incorrect codes. Request a new one.", 0);
      throw new AuthError("invalid_code", "Incorrect verification code", remaining);
    }
    return issued;
  };

  return {
    auth: {
      login: async (username: string, password: string): Promise<Session> => {
        const lockedForMs = lockedUntil - Date.now();
        if (lockedForMs > 0) throw new RateLimitError(Math.ceil(lockedForMs / 1000));
        if (lockedUntil) {
          lockedUntil = 0;
          failedLogins = 0;
        }
        if (username.trim() !== account.username || password !== accountPassword) {
          // Counted for unknown usernames too, so the count never hints at which exist.
          failedLogins += 1;
          if (failedLogins >= LOGIN_ATTEMPT_LIMIT) {
            lockedUntil = Date.now() + LOGIN_LOCKOUT_SECONDS * 1000;
            throw new RateLimitError(LOGIN_LOCKOUT_SECONDS);
          }
          throw new AuthError("invalid_credentials", "Invalid username or password", LOGIN_ATTEMPT_LIMIT - failedLogins);
        }
        failedLogins = 0;
        session = { ...account };
        storage?.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
        return session;
      },
      logout: async (): Promise<void> => {
        session = null;
        storage?.removeItem(LOCAL_SESSION_KEY);
      },
      me: async (): Promise<Session | null> => session ? { ...account } : null,
      profile: async (): Promise<AccountProfile> => {
        if (!session) throw new Error("Sign in to view your profile.");
        return { ...account };
      },
      updateProfile: async (changes: ProfileChanges): Promise<AccountProfile> => {
        if (!session) throw new Error("Sign in to edit your profile.");
        if (!changes.username.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.email.trim())) throw new Error("Enter a username and valid email.");
        account = { ...account, username: changes.username.trim(), email: changes.email.trim() };
        session = { ...account };
        storage?.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
        return { ...account };
      },
      changePassword: async (changes: PasswordChange): Promise<void> => {
        if (!session) throw new Error("Sign in to change your password.");
        if (changes.currentPassword !== accountPassword) throw new Error("Current password is incorrect.");
        if (changes.newPassword.length < 8) throw new Error("Use at least 8 characters.");
        accountPassword = changes.newPassword;
      },
      // The fixture only checks the password. Session ownership and the
      // confirmation window are enforced by the backend, which owns the real guard.
      confirmPassword: async (password: string): Promise<void> => {
        if (password !== accountPassword) throw new Error("Password is incorrect");
      },
      // Always succeeds and reports the same timing, so the response never says whether the email has an account.
      requestRecovery: async (email: string, purpose: RecoveryPurpose): Promise<CodeRequestResult> => {
        issueCode(email, purpose);
        return { expiresInSeconds: RECOVERY_EXPIRES_SECONDS, resendAfterSeconds: RECOVERY_RESEND_SECONDS };
      },
      verifyRecovery: async (email: string, purpose: RecoveryPurpose, code: string): Promise<RecoveryResult> => {
        checkCode(email, purpose, code);
        return { username: account.username };
      },
      resetPassword: async (email: string, code: string, password: string): Promise<RecoveryResult> => {
        const issued = checkCode(email, "password", code);
        if (password.length < 8) throw new AuthError("weak_password", "Password must be at least 8 characters.");
        accountPassword = password;
        issued.valid = false; // a used code is dead, like any wrong guess from here on
        return { username: account.username };
      },
    },
    locations: {
      saveIndoorPosition: (id: string, buildingId: string, lat: number | null, lng: number | null): Location => {
        const location = mapData.locations.find((item) => item.id === id);
        const building = mapData.buildings?.find((item) => item.id === buildingId);
        if (!location || !["Room", "Office", "Laboratory", "Restroom"].includes(location.type) ||
            (location.parentId !== buildingId && location.building !== building?.name)) {
          throw new Error("Indoor Location does not belong to the selected Building.");
        }
        if (!building || building.points.length < 3) throw new Error("Building footprint is unavailable.");
        if ((lat === null) !== (lng === null)) throw new Error("Latitude and longitude must be provided together.");
        if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) throw new Error("Latitude must be between -90 and 90.");
        if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) throw new Error("Longitude must be between -180 and 180.");
        if (lat !== null && lng !== null && !pointInPolygon([lat, lng], building.points)) {
          throw new Error("Indoor marker must be inside the selected Building footprint.");
        }
        location.lat = lat;
        location.lng = lng;
        location.positioned = lat !== null && lng !== null;
        return structuredClone(location);
      },
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
