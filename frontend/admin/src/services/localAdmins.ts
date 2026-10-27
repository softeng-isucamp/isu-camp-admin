import type { AccountStatus, AdminAccount, AdminAccountDraft, AdminPermissions, AdminRole } from "../types";
import { PasswordConfirmationRequiredError, SuperadminRequiredError, fieldError } from "./errors";
import type { FixtureAccount, createLocalAdapter } from "./localAdapter";
import { EMAIL_IN_USE_MESSAGE, emailInUse, normalizeEmail } from "./fixtureEmails";
import { firstPasswordIssue } from "./passwordRules";
import { viewOnlyPermissions } from "../lib/permissions";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ROLE_MESSAGE = "Role must be Administrator or Superadmin.";
const PERMISSIONS_MESSAGE = "Permissions must be Add, Edit, Delete and Change app user status, each on or off.";
const LAST_SUPERADMIN_MESSAGE = "At least one active superadmin is required. Promote another account first.";

type Directory = ReturnType<typeof createLocalAdapter>["directory"];

/** Records one administrator action in the fixture's System Logs. */
type Audit = (action: string, target: string, targetId: string) => void;

/**
 * The fixture's administrator accounts, with the server's authorization and
 * self rules and its messages. The records are the adapter's sign-in accounts,
 * so who is "current" and what they may do follow whoever signed in.
 */
export const createLocalAdmins = ({ accounts, viewer, caller: activeCaller, recentlyConfirmed }: Directory, audit: Audit) => {
  const asAccount = (record: FixtureAccount): AdminAccount => ({
    id: record.id,
    username: record.username,
    email: record.email,
    status: record.status,
    role: record.role,
    // A superadmin has everything and no switches to report.
    ...(record.role === "admin" && record.permissions ? { permissions: { ...record.permissions } } : {}),
    isCurrent: record.id === viewer()?.id,
  });

  /** Signed in as a superadmin, checked before anything about the row, as the server's guard is. */
  const requireSuperadmin = (): FixtureAccount => {
    const caller = activeCaller();
    if (caller.role !== "superadmin") throw new SuperadminRequiredError();
    return caller;
  };

  /** Asked for right after the superadmin guard, before the account or the request is looked at. */
  const requireConfirmation = (message?: string) => {
    if (!recentlyConfirmed()) throw new PasswordConfirmationRequiredError(message);
  };

  /** Whole switch sets only: an administrator is never left with a switch undecided. */
  const readPermissions = (value: unknown): AdminPermissions => {
    const record = value as Record<string, unknown> | null | undefined;
    const keys = Object.keys(viewOnlyPermissions()) as Array<keyof AdminPermissions>;
    if (!record || typeof record !== "object" || keys.some((key) => typeof record[key] !== "boolean")) {
      throw fieldError("permissions", PERMISSIONS_MESSAGE);
    }
    return Object.fromEntries(keys.map((key) => [key, record[key] as boolean])) as unknown as AdminPermissions;
  };

  /** The server's identity checks, in its order; the password is only checked when given or required. */
  const readIdentity = (draft: AdminAccountDraft, requirePassword: boolean) => {
    const username = draft.username.trim();
    const email = draft.email.trim();
    const password = draft.password ?? "";
    if (!username) throw fieldError("username", "Username is required");
    if (username.length > 255) throw fieldError("username", "Username must be 255 characters or fewer");
    if (!email) throw fieldError("email", "Email is required");
    if (!EMAIL_PATTERN.test(email)) throw fieldError("email", "Enter a valid email address");
    const weakness = requirePassword || password ? firstPasswordIssue(password) : undefined;
    if (weakness) throw fieldError("password", weakness);
    return { username, email, password };
  };

  const find = (id: string): FixtureAccount => {
    const record = accounts.find((account) => account.id === id);
    if (!record) throw new Error("That administrator no longer exists. Reload the page.");
    return record;
  };

  const ensureUsernameFree = (username: string, excludingId?: string) => {
    const taken = accounts.some((account) =>
      account.username.toLowerCase() === username.toLowerCase() && account.id !== excludingId);
    if (taken) throw fieldError("username", "That username is already taken");
  };

  /** An address is free only if no other administrator holds it, as primary or alternative; one pool, case-insensitive. */
  const ensureEmailFree = (email: string, excludingId?: string) => {
    if (emailInUse(accounts, email, excludingId)) throw fieldError("email", EMAIL_IN_USE_MESSAGE);
  };

  /** True when the record is the only active superadmin, so changing it would leave none. */
  const isLastActiveSuperadmin = (record: FixtureAccount): boolean =>
    record.role === "superadmin" && record.status === "Active"
    && accounts.filter((account) => account.role === "superadmin" && account.status === "Active").length <= 1;

  return {
    list: async (): Promise<AdminAccount[]> => {
      activeCaller();
      return accounts.map(asAccount);
    },

    save: async (draft: AdminAccountDraft): Promise<AdminAccount> => {
      // Adding is superadmin-only; editing is only ever of one's own account.
      if (!draft.id) {
        requireSuperadmin();
        const { username, email, password } = readIdentity(draft, true);
        // A role is only chosen when adding; the server accepts nothing but the two.
        const role = draft.role ?? "admin";
        if (role !== "admin" && role !== "superadmin") throw fieldError("role", ROLE_MESSAGE);
        ensureUsernameFree(username);
        ensureEmailFree(email);
        // A new administrator is view only unless the caller turned something on; a superadmin has no switches.
        const permissions = role === "admin" ? (draft.permissions ? readPermissions(draft.permissions) : viewOnlyPermissions()) : undefined;
        // Reported after the field errors above, as the server does, so the form can show them before asking for a password.
        requireConfirmation(role === "superadmin" ? "Confirm your password to create a superadmin." : "Confirm your password to add an administrator.");
        const created: FixtureAccount = {
          id: `admin-${Date.now()}`, username, email, role, status: "Active", password, alternativeEmail: null,
          ...(permissions ? { permissions } : {}),
        };
        accounts.push(created);
        audit("Created Administrator", username, created.id);
        return asAccount(created);
      }

      const caller = activeCaller();
      const existing = find(draft.id);
      // Sign-in details belong to their holder, as the backend enforces.
      if (existing.id !== caller.id) throw new Error("You can only edit your own administrator account.");
      const { username, email, password } = readIdentity(draft, false);
      ensureUsernameFree(username, existing.id);
      // Only a changed address is checked, so one an existing account already shares does not block other edits.
      if (normalizeEmail(email) !== normalizeEmail(existing.email)) ensureEmailFree(email, existing.id);
      existing.username = username;
      existing.email = email;
      // A blank password leaves the existing one alone, as on the server.
      if (password) existing.password = password;
      audit("Updated Administrator", username, existing.id);
      return asAccount(existing);
    },

    setStatus: async (id: string, status: AccountStatus): Promise<AdminAccount> => {
      const caller = requireSuperadmin();
      const record = find(id);
      if (status === "Inactive") {
        if (record.id === caller.id) throw new Error("You cannot deactivate your own administrator account.");
        const activeAdmins = accounts.filter((account) => account.status === "Active").length;
        if (activeAdmins <= 1) throw new Error("The last active administrator cannot be deactivated.");
        if (isLastActiveSuperadmin(record)) throw new Error(LAST_SUPERADMIN_MESSAGE);
      }
      record.status = status;
      audit(status === "Inactive" ? "Deactivated Administrator" : "Activated Administrator", record.username, record.id);
      return asAccount(record);
    },

    /**
     * Setting the role an account already holds succeeds without a change or a log entry.
     * Demoting takes the switches the account starts with (view only when omitted);
     * promoting discards them.
     */
    setRole: async (id: string, role: AdminRole, permissions?: AdminPermissions): Promise<AdminAccount> => {
      const caller = requireSuperadmin();
      requireConfirmation("Confirm your password to change this administrator's role.");
      const record = find(id);
      if (role !== "admin" && role !== "superadmin") throw fieldError("role", ROLE_MESSAGE);
      if (record.id === caller.id) throw new Error("You cannot change your own role.");
      if (record.role === role) return asAccount(record);
      if (role === "admin" && isLastActiveSuperadmin(record)) throw new Error(LAST_SUPERADMIN_MESSAGE);
      const demotedWith = role === "admin" ? (permissions ? readPermissions(permissions) : viewOnlyPermissions()) : undefined;
      record.role = role;
      if (demotedWith) record.permissions = demotedWith;
      else delete record.permissions;
      audit(role === "superadmin" ? "Promoted Administrator" : "Demoted Administrator", record.username, record.id);
      return asAccount(record);
    },

    // Open to every administrator: the code only reaches the account's own inbox.
    sendPasswordReset: async (id: string): Promise<string> => {
      activeCaller();
      const record = find(id);
      if (!record.email) throw new Error("That account has no email address on file, so a reset code cannot be sent.");
      audit("Sent Password Reset", record.username, record.id);
      return `A password reset code was sent to ${record.email}.`;
    },

    /** Replaces a regular administrator's switches. Not for oneself, and not for a superadmin, who has everything. */
    setPermissions: async (id: string, permissions: AdminPermissions): Promise<AdminAccount> => {
      const caller = requireSuperadmin();
      requireConfirmation("Confirm your password to change this administrator's permissions.");
      const record = find(id);
      if (record.id === caller.id) throw new Error("You cannot change your own permissions.");
      if (record.role === "superadmin") throw new Error("Superadmins have every permission. Make them an administrator first to restrict them.");
      record.permissions = readPermissions(permissions);
      audit("Updated Administrator Permissions", record.username, record.id);
      return asAccount(record);
    },
  };
};
