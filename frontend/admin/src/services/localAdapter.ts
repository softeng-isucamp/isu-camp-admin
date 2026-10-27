import type { AccountProfile, ProfileChanges, PasswordChange } from "./profile";
import type { AccountStatus, AdminPermissions, Building, Location, LocationDraft, Pathway, RouteNode, Session } from "../types";
import { canContainLocations, isPlace, locationPolicy, placeClassificationOf } from "../lib/locationPolicy";
import { pointInPolygon } from "../features/map/campusBoundary";
import { AuthError, RateLimitError, RequestError, fieldErrorsOf } from "./errors";
import { EMAIL_IN_USE_MESSAGE, emailInUse, normalizeEmail } from "./fixtureEmails";
import { firstPasswordIssue } from "./passwordRules";
import { allPermissions, viewOnlyPermissions } from "../lib/permissions";
import type { CodeRequestResult, RecoveryPurpose, RecoveryResult } from "./recovery";

const LOCAL_SESSION_KEY = "isucamp_local_session";
const LOCAL_PASSWORD = "password123";
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_LOCKOUT_SECONDS = 60;
const CONFIRMATION_WINDOW_MS = 5 * 60 * 1000;
const DEACTIVATED_MESSAGE = "This administrator account has been deactivated.";
const LOCAL_ADMIN_EMAIL = "admin@isu.edu.ph";
const RECOVERY_TEST_CODE = "000000";
const RECOVERY_ATTEMPT_LIMIT = 5;
const RECOVERY_EXPIRES_SECONDS = 600;
const RECOVERY_RESEND_SECONDS = 60;

/** A fixture administrator: the sign-in, the directory row and the session all read this one record. */
export type FixtureAccount = AccountProfile & { password: string; status: AccountStatus; permissions?: AdminPermissions };

/**
 * `admin_justine` is the demo superadmin and `admin_registrar` the plain
 * administrator; `admin_dean` is a second superadmin so one can act on another.
 * `admin_viewer` is an administrator with every switch off, for trying the
 * restricted portal. They all sign in with the same password. `admin_dean` also
 * has an alternative email, so the shared email pool's duplicate path can be tried.
 */
const seedAccounts = (): FixtureAccount[] => [
  { id: "1", username: "admin_justine", email: LOCAL_ADMIN_EMAIL, role: "superadmin", status: "Active", password: LOCAL_PASSWORD, alternativeEmail: null },
  { id: "2", username: "admin_registrar", email: "registrar.admin@isu.edu.ph", role: "admin", status: "Active", password: LOCAL_PASSWORD, alternativeEmail: null, permissions: allPermissions() },
  { id: "3", username: "admin_dean", email: "dean.admin@isu.edu.ph", role: "superadmin", status: "Active", password: LOCAL_PASSWORD, alternativeEmail: "dean.backup@gmail.com" },
  { id: "4", username: "admin_viewer", email: "viewer.admin@isu.edu.ph", role: "admin", status: "Active", password: LOCAL_PASSWORD, alternativeEmail: null, permissions: viewOnlyPermissions() },
];

const profileOf = ({ id, username, email, role, alternativeEmail }: FixtureAccount): AccountProfile => ({ id, username, email, role, alternativeEmail });
/**
 * What the server's session reports: the sign-in identity plus a regular
 * administrator's switches. The alternative email is read from the profile.
 */
const sessionOf = ({ id, username, email, role, permissions }: FixtureAccount): Session =>
  role === "admin" && permissions ? { id, username, email, role, permissions: { ...permissions } } : { id, username, email, role };

/** A code the fixture handed out. `account` is unset for emails with no account, which still behave like they have one. */
type IssuedCode = { account?: FixtureAccount; attempts: number; expiresAt: number };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const rememberedStorage = typeof localStorage !== "undefined" ? localStorage : null;
  let sessionStore = storage;
  let session = parseSession(storage);
  if (!session) {
    session = parseSession(rememberedStorage);
    if (session) sessionStore = rememberedStorage;
  }
  const clearStoredSession = () => {
    storage?.removeItem(LOCAL_SESSION_KEY);
    rememberedStorage?.removeItem(LOCAL_SESSION_KEY);
  };
  // Profile edits keep the persistence selected at login, even after restoration.
  const persistSession = () => {
    if (!session) return;
    sessionStore?.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
    if (sessionStore !== storage) storage?.removeItem(LOCAL_SESSION_KEY);
    if (sessionStore !== rememberedStorage) rememberedStorage?.removeItem(LOCAL_SESSION_KEY);
  };
  const restored = accounts.find((record) => record.id === session?.id);
  // Accounts added in an earlier page load are gone, so a session for one of
  // them has nobody to be: signed out, never another account's identity or role.
  if (session && !restored) {
    session = null;
    clearStoredSession();
  }
  // The account the session belongs to, or the demo superadmin while signed out.
  // The stored session carries only profile edits; the role is the directory's.
  let account = restored ?? accounts[0];
  if (session && restored) {
    account.username = session.username;
    account.email = session.email ?? account.email;
  }
  // When the signed-in account last retyped its password; the server keeps this on the session.
  let confirmedAt = 0;
  /** Whether the signed-in account confirmed its password within the server's five minutes. */
  const recentlyConfirmed = (): boolean => Date.now() - confirmedAt <= CONFIRMATION_WINDOW_MS;
  const endSession = () => {
    session = null;
    confirmedAt = 0;
    clearStoredSession();
  };
  // The server reads the account row on every request, so one deactivated while
  // signed in is refused on its next request and signed out.
  const refuseIfDeactivated = () => {
    if (session && account.status !== "Active") {
      endSession();
      throw new Error(DEACTIVATED_MESSAGE);
    }
  };
  const issuedCodes = new Map<string, IssuedCode>();
  let failedLogins = 0;
  let lockedUntil = 0;

  const issueCode = (email: string, purpose: RecoveryPurpose, known = true): IssuedCode => {
    // Either address reaches the account; the code is only ever "sent" to the one typed.
    const owner = known
      ? accounts.find((record) => normalizeEmail(record.email) === normalizeEmail(email)
        || (!!record.alternativeEmail && normalizeEmail(record.alternativeEmail) === normalizeEmail(email)))
      : undefined;
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
      login: async (username: string, password: string, remember?: boolean): Promise<Session> => {
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
        // Checked after the password, so a wrong guess cannot discover which accounts are deactivated.
        if (candidate.status !== "Active") throw new Error(`${DEACTIVATED_MESSAGE} Ask another administrator to reactivate it.`);
        failedLogins = 0;
        account = candidate;
        confirmedAt = 0;
        session = sessionOf(account);
        sessionStore = remember ? rememberedStorage ?? storage : storage;
        persistSession();
        return session;
      },
      logout: async (): Promise<void> => endSession(),
      me: async (): Promise<Session | null> => {
        if (session && account.status !== "Active") endSession();
        return session ? sessionOf(account) : null;
      },
      profile: async (): Promise<AccountProfile> => {
        if (!session) throw new Error("Sign in to view your profile.");
        refuseIfDeactivated();
        return profileOf(account);
      },
      updateProfile: async (changes: ProfileChanges): Promise<AccountProfile> => {
        if (!session) throw new Error("Sign in to edit your profile.");
        refuseIfDeactivated();
        const username = changes.username.trim();
        const email = changes.email.trim();
        const alternative = (changes.alternativeEmail ?? "").trim();
        const errors: Record<string, string> = {};
        // Each check runs only for a field that changed, so an address another account already shares does not block other edits.
        const emailChanged = normalizeEmail(email) !== normalizeEmail(account.email);
        const alternativeChanged = changes.alternativeEmail !== undefined
          && normalizeEmail(alternative) !== normalizeEmail(account.alternativeEmail ?? "");
        if (!username) errors.username = "Username is required";
        else if (username.toLowerCase() !== account.username.toLowerCase()
          && accounts.some((record) => record.id !== account.id && record.username.toLowerCase() === username.toLowerCase())) {
          errors.username = "That username is already taken";
        }
        if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address";
        if (alternative && !EMAIL_PATTERN.test(alternative)) errors.alternativeEmail = "Enter a valid email address";
        else if (alternative && normalizeEmail(alternative) === normalizeEmail(email)) errors.alternativeEmail = "Use a different address from your primary email";
        if (emailChanged || alternativeChanged) {
          const given = changes.currentPassword ?? "";
          if (!given) errors.currentPassword = "Enter your current password to change an email address";
          else if (given !== account.password) errors.currentPassword = "Your current password is incorrect";
        }
        // Only once the password is proven, so a session without it cannot probe which addresses are taken.
        if (!errors.currentPassword) {
          if (emailChanged && !errors.email && emailInUse(accounts, email, account.id)) errors.email = EMAIL_IN_USE_MESSAGE;
          if (alternativeChanged && alternative && !errors.alternativeEmail && emailInUse(accounts, alternative, account.id)) errors.alternativeEmail = EMAIL_IN_USE_MESSAGE;
        }
        if (Object.keys(errors).length) throw fieldErrorsOf(errors);
        account.username = username;
        account.email = email;
        if (changes.alternativeEmail !== undefined) account.alternativeEmail = alternative || null;
        session = sessionOf(account);
        persistSession();
        return profileOf(account);
      },
      changePassword: async (changes: PasswordChange): Promise<void> => {
        if (!session) throw new Error("Sign in to change your password.");
        refuseIfDeactivated();
        if (changes.currentPassword !== account.password) throw new Error("Current password is incorrect.");
        const weakness = firstPasswordIssue(changes.newPassword);
        if (weakness) throw new Error(weakness);
        account.password = changes.newPassword;
      },
      // Opens the confirmation window the administrator actions that need one read.
      // A wrong password closes it again, as the server's session does.
      confirmPassword: async (password: string): Promise<void> => {
        refuseIfDeactivated();
        if (password !== account.password) {
          confirmedAt = 0;
          throw new Error("Password is incorrect");
        }
        confirmedAt = Date.now();
      },
      recentlyConfirmed,
      // The address must be on an account, as the real backend requires: an
      // address nobody holds is refused here rather than issuing a code that
      // could never verify.
      requestRecovery: async (email: string, purpose: RecoveryPurpose): Promise<CodeRequestResult> => {
        const issued = issueCode(email, purpose);
        if (!issued.account) {
          issuedCodes.delete(`${purpose}:${normalizeEmail(email)}`);
          throw new AuthError(
            "email_not_found",
            "That email is not registered to an administrator account. Check the address and try again.",
          );
        }
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
      /** The account making an administrator request: signed in and still active, or the request is refused. */
      caller: (): FixtureAccount => {
        if (!session) throw new RequestError("session");
        refuseIfDeactivated();
        return account;
      },
      recentlyConfirmed,
      /** User Management's send: issues the account's password code, as the backend does, so it can be redeemed on Forgot Password. */
      issuePasswordReset: (record: FixtureAccount): void => {
        issueCode(record.email, "password");
      },
    },
    locations: {
      saveIndoorPosition: (id: string, buildingId: string, lat: number | null, lng: number | null): Location => {
        const location = mapData.locations.find((item) => item.id === id);
        const building = mapData.buildings?.find((item) => item.id === buildingId);
        if (!location || !["Room", "Office", "Laboratory", "Restroom"].includes(location.type) ||
            (location.parentId !== buildingId && location.building !== building?.name)) {
          throw new Error("This location doesn't belong to the selected building. Reload the page and try again.");
        }
        if (!building || building.points.length < 3) throw new Error("This building has no outline to place a marker in. Draw its outline first.");
        if ((lat === null) !== (lng === null)) throw new Error("The marker position is invalid. Place the marker again.");
        if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) throw new Error("The marker position is invalid. Place the marker again.");
        if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) throw new Error("The marker position is invalid. Place the marker again.");
        if (lat !== null && lng !== null && !pointInPolygon([lat, lng], building.points)) {
          throw new Error("Place the marker inside the building's outline.");
        }
        location.lat = lat;
        location.lng = lng;
        location.positioned = lat !== null && lng !== null;
        return structuredClone(location);
      },
      savePosition: (id: string, lat: number | null, lng: number | null): Location => {
        const location = mapData.locations.find((item) => item.id === id);
        if (!location) throw new Error("That location no longer exists. Reload the page.");
        if (!isPlace(location) || canContainLocations(placeClassificationOf(location)) || location.parentId !== null) throw new Error("Only standalone Food, Parking, and Facility records can own an outdoor position.");
        if ((lat === null) !== (lng === null)) throw new Error("The marker position is invalid. Place the marker again.");
        if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) throw new Error("The marker position is invalid. Place the marker again.");
        if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) throw new Error("The marker position is invalid. Place the marker again.");
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
        if (isPlace(location) && location.polygonCoordinates) {
          const building: Building = {
            id: location.id,
            name: location.name,
            code: location.code,
            classification: placeClassificationOf(location),
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
