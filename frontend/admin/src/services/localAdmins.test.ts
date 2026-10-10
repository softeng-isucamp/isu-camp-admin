import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordConfirmationRequiredError, SuperadminRequiredError } from "./errors";
import { createLocalAdapter, type FixtureAccount } from "./localAdapter";
import { createLocalAdmins } from "./localAdmins";

const PASSWORD = "password123";

const setup = (storage: Storage | null = null) => {
  const adapter = createLocalAdapter({ locations: [] }, storage);
  const audit = vi.fn();
  return { adapter, audit, admins: createLocalAdmins(adapter.directory, audit) };
};

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => { throw new Error("expected the request to be refused"); },
    (error: unknown) => error,
  );

describe("fixture sign-ins", () => {
  it("signs in the plain administrator beside the demo superadmin", async () => {
    const { adapter } = setup();

    await expect(adapter.auth.login("admin_registrar", PASSWORD)).resolves.toMatchObject({
      username: "admin_registrar", role: "admin",
    });
    await expect(adapter.auth.me()).resolves.toMatchObject({ username: "admin_registrar", role: "admin" });

    await adapter.auth.logout();
    await expect(adapter.auth.login("admin_justine", PASSWORD)).resolves.toMatchObject({
      username: "admin_justine", role: "superadmin",
    });
    await expect(adapter.auth.me()).resolves.toMatchObject({ role: "superadmin" });
  });

  it("checks the password of the account being signed in to", async () => {
    const { adapter } = setup();
    const error = await failure(adapter.auth.login("admin_registrar", "wrong"));
    expect(error).toMatchObject({ kind: "invalid_credentials" });
  });

  it("keeps a plain administrator plain when the session is read back after a reload", async () => {
    sessionStorage.clear();
    await setup(sessionStorage).adapter.auth.login("admin_registrar", PASSWORD);

    const reloaded = setup(sessionStorage);
    await expect(reloaded.adapter.auth.me()).resolves.toMatchObject({ username: "admin_registrar", role: "admin" });
    expect((await reloaded.admins.list()).find((account) => account.isCurrent)?.username).toBe("admin_registrar");
  });

  it("lets a newly added administrator sign in with the password they were given", async () => {
    const { adapter, admins } = setup();
    await adapter.auth.login("admin_justine", PASSWORD);
    await admins.save({ username: "admin_new", email: "new@isu.edu.ph", password: "a-long-enough-secret" });
    await adapter.auth.logout();

    await expect(adapter.auth.login("admin_new", "a-long-enough-secret")).resolves.toMatchObject({ role: "admin" });
  });
});

describe("fixture administrator directory", () => {
  let fixture: ReturnType<typeof setup>;

  beforeEach(() => {
    fixture = setup();
  });

  it("carries both roles, passed through on every account", async () => {
    await fixture.adapter.auth.login("admin_justine", PASSWORD);
    const accounts = await fixture.admins.list();

    expect(new Set(accounts.map((account) => account.role))).toEqual(new Set(["admin", "superadmin"]));
    expect(accounts.find((account) => account.username === "admin_registrar")?.role).toBe("admin");
  });

  it("marks only the signed-in account as the current one, whoever signed in", async () => {
    await fixture.adapter.auth.login("admin_justine", PASSWORD);
    expect((await fixture.admins.list()).filter((account) => account.isCurrent).map((account) => account.username))
      .toEqual(["admin_justine"]);

    await fixture.adapter.auth.login("admin_registrar", PASSWORD);
    expect((await fixture.admins.list()).filter((account) => account.isCurrent).map((account) => account.username))
      .toEqual(["admin_registrar"]);
  });

  it("does not leak sign-in passwords into the list", async () => {
    await fixture.adapter.auth.login("admin_justine", PASSWORD);
    for (const account of await fixture.admins.list()) expect(account).not.toHaveProperty("password");
  });
});

describe("fixture refusals for a plain administrator", () => {
  let fixture: ReturnType<typeof setup>;

  beforeEach(async () => {
    fixture = setup();
    await fixture.adapter.auth.login("admin_registrar", PASSWORD);
  });

  it("refuses to add an administrator", async () => {
    const error = await failure(fixture.admins.save({ username: "admin_new", email: "new@isu.edu.ph", password: "a-long-enough-secret" }));
    expect(error).toBeInstanceOf(SuperadminRequiredError);
    expect(error).toMatchObject({ message: "Superadmin access required" });
    expect((await fixture.admins.list()).map((account) => account.username)).not.toContain("admin_new");
  });

  it("refuses a superadmin create with the superadmin refusal, never a password prompt", async () => {
    const error = await failure(fixture.admins.save({
      username: "admin_boss", email: "boss@isu.edu.ph", password: "a-long-enough-secret", role: "superadmin",
    }));
    expect(error).toBeInstanceOf(SuperadminRequiredError);
  });

  it("refuses a status change", async () => {
    const error = await failure(fixture.admins.setStatus("3", "Inactive"));
    expect(error).toBeInstanceOf(SuperadminRequiredError);
    expect((await fixture.admins.list()).find((account) => account.id === "3")?.status).toBe("Active");
  });

  it("refuses a removal", async () => {
    const error = await failure(fixture.admins.remove("3"));
    expect(error).toBeInstanceOf(SuperadminRequiredError);
    expect(await fixture.admins.list()).toHaveLength(3);
  });

  it("refuses a role change", async () => {
    const error = await failure(fixture.admins.setRole("3", "admin"));
    expect(error).toBeInstanceOf(SuperadminRequiredError);
    expect((await fixture.admins.list()).find((account) => account.id === "3")?.role).toBe("superadmin");
  });

  it("refuses before any rule about the row, as the server does", async () => {
    // A missing account, the caller's own account: the superadmin check comes first.
    expect(await failure(fixture.admins.setRole("missing", "superadmin"))).toBeInstanceOf(SuperadminRequiredError);
    expect(await failure(fixture.admins.setRole("2", "superadmin"))).toBeInstanceOf(SuperadminRequiredError);
    expect(await failure(fixture.admins.setStatus("missing", "Inactive"))).toBeInstanceOf(SuperadminRequiredError);
    expect(await failure(fixture.admins.setStatus("2", "Inactive"))).toBeInstanceOf(SuperadminRequiredError);
    expect(await failure(fixture.admins.remove("2"))).toBeInstanceOf(SuperadminRequiredError);
  });

  it("records nothing for a refused request", async () => {
    await failure(fixture.admins.remove("3"));
    expect(fixture.audit).not.toHaveBeenCalled();
  });

  it("still lists accounts and sends a reset code to any of them, a superadmin included", async () => {
    expect(await fixture.admins.list()).toHaveLength(3);
    await expect(fixture.admins.sendPasswordReset("1")).resolves.toBe("A password reset code was sent to admin@isu.edu.ph.");
  });
});

describe("fixture rules for a superadmin", () => {
  let fixture: ReturnType<typeof setup>;

  beforeEach(async () => {
    fixture = setup();
    await fixture.adapter.auth.login("admin_justine", PASSWORD);
  });

  it("adds a plain administrator", async () => {
    const created = await fixture.admins.save({ username: "admin_new", email: "new@isu.edu.ph", password: "a-long-enough-secret" });
    expect(created).toMatchObject({ username: "admin_new", role: "admin", status: "Active", isCurrent: false });
  });

  it("adds a superadmin only after the password was confirmed, and says so before the account exists", async () => {
    const draft = { username: "admin_boss", email: "boss@isu.edu.ph", password: "a-long-enough-secret", role: "superadmin" as const };

    const refusal = await failure(fixture.admins.save(draft));
    expect(refusal).toBeInstanceOf(PasswordConfirmationRequiredError);
    expect(refusal).toMatchObject({ message: "Confirm your password to create a superadmin." });
    expect((await fixture.admins.list()).map((account) => account.username)).not.toContain("admin_boss");

    await expect(fixture.adapter.auth.confirmPassword("wrong")).rejects.toThrow("Password is incorrect");
    expect(await failure(fixture.admins.save(draft))).toBeInstanceOf(PasswordConfirmationRequiredError);

    await fixture.adapter.auth.confirmPassword(PASSWORD);
    await expect(fixture.admins.save(draft)).resolves.toMatchObject({ username: "admin_boss", role: "superadmin", status: "Active" });
    expect((await fixture.admins.list()).find((account) => account.username === "admin_boss")?.role).toBe("superadmin");
  });

  it("needs no confirmation to add a plain administrator, whether the role is named or not", async () => {
    await expect(fixture.admins.save({ username: "a_one", email: "a1@isu.edu.ph", password: "a-long-enough-secret", role: "admin" }))
      .resolves.toMatchObject({ role: "admin" });
    await expect(fixture.admins.save({ username: "a_two", email: "a2@isu.edu.ph", password: "a-long-enough-secret" }))
      .resolves.toMatchObject({ role: "admin" });
  });

  it("forgets the confirmation when the account signs out", async () => {
    await fixture.adapter.auth.confirmPassword(PASSWORD);
    await fixture.adapter.auth.logout();
    await fixture.adapter.auth.login("admin_justine", PASSWORD);
    const error = await failure(fixture.admins.save({
      username: "admin_boss", email: "boss@isu.edu.ph", password: "a-long-enough-secret", role: "superadmin",
    }));
    expect(error).toBeInstanceOf(PasswordConfirmationRequiredError);
  });

  it("reports an unrecognized role against the role field, and a duplicate username before asking for the password", async () => {
    const base = { email: "x@isu.edu.ph", password: "a-long-enough-secret" };
    const badRole = await failure(fixture.admins.save({ ...base, username: "admin_x", role: "owner" as never }));
    expect(badRole).toMatchObject({ message: "Role must be Administrator or Superadmin.", fieldErrors: { role: "Role must be Administrator or Superadmin." } });

    // Not confirmed yet: the duplicate is still what is reported.
    const duplicate = await failure(fixture.admins.save({ ...base, username: "admin_registrar", role: "superadmin" }));
    expect(duplicate).not.toBeInstanceOf(PasswordConfirmationRequiredError);
    expect(duplicate).toMatchObject({ fieldErrors: { username: "That username is already taken" } });
  });

  it("deactivates, reactivates and removes another account", async () => {
    await expect(fixture.admins.setStatus("2", "Inactive")).resolves.toMatchObject({ status: "Inactive" });
    await expect(fixture.admins.setStatus("2", "Active")).resolves.toMatchObject({ status: "Active" });
    await fixture.adapter.auth.confirmPassword(PASSWORD);
    await fixture.admins.remove("2");
    expect((await fixture.admins.list()).map((account) => account.username)).not.toContain("admin_registrar");
  });

  it("treats another superadmin like any other account", async () => {
    await expect(fixture.admins.setStatus("3", "Inactive")).resolves.toMatchObject({ username: "admin_dean", status: "Inactive" });
    await fixture.adapter.auth.confirmPassword(PASSWORD);
    await fixture.admins.remove("3");
  });

  it("refuses to deactivate or remove the signed-in account, with the server's messages", async () => {
    await fixture.adapter.auth.confirmPassword(PASSWORD);
    expect(await failure(fixture.admins.setStatus("1", "Inactive"))).toMatchObject({
      message: "You cannot deactivate your own administrator account.",
    });
    expect(await failure(fixture.admins.remove("1"))).toMatchObject({
      message: "You cannot remove your own administrator account.",
    });
  });

  it("follows the signed-in account: the demo superadmin's row is no longer special for someone else", async () => {
    await fixture.adapter.auth.login("admin_dean", PASSWORD);
    await fixture.adapter.auth.confirmPassword(PASSWORD);
    await expect(fixture.admins.setStatus("1", "Inactive")).resolves.toMatchObject({ status: "Inactive" });
    expect(await failure(fixture.admins.remove("3"))).toMatchObject({
      message: "You cannot remove your own administrator account.",
    });
  });
});

describe("fixture role changes", () => {
  let fixture: ReturnType<typeof setup>;

  beforeEach(async () => {
    fixture = setup();
    await fixture.adapter.auth.login("admin_justine", PASSWORD);
    await fixture.adapter.auth.confirmPassword(PASSWORD);
  });

  it("promotes an administrator and demotes a superadmin, returning the updated account", async () => {
    await expect(fixture.admins.setRole("2", "superadmin")).resolves.toMatchObject({
      username: "admin_registrar", role: "superadmin", isCurrent: false,
    });
    expect((await fixture.admins.list()).find((account) => account.id === "2")?.role).toBe("superadmin");

    await expect(fixture.admins.setRole("3", "admin")).resolves.toMatchObject({ username: "admin_dean", role: "admin" });
    expect((await fixture.admins.list()).find((account) => account.id === "3")?.role).toBe("admin");
  });

  it("is what the promoted account's next sign-in and session read report", async () => {
    await fixture.admins.setRole("2", "superadmin");
    await fixture.adapter.auth.logout();

    await expect(fixture.adapter.auth.login("admin_registrar", PASSWORD)).resolves.toMatchObject({ role: "superadmin" });
    await expect(fixture.adapter.auth.me()).resolves.toMatchObject({ role: "superadmin" });
  });

  it("takes effect on the demoted account's very next request", async () => {
    await fixture.admins.setRole("3", "admin");
    await fixture.adapter.auth.login("admin_dean", PASSWORD);

    expect(await failure(fixture.admins.setStatus("2", "Inactive"))).toBeInstanceOf(SuperadminRequiredError);
  });

  it("records a promotion and a demotion against the account", async () => {
    await fixture.admins.setRole("2", "superadmin");
    await fixture.admins.setRole("3", "admin");

    expect(fixture.audit).toHaveBeenNthCalledWith(1, "Promoted Administrator", "admin_registrar", "2");
    expect(fixture.audit).toHaveBeenNthCalledWith(2, "Demoted Administrator", "admin_dean", "3");
  });

  it("refuses to change the signed-in account's own role, even to the role it holds", async () => {
    expect(await failure(fixture.admins.setRole("1", "admin"))).toMatchObject({ message: "You cannot change your own role." });
    expect(await failure(fixture.admins.setRole("1", "superadmin"))).toMatchObject({ message: "You cannot change your own role." });
    expect((await fixture.admins.list()).find((account) => account.id === "1")?.role).toBe("superadmin");
  });

  it("succeeds without a write or an audit entry when the account already holds the role", async () => {
    await expect(fixture.admins.setRole("2", "admin")).resolves.toMatchObject({ role: "admin" });
    await expect(fixture.admins.setRole("3", "superadmin")).resolves.toMatchObject({ role: "superadmin" });
    expect(fixture.audit).not.toHaveBeenCalled();
  });

  it("reports an unknown account and an unknown role", async () => {
    expect(await failure(fixture.admins.setRole("missing", "admin"))).toMatchObject({ message: "Administrator not found." });
    const error = await failure(fixture.admins.setRole("2", "owner" as never));
    expect(error).toMatchObject({
      message: "Role must be Administrator or Superadmin.",
      fieldErrors: { role: "Role must be Administrator or Superadmin." },
    });
  });
});

describe("fixture last-superadmin rule", () => {
  const LAST_SUPERADMIN = "At least one active superadmin is required. Promote another account first.";
  let fixture: ReturnType<typeof setup>;

  // A signed-in caller can never be the one left, so these rules are reached the way the backend
  // tests reach them: with a superadmin caller who is not one of the directory's accounts.
  beforeEach(async () => {
    const adapter = createLocalAdapter({ locations: [] }, null);
    const audit = vi.fn();
    const outsider: FixtureAccount = {
      id: "99", username: "admin_outsider", email: "outsider@isu.edu.ph", role: "superadmin", status: "Active", password: PASSWORD,
    };
    const admins = createLocalAdmins({ ...adapter.directory, caller: () => outsider }, audit);
    fixture = { adapter, audit, admins };
    // Only dean (3) is left of the directory's superadmins.
    adapter.directory.accounts.find((account) => account.id === "1")!.role = "admin";
    await adapter.auth.login("admin_justine", PASSWORD);
    await adapter.auth.confirmPassword(PASSWORD);
  });

  it("refuses to demote, deactivate or remove the only active superadmin", async () => {
    expect(await failure(fixture.admins.setRole("3", "admin"))).toMatchObject({ message: LAST_SUPERADMIN });
    expect(await failure(fixture.admins.setStatus("3", "Inactive"))).toMatchObject({ message: LAST_SUPERADMIN });
    expect(await failure(fixture.admins.remove("3"))).toMatchObject({ message: LAST_SUPERADMIN });

    const dean = (await fixture.admins.list()).find((account) => account.id === "3");
    expect(dean).toMatchObject({ role: "superadmin", status: "Active" });
    expect(fixture.audit).not.toHaveBeenCalled();
  });

  it("lets it through once another active superadmin exists", async () => {
    await fixture.admins.setRole("2", "superadmin");

    await expect(fixture.admins.setRole("3", "admin")).resolves.toMatchObject({ role: "admin" });
  });

  it("does not count a deactivated superadmin, nor refuse changing one", async () => {
    // Justine is the only active superadmin again: demoting the deactivated dean leaves her in place.
    const { accounts } = fixture.adapter.directory;
    accounts.find((account) => account.id === "1")!.role = "superadmin";
    accounts.find((account) => account.id === "3")!.status = "Inactive";

    await expect(fixture.admins.setRole("3", "admin")).resolves.toMatchObject({ role: "admin" });
  });
});

describe("fixture password confirmation for role changes and removal", () => {
  let fixture: ReturnType<typeof setup>;

  beforeEach(async () => {
    fixture = setup();
    await fixture.adapter.auth.login("admin_justine", PASSWORD);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for the password before a role change, in the role change's own words", async () => {
    const refusal = await failure(fixture.admins.setRole("2", "superadmin"));
    expect(refusal).toBeInstanceOf(PasswordConfirmationRequiredError);
    expect(refusal).toMatchObject({ message: "Confirm your password to change this administrator's role." });
    expect((await fixture.admins.list()).find((account) => account.id === "2")?.role).toBe("admin");
    expect(fixture.audit).not.toHaveBeenCalled();

    await fixture.adapter.auth.confirmPassword(PASSWORD);
    await expect(fixture.admins.setRole("2", "superadmin")).resolves.toMatchObject({ role: "superadmin" });
  });

  it("asks for the password before a removal, in the delete wording", async () => {
    const refusal = await failure(fixture.admins.remove("2"));
    expect(refusal).toBeInstanceOf(PasswordConfirmationRequiredError);
    expect(refusal).toMatchObject({ message: "Confirm your password to delete this record." });
    expect((await fixture.admins.list()).map((account) => account.id)).toContain("2");
    expect(fixture.audit).not.toHaveBeenCalled();

    await fixture.adapter.auth.confirmPassword(PASSWORD);
    await expect(fixture.admins.remove("2")).resolves.toBeUndefined();
  });

  it("asks before it looks at the account, the role or who is asking", async () => {
    expect(await failure(fixture.admins.setRole("missing", "admin"))).toBeInstanceOf(PasswordConfirmationRequiredError);
    expect(await failure(fixture.admins.setRole("2", "owner" as never))).toBeInstanceOf(PasswordConfirmationRequiredError);
    expect(await failure(fixture.admins.setRole("1", "admin"))).toBeInstanceOf(PasswordConfirmationRequiredError);
    expect(await failure(fixture.admins.setRole("2", "admin"))).toBeInstanceOf(PasswordConfirmationRequiredError);
    expect(await failure(fixture.admins.remove("missing"))).toBeInstanceOf(PasswordConfirmationRequiredError);
    expect(await failure(fixture.admins.remove("1"))).toBeInstanceOf(PasswordConfirmationRequiredError);
  });

  it("refuses a plain administrator outright, never with a password prompt", async () => {
    await fixture.adapter.auth.login("admin_registrar", PASSWORD);

    expect(await failure(fixture.admins.setRole("3", "admin"))).toBeInstanceOf(SuperadminRequiredError);
    expect(await failure(fixture.admins.remove("3"))).toBeInstanceOf(SuperadminRequiredError);
  });

  it("asks again once the five minutes are over", async () => {
    vi.useFakeTimers();
    await fixture.adapter.auth.confirmPassword(PASSWORD);
    await expect(fixture.admins.setRole("2", "superadmin")).resolves.toMatchObject({ role: "superadmin" });

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    expect(await failure(fixture.admins.setRole("2", "admin"))).toBeInstanceOf(PasswordConfirmationRequiredError);
    expect(await failure(fixture.admins.remove("2"))).toBeInstanceOf(PasswordConfirmationRequiredError);
  });

  it("does not ask for a status change, as the server does not", async () => {
    await expect(fixture.admins.setStatus("2", "Inactive")).resolves.toMatchObject({ status: "Inactive" });
  });

  it("forgets an earlier confirmation when a later one has the wrong password", async () => {
    await fixture.adapter.auth.confirmPassword(PASSWORD);
    await expect(fixture.adapter.auth.confirmPassword("wrong")).rejects.toThrow("Password is incorrect");

    expect(await failure(fixture.admins.setRole("2", "superadmin"))).toBeInstanceOf(PasswordConfirmationRequiredError);
    expect(await failure(fixture.admins.remove("2"))).toBeInstanceOf(PasswordConfirmationRequiredError);
    expect(await failure(fixture.admins.save({
      username: "admin_boss", email: "boss@isu.edu.ph", password: "a-long-enough-secret", role: "superadmin",
    }))).toBeInstanceOf(PasswordConfirmationRequiredError);
  });
});

describe("fixture deactivated accounts", () => {
  const DEACTIVATED = "This administrator account has been deactivated.";
  let fixture: ReturnType<typeof setup>;

  beforeEach(async () => {
    fixture = setup();
    await fixture.adapter.auth.login("admin_justine", PASSWORD);
    await fixture.adapter.auth.confirmPassword(PASSWORD);
  });

  it("refuses to sign in a deactivated account, once its password is right", async () => {
    await fixture.admins.setStatus("3", "Inactive");
    await fixture.adapter.auth.logout();

    expect(await failure(fixture.adapter.auth.login("admin_dean", PASSWORD))).toMatchObject({
      message: `${DEACTIVATED} Ask another administrator to reactivate it.`,
    });
    // A wrong password still looks like any other wrong password.
    expect(await failure(fixture.adapter.auth.login("admin_dean", "wrong"))).toMatchObject({ kind: "invalid_credentials" });
    await expect(fixture.adapter.auth.me()).resolves.toBeNull();
  });

  it("signs in again once the account is reactivated", async () => {
    await fixture.admins.setStatus("3", "Inactive");
    await fixture.admins.setStatus("3", "Active");
    await fixture.adapter.auth.logout();

    await expect(fixture.adapter.auth.login("admin_dean", PASSWORD)).resolves.toMatchObject({ username: "admin_dean" });
  });

  it("refuses every administrator request from an account deactivated while signed in, and signs it out", async () => {
    const draft = { username: "admin_new", email: "new@isu.edu.ph", password: "a-long-enough-secret" };
    const requests: Array<[string, () => Promise<unknown>]> = [
      ["list", () => fixture.admins.list()],
      ["add", () => fixture.admins.save(draft)],
      ["status", () => fixture.admins.setStatus("2", "Inactive")],
      ["role", () => fixture.admins.setRole("2", "superadmin")],
      ["reset code", () => fixture.admins.sendPasswordReset("2")],
      ["remove", () => fixture.admins.remove("2")],
    ];
    for (const [name, request] of requests) {
      await fixture.adapter.auth.login("admin_justine", PASSWORD);
      await fixture.adapter.auth.confirmPassword(PASSWORD);
      fixture.adapter.directory.accounts.find((account) => account.id === "1")!.status = "Inactive";

      expect(await failure(request()), name).toMatchObject({ message: DEACTIVATED });
      await expect(fixture.adapter.auth.me(), name).resolves.toBeNull();

      fixture.adapter.directory.accounts.find((account) => account.id === "1")!.status = "Active";
    }
    expect((await (async () => { await fixture.adapter.auth.login("admin_justine", PASSWORD); return fixture.admins.list(); })()).length).toBe(3);
    expect(fixture.audit).not.toHaveBeenCalled();
  });

  it("signs a deactivated account out when its session is read, and refuses a password confirmation", async () => {
    fixture.adapter.directory.accounts.find((account) => account.id === "1")!.status = "Inactive";

    expect(await failure(fixture.adapter.auth.confirmPassword(PASSWORD))).toMatchObject({ message: DEACTIVATED });
    await expect(fixture.adapter.auth.me()).resolves.toBeNull();
  });
});

describe("fixture validation of a new or edited account", () => {
  let fixture: ReturnType<typeof setup>;
  const valid = { username: "admin_new", email: "new@isu.edu.ph", password: "a-long-enough-secret" };

  beforeEach(async () => {
    fixture = setup();
    await fixture.adapter.auth.login("admin_justine", PASSWORD);
  });

  it.each([
    ["an empty username", { username: "  " }, "username", "Username is required"],
    ["a username over 255 characters", { username: "u".repeat(256) }, "username", "Username must be 255 characters or fewer"],
    ["an empty email", { email: " " }, "email", "Email is required"],
    ["an invalid email", { email: "not-an-email" }, "email", "Enter a valid email address"],
    ["a short password", { password: "short" }, "password", "Password must be at least 8 characters"],
    ["no password", { password: undefined }, "password", "Password must be at least 8 characters"],
  ])("refuses %s with the server's message against its field", async (_name, change, field, message) => {
    const error = await failure(fixture.admins.save({ ...valid, ...change }));

    expect(error).toMatchObject({ message, fieldErrors: { [field]: message } });
    expect((await fixture.admins.list()).map((account) => account.username)).not.toContain("admin_new");
    expect(fixture.audit).not.toHaveBeenCalled();
  });

  it("reports the first problem in the server's order: username, email, password", async () => {
    expect(await failure(fixture.admins.save({ username: "", email: "bad", password: "x" })))
      .toMatchObject({ fieldErrors: { username: "Username is required" } });
    expect(await failure(fixture.admins.save({ username: "u", email: "bad", password: "x" })))
      .toMatchObject({ fieldErrors: { email: "Enter a valid email address" } });
    expect(await failure(fixture.admins.save({ username: "u", email: "u@isu.edu.ph", password: "x" })))
      .toMatchObject({ fieldErrors: { password: "Password must be at least 8 characters" } });
  });

  it("reports an invalid identity before an unrecognized role, a duplicate or the password prompt", async () => {
    const invalid = { username: "admin_registrar", email: "bad", password: "a-long-enough-secret" };

    expect(await failure(fixture.admins.save({ ...invalid, role: "owner" as never })))
      .toMatchObject({ fieldErrors: { email: "Enter a valid email address" } });
    expect(await failure(fixture.admins.save({ ...invalid, role: "superadmin" })))
      .toMatchObject({ fieldErrors: { email: "Enter a valid email address" } });
  });

  it("refuses an invalid identity from a plain administrator with the superadmin refusal first", async () => {
    await fixture.adapter.auth.login("admin_registrar", PASSWORD);

    expect(await failure(fixture.admins.save({ username: "", email: "", password: "" }))).toBeInstanceOf(SuperadminRequiredError);
  });

  it("validates an edit of one's own account, where the password may stay blank", async () => {
    await expect(fixture.admins.save({ id: "1", username: "admin_justine", email: "j@isu.edu.ph" }))
      .resolves.toMatchObject({ email: "j@isu.edu.ph" });
    expect(await failure(fixture.admins.save({ id: "1", username: "admin_justine", email: "j@isu.edu.ph", password: "short" })))
      .toMatchObject({ fieldErrors: { password: "Password must be at least 8 characters" } });
    expect(await failure(fixture.admins.save({ id: "1", username: "", email: "j@isu.edu.ph" })))
      .toMatchObject({ fieldErrors: { username: "Username is required" } });
  });

  it("reports an unknown account and someone else's account before looking at the details", async () => {
    expect(await failure(fixture.admins.save({ id: "missing", username: "", email: "" }))).toMatchObject({ message: "Administrator not found." });
    expect(await failure(fixture.admins.save({ id: "2", username: "", email: "" })))
      .toMatchObject({ message: "You can only edit your own administrator account." });
  });
});

describe("fixture session restore", () => {
  beforeEach(() => sessionStorage.clear());

  it("signs out a restored session whose account the fresh fixture does not have", async () => {
    const first = setup(sessionStorage);
    await first.adapter.auth.login("admin_justine", PASSWORD);
    await first.admins.save({ username: "admin_new", email: "new@isu.edu.ph", password: "a-long-enough-secret" });
    await first.adapter.auth.logout();
    await first.adapter.auth.login("admin_new", "a-long-enough-secret");

    // A reload starts from the seed accounts, which do not include the new one.
    const reloaded = setup(sessionStorage);

    await expect(reloaded.adapter.auth.me()).resolves.toBeNull();
    expect(await failure(reloaded.admins.list())).toMatchObject({ message: "Authentication required" });
    expect(sessionStorage.getItem("isucamp_local_session")).toBeNull();
  });

  it("does not hand an unknown account's name to the first seed account", async () => {
    sessionStorage.setItem("isucamp_local_session", JSON.stringify({ id: "admin-123", username: "ghost", email: "ghost@isu.edu.ph", role: "admin" }));

    const { adapter } = setup(sessionStorage);

    expect(adapter.directory.accounts[0]).toMatchObject({ username: "admin_justine", email: "admin@isu.edu.ph" });
    await expect(adapter.auth.me()).resolves.toBeNull();
  });
});

describe("fixture edits of one's own account", () => {
  it("applies a new password supplied with the edit, as the server does", async () => {
    const { adapter, admins } = setup();
    await adapter.auth.login("admin_justine", PASSWORD);

    await admins.save({ id: "1", username: "admin_justine", email: "admin@isu.edu.ph", password: "newPassword456" });
    await adapter.auth.logout();

    await expect(adapter.auth.login("admin_justine", "newPassword456")).resolves.toMatchObject({ id: "1" });
  });

  it("stops the old password from working once it is replaced", async () => {
    const { adapter, admins } = setup();
    await adapter.auth.login("admin_justine", PASSWORD);
    await admins.save({ id: "1", username: "admin_justine", email: "admin@isu.edu.ph", password: "newPassword456" });
    await adapter.auth.logout();

    expect(await failure(adapter.auth.login("admin_justine", PASSWORD))).toMatchObject({ kind: "invalid_credentials" });
  });

  it("leaves the password alone when none is supplied", async () => {
    const { adapter, admins } = setup();
    await adapter.auth.login("admin_justine", PASSWORD);

    await admins.save({ id: "1", username: "admin_justine", email: "j@isu.edu.ph" });
    await adapter.auth.logout();

    await expect(adapter.auth.login("admin_justine", PASSWORD)).resolves.toMatchObject({ id: "1" });
  });
});

describe("fixture profile update", () => {
  it.each(["admin_justine", "ADMIN_JUSTINE"])("refuses the username %s, which another administrator holds", async (username) => {
    const { adapter } = setup();
    await adapter.auth.login("admin_registrar", PASSWORD);

    const error = await failure(adapter.auth.updateProfile({ username, email: "registrar.admin@isu.edu.ph" }));

    expect(error).toMatchObject({
      message: "That username is already taken",
      fieldErrors: { username: "That username is already taken" },
    });
    await expect(adapter.auth.me()).resolves.toMatchObject({ username: "admin_registrar" });
  });

  it("lets an administrator keep or recase their own username", async () => {
    const { adapter } = setup();
    await adapter.auth.login("admin_registrar", PASSWORD);

    await expect(adapter.auth.updateProfile({ username: "admin_registrar", email: "r@isu.edu.ph" }))
      .resolves.toMatchObject({ email: "r@isu.edu.ph" });
    await expect(adapter.auth.updateProfile({ username: "Admin_Registrar", email: "r@isu.edu.ph" }))
      .resolves.toMatchObject({ username: "Admin_Registrar" });
  });
});
