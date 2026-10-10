import { beforeEach, describe, expect, it, vi } from "vitest";
import { SuperadminRequiredError } from "./errors";
import { createLocalAdapter } from "./localAdapter";
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

  it("refuses before any rule about the row, as the server does", async () => {
    // A missing account, the caller's own account: the superadmin check comes first.
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

  it("deactivates, reactivates and removes another account", async () => {
    await expect(fixture.admins.setStatus("2", "Inactive")).resolves.toMatchObject({ status: "Inactive" });
    await expect(fixture.admins.setStatus("2", "Active")).resolves.toMatchObject({ status: "Active" });
    await fixture.admins.remove("2");
    expect((await fixture.admins.list()).map((account) => account.username)).not.toContain("admin_registrar");
  });

  it("treats another superadmin like any other account", async () => {
    await expect(fixture.admins.setStatus("3", "Inactive")).resolves.toMatchObject({ username: "admin_dean", status: "Inactive" });
    await fixture.admins.remove("3");
  });

  it("refuses to deactivate or remove the signed-in account, with the server's messages", async () => {
    expect(await failure(fixture.admins.setStatus("1", "Inactive"))).toMatchObject({
      message: "You cannot deactivate your own administrator account.",
    });
    expect(await failure(fixture.admins.remove("1"))).toMatchObject({
      message: "You cannot remove your own administrator account.",
    });
  });

  it("follows the signed-in account: the demo superadmin's row is no longer special for someone else", async () => {
    await fixture.adapter.auth.login("admin_dean", PASSWORD);
    await expect(fixture.admins.setStatus("1", "Inactive")).resolves.toMatchObject({ status: "Inactive" });
    expect(await failure(fixture.admins.remove("3"))).toMatchObject({
      message: "You cannot remove your own administrator account.",
    });
  });
});
