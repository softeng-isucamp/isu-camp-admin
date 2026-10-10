import type { AccountProfile, ProfileChanges, PasswordChange } from "./profile";
import type { AccountStatus, Building, Location, LocationDraft, Pathway, RouteNode, Session } from "../types";
import { locationPolicy } from "../lib/locationPolicy";
import { pointInPolygon } from "../features/map/campusBoundary";
import { AuthError, RateLimitError } from "./errors";
import { firstPasswordIssue } from "./passwordRules";
import type { CodeRequestResult, RecoveryPurpose, RecoveryResult } from "./recovery";

const LOCAL_SESSION_KEY = "isucamp_local_session";
const LOCAL_PASSWORD = "password123";
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_LOCKOUT_SECONDS = 60;
const CONFIRMATION_WINDOW_MS = 5 * 60 * 1000;
const LOCAL_ADMIN_EMAIL = "admin@isu.edu.ph";
const RECOVERY_TEST_CODE = "000000";
const RECOVERY_ATTEMPT_LIMIT = 5;
const RECOVERY_EXPIRES_SECONDS = 600;
const RECOVERY_RESEND_SECONDS = 60;

/** A fixture administrator: the sign-in, the directory row and the session all read this one record. */
export type FixtureAccount = AccountProfile & { password: string; status: AccountStatus };

/**
 * `admin_justine` is the demo superadmin and `admin_registrar` the plain
 * administrator; `admin_dean` is a second superadmin so one can act on another.
 * They all sign in with the same password.
 */
const seedAccounts = (): FixtureAccount[] => [
  { id: "1", username: "admin_justine", email: LOCAL_ADMIN_EMAIL, role: "superadmin", status: "Active", password: LOCAL_PASSWORD },
  { id: "2", username: "admin_registrar", email: "registrar.admin@isu.edu.ph", role: "admin", status: "Active", password: LOCAL_PASSWORD },
  { id: "3", username: "admin_dean", email: "dean.admin@isu.edu.ph", role: "superadmin", status: "Active", password: LOCAL_PASSWORD },
];

const profileOf = ({ id, username, email, role }: FixtureAccount): AccountProfile => ({ id, username, email, role });

/** A code the fixture handed out. `account` is unset for emails with no account, which still behave like they have one. */
type IssuedCode = { account?: FixtureAccount; attempts: number; expiresAt: number };

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
  const accounts = seedAccounts();
  let session = parseSession(storage);
  // The account the session belongs to, or the demo superadmin while signed out.
  // The stored session carries only profile edits; the role is the directory's.
  let account = accounts.find((record) => record.id === session?.id) ?? accounts[0];
  if (session) {
    account.username = session.username;
    account.email = session.email ?? account.email;
  }
  // When the signed-in account last retyped its password; the server keeps this on the session.
  let confirmedAt = 0;
  const issuedCodes = new Map<string, IssuedCode>();
  let failedLogins = 0;
  let lockedUntil = 0;

  const issueCode = (email: string, purpose: RecoveryPurpose, known = true): IssuedCode => {
    const owner = known ? accounts.find((record) => normalizeEmail(record.email) === normalizeEmail(email)) : undefined;
    const issued = { account: owner, attempts: 0, expiresAt: Date.now() + RECOVERY_EXPIRES_SECONDS * 1000 };
    issuedCodes.set(`${purpose}:${normalizeEmail(email)}`, issued);
    return issued;
  };

  // Nothing was requested for this email: count guesses against a phantom code
  // that never matches, exactly like an email with no account, so verify and
  // reset cannot succeed without a request.
  const checkCode = (email: string, purpose: RecoveryPurpose, code: string): { issued: IssuedCode; owner: FixtureAccount } => {
    const key = `${purpose}:${normalizeEmail(email)}`;
    const issued = issuedCodes.get(key) ?? issueCode(email, purpose, false);
    if (Date.now() >= issued.expiresAt) throw new AuthError("code_expired", "This code has expired. Request a new one.");
    if (issued.attempts >= RECOVERY_ATTEMPT_LIMIT) {
      throw new AuthError("code_exhausted", "Too many incorrect codes. Request a new one.", 0);
    }
    const owner = issued.account;
    if (!owner || code !== RECOVERY_TEST_CODE) {
      issued.attempts += 1;
      const remaining = RECOVERY_ATTEMPT_LIMIT - issued.attempts;
      if (remaining <= 0) throw new AuthError("code_exhausted", "Too many incorrect codes. Request a new one.", 0);
      throw new AuthError("invalid_code", "Incorrect verification code", remaining);
    }
    return { issued, owner };
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
        const candidate = accounts.find((record) => record.username === username.trim());
        if (!candidate || password !== candidate.password) {
          // Counted for unknown usernames too, so the count never hints at which exist.
          failedLogins += 1;
          if (failedLogins >= LOGIN_ATTEMPT_LIMIT) {
            lockedUntil = Date.now() + LOGIN_LOCKOUT_SECONDS * 1000;
            throw new RateLimitError(LOGIN_LOCKOUT_SECONDS);
          }
          throw new AuthError("invalid_credentials", "Invalid username or password", LOGIN_ATTEMPT_LIMIT - failedLogins);
        }
        failedLogins = 0;
        account = candidate;
        confirmedAt = 0;
        session = profileOf(account);
        storage?.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
        return session;
      },
      logout: async (): Promise<void> => {
        session = null;
        confirmedAt = 0;
        storage?.removeItem(LOCAL_SESSION_KEY);
      },
      me: async (): Promise<Session | null> => session ? profileOf(account) : null,
      profile: async (): Promise<AccountProfile> => {
        if (!session) throw new Error("Sign in to view your profile.");
        return profileOf(account);
      },
      updateProfile: async (changes: ProfileChanges): Promise<AccountProfile> => {
        if (!session) throw new Error("Sign in to edit your profile.");
        if (!changes.username.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.email.trim())) throw new Error("Enter a username and valid email.");
        account.username = changes.username.trim();
        account.email = changes.email.trim();
        session = profileOf(account);
        storage?.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
        return profileOf(account);
      },
      changePassword: async (changes: PasswordChange): Promise<void> => {
        if (!session) throw new Error("Sign in to change your password.");
        if (changes.currentPassword !== account.password) throw new Error("Current password is incorrect.");
        if (changes.newPassword.length < 8) throw new Error("Use at least 8 characters.");
        account.password = changes.newPassword;
      },
      // The fixture opens the confirmation window, but only creating a superadmin
      // asks for it; the backend owns the real guard for the other actions.
      confirmPassword: async (password: string): Promise<void> => {
        if (password !== account.password) throw new Error("Password is incorrect");
        confirmedAt = Date.now();
      },
      // Always succeeds and reports the same timing, so the response never says whether the email has an account.
      requestRecovery: async (email: string, purpose: RecoveryPurpose): Promise<CodeRequestResult> => {
        issueCode(email, purpose);
        return { expiresInSeconds: RECOVERY_EXPIRES_SECONDS, resendAfterSeconds: RECOVERY_RESEND_SECONDS };
      },
      verifyRecovery: async (email: string, purpose: RecoveryPurpose, code: string): Promise<RecoveryResult> => {
        const { owner } = checkCode(email, purpose, code);
        return { username: owner.username };
      },
      resetPassword: async (email: string, code: string, password: string): Promise<RecoveryResult> => {
        const { issued, owner } = checkCode(email, "password", code);
        const weakness = firstPasswordIssue(password);
        if (weakness) throw new AuthError("weak_password", weakness);
        owner.password = password;
        issued.account = undefined; // a used code is dead, like any wrong guess from here on
        return { username: owner.username };
      },
    },
    // The administrator directory shares these records with sign-in, so a role
    // or status changed here is what the next sign-in and `me()` report.
    directory: {
      accounts,
      /** The account the session belongs to, or null while signed out. */
      viewer: (): FixtureAccount | null => session ? account : null,
      /** Whether the signed-in account confirmed its password within the server's five minutes. */
      recentlyConfirmed: (): boolean => Date.now() - confirmedAt <= CONFIRMATION_WINDOW_MS,
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
