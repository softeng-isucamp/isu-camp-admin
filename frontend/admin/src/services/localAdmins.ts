import type { AccountStatus, AdminAccount, AdminAccountDraft } from "../types";
import { SuperadminRequiredError } from "./errors";
import type { FixtureAccount, createLocalAdapter } from "./localAdapter";

type Directory = ReturnType<typeof createLocalAdapter>["directory"];

/** Records one administrator action in the fixture's System Logs. */
type Audit = (action: string, target: string, targetId: string) => void;

/**
 * The fixture's administrator accounts, with the server's authorization and
 * self rules and its messages. The records are the adapter's sign-in accounts,
 * so who is "current" and what they may do follow whoever signed in.
 */
export const createLocalAdmins = ({ accounts, viewer }: Directory, audit: Audit) => {
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
    const caller = viewer();
    if (!caller) throw new Error("Authentication required");
    if (caller.role !== "superadmin") throw new SuperadminRequiredError();
    return caller;
  };

  const find = (id: string): FixtureAccount => {
    const record = accounts.find((account) => account.id === id);
    if (!record) throw new Error("Administrator not found.");
    return record;
  };

  return {
    list: async (): Promise<AdminAccount[]> => accounts.map(asAccount),

    save: async (draft: AdminAccountDraft): Promise<AdminAccount> => {
      const username = draft.username.trim();
      const email = draft.email.trim();
      // Adding is superadmin-only; editing is only ever of one's own account.
      if (!draft.id) requireSuperadmin();
      const duplicate = accounts.some((account) =>
        account.username.toLowerCase() === username.toLowerCase() && account.id !== draft.id);
      if (duplicate) {
        const error = new Error("That username is already taken") as Error & { fieldErrors?: Record<string, string> };
        error.fieldErrors = { username: "That username is already taken" };
        throw error;
      }

      const existing = draft.id ? accounts.find((account) => account.id === draft.id) : undefined;
      if (existing) {
        // Sign-in details belong to their holder, as the backend enforces.
        if (existing.id !== viewer()?.id) throw new Error("You can only edit your own administrator account.");
        existing.username = username;
        existing.email = email;
        audit("Updated Administrator", username, existing.id);
        return asAccount(existing);
      }
      const created: FixtureAccount = {
        id: `admin-${Date.now()}`,
        username,
        email,
        role: "admin",
        status: "Active",
        password: draft.password ?? "",
      };
      accounts.push(created);
      audit("Created Administrator", username, created.id);
      return asAccount(created);
    },

    setStatus: async (id: string, status: AccountStatus): Promise<AdminAccount> => {
      const caller = requireSuperadmin();
      const record = find(id);
      if (status === "Inactive") {
        if (record.id === caller.id) throw new Error("You cannot deactivate your own administrator account.");
        const activeAdmins = accounts.filter((account) => account.status === "Active").length;
        if (activeAdmins <= 1) throw new Error("The last active administrator cannot be deactivated.");
      }
      record.status = status;
      audit(status === "Inactive" ? "Deactivated Administrator" : "Activated Administrator", record.username, record.id);
      return asAccount(record);
    },

    // Open to every administrator: the code only reaches the account's own inbox.
    sendPasswordReset: async (id: string): Promise<string> => {
      const record = find(id);
      if (!record.email) throw new Error("That account has no email address on file, so a reset code cannot be sent.");
      audit("Sent Password Reset", record.username, record.id);
      return `A password reset code was sent to ${record.email}.`;
    },

    remove: async (id: string): Promise<void> => {
      const caller = requireSuperadmin();
      const record = find(id);
      if (record.id === caller.id) throw new Error("You cannot remove your own administrator account.");
      if (accounts.length <= 1) throw new Error("The last administrator account cannot be removed.");
      accounts.splice(accounts.indexOf(record), 1);
      audit("Deleted Administrator", record.username, record.id);
    },
  };
};
