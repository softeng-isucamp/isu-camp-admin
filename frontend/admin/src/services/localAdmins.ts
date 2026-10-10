import type { AccountStatus, AdminAccount, AdminAccountDraft, AdminRole } from "../types";
import { PasswordConfirmationRequiredError, SuperadminRequiredError, fieldError } from "./errors";
import type { FixtureAccount, createLocalAdapter } from "./localAdapter";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MIN_PASSWORD_LENGTH = 8;
const ROLE_MESSAGE = "Role must be Administrator or Superadmin.";
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

  /** The server's identity checks, in its order; the password is only checked when given or required. */
  const readIdentity = (draft: AdminAccountDraft, requirePassword: boolean) => {
    const username = draft.username.trim();
    const email = draft.email.trim();
    const password = draft.password ?? "";
    if (!username) throw fieldError("username", "Username is required");
    if (username.length > 255) throw fieldError("username", "Username must be 255 characters or fewer");
    if (!email) throw fieldError("email", "Email is required");
    if (!EMAIL_PATTERN.test(email)) throw fieldError("email", "Enter a valid email address");
    if ((requirePassword || password) && [...password].length < MIN_PASSWORD_LENGTH) {
      throw fieldError("password", `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    return { username, email, password };
  };

  const find = (id: string): FixtureAccount => {
    const record = accounts.find((account) => account.id === id);
    if (!record) throw new Error("Administrator not found.");
    return record;
  };

  const ensureUsernameFree = (username: string, excludingId?: string) => {
    const taken = accounts.some((account) =>
      account.username.toLowerCase() === username.toLowerCase() && account.id !== excludingId);
    if (taken) throw fieldError("username", "That username is already taken");
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
        // Reported after the field errors above, as the server does, so the form can show them before asking for a password.
        if (role === "superadmin") requireConfirmation("Confirm your password to create a superadmin.");
        const created: FixtureAccount = { id: `admin-${Date.now()}`, username, email, role, status: "Active", password };
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

    /** Setting the role an account already holds succeeds without a change or a log entry. */
    setRole: async (id: string, role: AdminRole): Promise<AdminAccount> => {
      const caller = requireSuperadmin();
      requireConfirmation("Confirm your password to change this administrator's role.");
      const record = find(id);
      if (role !== "admin" && role !== "superadmin") throw fieldError("role", ROLE_MESSAGE);
      if (record.id === caller.id) throw new Error("You cannot change your own role.");
      if (record.role === role) return asAccount(record);
      if (role === "admin" && isLastActiveSuperadmin(record)) throw new Error(LAST_SUPERADMIN_MESSAGE);
      record.role = role;
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

    remove: async (id: string): Promise<void> => {
      const caller = requireSuperadmin();
      requireConfirmation();
      const record = find(id);
      if (record.id === caller.id) throw new Error("You cannot remove your own administrator account.");
      if (accounts.length <= 1) throw new Error("The last administrator account cannot be removed.");
      if (isLastActiveSuperadmin(record)) throw new Error(LAST_SUPERADMIN_MESSAGE);
      accounts.splice(accounts.indexOf(record), 1);
      audit("Deleted Administrator", record.username, record.id);
    },
  };
};
