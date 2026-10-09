import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError, RateLimitError } from "./errors";
import { createLocalAdapter } from "./localAdapter";

const USERNAME = "admin_justine";
const PASSWORD = "password123";

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
