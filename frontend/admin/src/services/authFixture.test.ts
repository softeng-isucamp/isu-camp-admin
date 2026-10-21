import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError, RateLimitError } from "./errors";
import { createLocalAdapter } from "./localAdapter";

const USERNAME = "admin_justine";
const PASSWORD = "password123";

describe("fixture remembered sessions", () => {
  const SESSION_KEY = "isucamp_local_session";
  const setup = () => createLocalAdapter({ locations: [] }, sessionStorage);

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("does not restore an unchecked login after browser session storage is cleared", async () => {
    await setup().auth.login(USERNAME, PASSWORD, false);
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    sessionStorage.clear();
    expect(await setup().auth.me()).toBeNull();
  });

  it("restores a remembered login after browser session storage is cleared", async () => {
    await setup().auth.login(USERNAME, PASSWORD, true);
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    sessionStorage.clear();
    expect(await setup().auth.me()).toMatchObject({ username: USERNAME });
  });

  it("keeps remembered profile changes across a browser restart and subsequent edits", async () => {
    const first = setup();
    await first.auth.login(USERNAME, PASSWORD, true);
    await first.auth.updateProfile({ username: "renamed", email: "new@example.com", currentPassword: PASSWORD });
    sessionStorage.clear();
    const restored = setup();
    expect(await restored.auth.me()).toMatchObject({ username: "renamed", email: "new@example.com" });

    await restored.auth.updateProfile({ username: "renamed_again", email: "again@example.com", currentPassword: PASSWORD });
    sessionStorage.clear();
    expect(await setup().auth.me()).toMatchObject({ username: "renamed_again", email: "again@example.com" });
  });

  it("keeps unchecked profile edits transient", async () => {
    const adapter = setup();
    await adapter.auth.login(USERNAME, PASSWORD, false);
    await adapter.auth.updateProfile({ username: "renamed", email: "new@example.com", currentPassword: PASSWORD });
    expect(await setup().auth.me()).toMatchObject({ username: "renamed" });
    sessionStorage.clear();
    expect(await setup().auth.me()).toBeNull();
  });

  it("removes an older remembered login when the next login is unchecked", async () => {
    const adapter = setup();
    await adapter.auth.login(USERNAME, PASSWORD, true);
    await adapter.auth.login("admin_registrar", PASSWORD, false);
    expect(await setup().auth.me()).toMatchObject({ username: "admin_registrar" });
    sessionStorage.clear();
    expect(await setup().auth.me()).toBeNull();
  });

  it("clears a remembered session when logging out after restoration", async () => {
    await setup().auth.login(USERNAME, PASSWORD, true);
    sessionStorage.clear();
    await setup().auth.logout();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(await setup().auth.me()).toBeNull();
  });
});

const failedLogin = (adapter: ReturnType<typeof createLocalAdapter>) =>
  adapter.auth.login(USERNAME, "wrong").then(
    () => { throw new Error("expected the sign-in to fail"); },
    (error: unknown) => error,
  );

describe("fixture login attempts", () => {
  let adapter: ReturnType<typeof createLocalAdapter>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    adapter = createLocalAdapter({ locations: [] }, null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down the attempts left on each failure, then locks out on the fifth", async () => {
    for (const remaining of [4, 3, 2, 1]) {
      const error = await failedLogin(adapter);
      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({ kind: "invalid_credentials", attemptsRemaining: remaining });
    }

    const lockout = await failedLogin(adapter);
    expect(lockout).toBeInstanceOf(RateLimitError);
    expect(lockout).toMatchObject({ retryAfterSeconds: 60 });
  });

  it("counts an unknown username the same as a wrong password", async () => {
    const error = await adapter.auth.login("nobody", PASSWORD).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "invalid_credentials", attemptsRemaining: 4 });
  });

  it("rejects even the right password during the lockout, with the time left", async () => {
    for (let i = 0; i < 5; i += 1) await failedLogin(adapter);

    vi.advanceTimersByTime(20_000);
    const error = await adapter.auth.login(USERNAME, PASSWORD).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ retryAfterSeconds: 40 });
  });

  it("starts a fresh count once the lockout has passed", async () => {
    for (let i = 0; i < 5; i += 1) await failedLogin(adapter);

    vi.advanceTimersByTime(60_000);
    const error = await failedLogin(adapter);
    expect(error).toMatchObject({ kind: "invalid_credentials", attemptsRemaining: 4 });
  });

  it("resets the count after a successful sign-in", async () => {
    await failedLogin(adapter);
    await failedLogin(adapter);
    await adapter.auth.login(USERNAME, PASSWORD);

    const error = await failedLogin(adapter);
    expect(error).toMatchObject({ kind: "invalid_credentials", attemptsRemaining: 4 });
  });
});

describe("fixture account recovery", () => {
  const EMAIL = "admin@isu.edu.ph";
  const TEST_CODE = "000000";
  let adapter: ReturnType<typeof createLocalAdapter>;

  const failure = (promise: Promise<unknown>) =>
    promise.then(
      () => { throw new Error("expected the recovery step to fail"); },
      (error: unknown) => error,
    );

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    adapter = createLocalAdapter({ locations: [] }, null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports the expiry and resend cooldown on every request, known email or not", async () => {
    const timing = { expiresInSeconds: 600, resendAfterSeconds: 60 };
    await expect(adapter.auth.requestRecovery(EMAIL, "password")).resolves.toEqual(timing);
    await expect(adapter.auth.requestRecovery("nobody@example.com", "password")).resolves.toEqual(timing);
  });

  it("returns the username for the test code, matching the email without case or spacing", async () => {
    await adapter.auth.requestRecovery(EMAIL, "username");
    await expect(adapter.auth.verifyRecovery(" Admin@ISU.edu.ph ", "username", TEST_CODE)).resolves.toEqual({ username: USERNAME });
  });

  it("recovers the account through its alternative email, for either purpose", async () => {
    const ALTERNATIVE = "dean.backup@gmail.com";
    await adapter.auth.requestRecovery(ALTERNATIVE, "username");
    await expect(adapter.auth.verifyRecovery(" Dean.Backup@GMAIL.com ", "username", TEST_CODE)).resolves.toEqual({ username: "admin_dean" });

    await adapter.auth.requestRecovery(ALTERNATIVE, "password");
    await expect(adapter.auth.resetPassword(ALTERNATIVE, TEST_CODE, "NewPassw0rd!")).resolves.toEqual({ username: "admin_dean" });
    await expect(adapter.auth.login("admin_dean", "NewPassw0rd!")).resolves.toMatchObject({ username: "admin_dean" });
  });

  it("keeps a code requested for one address from verifying through the other", async () => {
    await adapter.auth.requestRecovery("dean.admin@isu.edu.ph", "password");

    expect(await failure(adapter.auth.verifyRecovery("dean.backup@gmail.com", "password", TEST_CODE))).toMatchObject({ kind: "invalid_code" });
    await expect(adapter.auth.verifyRecovery("dean.admin@isu.edu.ph", "password", TEST_CODE)).resolves.toEqual({ username: "admin_dean" });
  });

  it("follows an alternative email the account just set or cleared", async () => {
    await adapter.auth.login(USERNAME, PASSWORD);
    await adapter.auth.updateProfile({ username: USERNAME, email: EMAIL, alternativeEmail: "justine.home@gmail.com", currentPassword: PASSWORD });
    await adapter.auth.logout();
    await adapter.auth.requestRecovery("justine.home@gmail.com", "username");
    await expect(adapter.auth.verifyRecovery("justine.home@gmail.com", "username", TEST_CODE)).resolves.toEqual({ username: USERNAME });

    await adapter.auth.login(USERNAME, PASSWORD);
    await adapter.auth.updateProfile({ username: USERNAME, email: EMAIL, alternativeEmail: null, currentPassword: PASSWORD });
    await adapter.auth.logout();
    await adapter.auth.requestRecovery("justine.home@gmail.com", "username");
    expect(await failure(adapter.auth.verifyRecovery("justine.home@gmail.com", "username", TEST_CODE))).toMatchObject({ kind: "invalid_code" });
  });

  it("counts wrong codes down from five, then invalidates the code even for the right one", async () => {
    await adapter.auth.requestRecovery(EMAIL, "password");
    for (const remaining of [4, 3, 2, 1]) {
      const error = await failure(adapter.auth.verifyRecovery(EMAIL, "password", "111111"));
      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({ kind: "invalid_code", attemptsRemaining: remaining });
    }

    expect(await failure(adapter.auth.verifyRecovery(EMAIL, "password", "111111"))).toMatchObject({ kind: "code_exhausted", attemptsRemaining: 0 });
    expect(await failure(adapter.auth.verifyRecovery(EMAIL, "password", TEST_CODE))).toMatchObject({ kind: "code_exhausted" });
  });

  it("accepts a freshly requested code after the old one was exhausted", async () => {
    await adapter.auth.requestRecovery(EMAIL, "password");
    for (let i = 0; i < 5; i += 1) await failure(adapter.auth.verifyRecovery(EMAIL, "password", "111111"));

    await adapter.auth.requestRecovery(EMAIL, "password");
    const error = await failure(adapter.auth.verifyRecovery(EMAIL, "password", "111111"));
    expect(error).toMatchObject({ kind: "invalid_code", attemptsRemaining: 4 });
    await expect(adapter.auth.verifyRecovery(EMAIL, "password", TEST_CODE)).resolves.toEqual({ username: USERNAME });
  });

  it("expires the code after ten minutes", async () => {
    await adapter.auth.requestRecovery(EMAIL, "password");

    vi.advanceTimersByTime(599_000);
    await expect(adapter.auth.verifyRecovery(EMAIL, "password", TEST_CODE)).resolves.toEqual({ username: USERNAME });
    vi.advanceTimersByTime(1_000);
    expect(await failure(adapter.auth.verifyRecovery(EMAIL, "password", TEST_CODE))).toMatchObject({ kind: "code_expired" });
  });

  it("answers an unknown email like a known one: same timing, same counting, never the test code", async () => {
    await adapter.auth.requestRecovery("nobody@example.com", "password");

    expect(await failure(adapter.auth.verifyRecovery("nobody@example.com", "password", TEST_CODE)))
      .toMatchObject({ kind: "invalid_code", attemptsRemaining: 4 });
    expect(await failure(adapter.auth.verifyRecovery("nobody@example.com", "password", "111111")))
      .toMatchObject({ kind: "invalid_code", attemptsRemaining: 3 });
    for (let i = 0; i < 2; i += 1) await failure(adapter.auth.verifyRecovery("nobody@example.com", "password", "111111"));
    expect(await failure(adapter.auth.verifyRecovery("nobody@example.com", "password", "111111")))
      .toMatchObject({ kind: "code_exhausted", attemptsRemaining: 0 });
  });

  it("counts a guess for an email that never asked for a code the same way", async () => {
    const error = await failure(adapter.auth.verifyRecovery("nobody@example.com", "username", TEST_CODE));
    expect(error).toMatchObject({ kind: "invalid_code", attemptsRemaining: 4 });
  });

  it("does not verify or reset without a requested code, counting the guess like any unknown email", async () => {
    expect(await failure(adapter.auth.verifyRecovery(EMAIL, "password", TEST_CODE)))
      .toMatchObject({ kind: "invalid_code", attemptsRemaining: 4 });
    expect(await failure(adapter.auth.resetPassword(EMAIL, TEST_CODE, "NewPassw0rd!")))
      .toMatchObject({ kind: "invalid_code", attemptsRemaining: 3 });
    expect(await failure(adapter.auth.login(USERNAME, "NewPassw0rd!"))).toMatchObject({ kind: "invalid_credentials" });

    await adapter.auth.requestRecovery(EMAIL, "password");
    await expect(adapter.auth.verifyRecovery(EMAIL, "password", TEST_CODE)).resolves.toEqual({ username: USERNAME });
  });

  it("keeps a password code and a username code apart", async () => {
    await adapter.auth.requestRecovery(EMAIL, "password");
    await adapter.auth.requestRecovery(EMAIL, "username");
    await failure(adapter.auth.verifyRecovery(EMAIL, "password", "111111"));

    const error = await failure(adapter.auth.verifyRecovery(EMAIL, "username", "111111"));
    expect(error).toMatchObject({ attemptsRemaining: 4 });
  });

  it("resets the password with a verified code, rejecting weak passwords without spending the code", async () => {
    await adapter.auth.requestRecovery(EMAIL, "password");

    expect(await failure(adapter.auth.resetPassword(EMAIL, TEST_CODE, "short"))).toMatchObject({ kind: "weak_password" });
    await expect(adapter.auth.resetPassword(EMAIL, TEST_CODE, "NewPassw0rd!")).resolves.toEqual({ username: USERNAME });

    await expect(adapter.auth.login(USERNAME, "NewPassw0rd!")).resolves.toMatchObject({ username: USERNAME });
    expect(await failure(adapter.auth.resetPassword(EMAIL, TEST_CODE, "Another1!pass"))).toMatchObject({ kind: "invalid_code" });
  });

  it.each([
    ["Sh0rt!a", "at least 8 characters"],
    ["lowercase1!", "an uppercase letter"],
    ["UPPERCASE1!", "a lowercase letter"],
    ["NoNumbers!!", "a number"],
    ["NoSymbols123", "a symbol"],
    ["Ab1😀😀😀", "at least 8 characters"], // 6 code points, 9 UTF-16 units
  ])("rejects %s as weak_password without spending the code", async (weak, reason) => {
    await adapter.auth.requestRecovery(EMAIL, "password");

    const error = await failure(adapter.auth.resetPassword(EMAIL, TEST_CODE, weak));
    expect(error).toMatchObject({ kind: "weak_password" });
    expect((error as Error).message).toContain(reason);

    await expect(adapter.auth.resetPassword(EMAIL, TEST_CODE, "NewPassw0rd!")).resolves.toEqual({ username: USERNAME });
  });

  it("applies the same code rules when resetting the password", async () => {
    await adapter.auth.requestRecovery(EMAIL, "password");
    expect(await failure(adapter.auth.resetPassword(EMAIL, "111111", "NewPassw0rd!"))).toMatchObject({ kind: "invalid_code", attemptsRemaining: 4 });

    vi.advanceTimersByTime(600_000);
    expect(await failure(adapter.auth.resetPassword(EMAIL, TEST_CODE, "NewPassw0rd!"))).toMatchObject({ kind: "code_expired" });
  });
});

describe("fixture code lifetime", () => {
  const EMAIL = "admin@isu.edu.ph";
  const TEST_CODE = "000000";
  let adapter: ReturnType<typeof createLocalAdapter>;

  const failure = (promise: Promise<unknown>) =>
    promise.then(
      () => { throw new Error("expected the recovery step to fail"); },
      (error: unknown) => error,
    );

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    adapter = createLocalAdapter({ locations: [] }, null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps an expired code expired for wrong and right guesses alike, without counting attempts", async () => {
    await adapter.auth.requestRecovery(EMAIL, "password");
    vi.advanceTimersByTime(600_000);

    for (const code of ["111111", TEST_CODE, "111111"]) {
      expect(await failure(adapter.auth.verifyRecovery(EMAIL, "password", code))).toMatchObject({ kind: "code_expired" });
    }
  });

  it("starts a full ten minutes and five attempts again with each new request", async () => {
    await adapter.auth.requestRecovery(EMAIL, "password");
    vi.advanceTimersByTime(600_000);
    expect(await failure(adapter.auth.verifyRecovery(EMAIL, "password", TEST_CODE))).toMatchObject({ kind: "code_expired" });

    await adapter.auth.requestRecovery(EMAIL, "password");
    vi.advanceTimersByTime(599_000);
    expect(await failure(adapter.auth.verifyRecovery(EMAIL, "password", "111111"))).toMatchObject({ kind: "invalid_code", attemptsRemaining: 4 });
    await expect(adapter.auth.verifyRecovery(EMAIL, "password", TEST_CODE)).resolves.toMatchObject({ username: "admin_justine" });
  });

  it("restarts the lifetime of a code that was already exhausted", async () => {
    await adapter.auth.requestRecovery(EMAIL, "password");
    for (let i = 0; i < 5; i += 1) await failure(adapter.auth.verifyRecovery(EMAIL, "password", "111111"));
    vi.advanceTimersByTime(300_000);

    await adapter.auth.requestRecovery(EMAIL, "password");
    vi.advanceTimersByTime(599_000);
    await expect(adapter.auth.verifyRecovery(EMAIL, "password", TEST_CODE)).resolves.toMatchObject({ username: "admin_justine" });
  });

  it("refuses a password reset on an exhausted code even for the right code", async () => {
    await adapter.auth.requestRecovery(EMAIL, "password");
    for (let i = 0; i < 5; i += 1) await failure(adapter.auth.resetPassword(EMAIL, "111111", "NewPassw0rd!"));

    expect(await failure(adapter.auth.resetPassword(EMAIL, TEST_CODE, "NewPassw0rd!"))).toMatchObject({ kind: "code_exhausted" });
    await expect(adapter.auth.login("admin_justine", "NewPassw0rd!")).rejects.toBeInstanceOf(AuthError);
  });

  it("treats an unknown email's code the same way: it expires and is invalidated like a real one", async () => {
    await adapter.auth.requestRecovery("nobody@example.com", "password");
    for (let i = 0; i < 5; i += 1) await failure(adapter.auth.verifyRecovery("nobody@example.com", "password", "111111"));
    expect(await failure(adapter.auth.verifyRecovery("nobody@example.com", "password", "111111"))).toMatchObject({ kind: "code_exhausted" });

    await adapter.auth.requestRecovery("nobody@example.com", "username");
    vi.advanceTimersByTime(600_000);
    expect(await failure(adapter.auth.verifyRecovery("nobody@example.com", "username", "111111"))).toMatchObject({ kind: "code_expired" });
  });
});
