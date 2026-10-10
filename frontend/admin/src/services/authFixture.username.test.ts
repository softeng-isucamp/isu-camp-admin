import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "./errors";
import { createLocalAdapter } from "./localAdapter";

const EMAIL = "admin@isu.edu.ph";
const TEST_CODE = "000000";
const USERNAME = "admin_justine";

describe("fixture username recovery", () => {
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

  it("returns the fixture admin's username for the test code", async () => {
    await adapter.auth.requestRecovery(EMAIL, "username");
    await expect(adapter.auth.verifyRecovery(EMAIL, "username", TEST_CODE)).resolves.toEqual({ username: USERNAME });
  });

  it("applies the same attempt counting and exhaustion as password recovery", async () => {
    await adapter.auth.requestRecovery(EMAIL, "username");
    for (const remaining of [4, 3, 2, 1]) {
      const error = await failure(adapter.auth.verifyRecovery(EMAIL, "username", "111111"));
      expect(error).toBeInstanceOf(AuthError);
      expect(error).toMatchObject({ kind: "invalid_code", attemptsRemaining: remaining });
    }
    expect(await failure(adapter.auth.verifyRecovery(EMAIL, "username", "111111"))).toMatchObject({ kind: "code_exhausted" });
    expect(await failure(adapter.auth.verifyRecovery(EMAIL, "username", TEST_CODE))).toMatchObject({ kind: "code_exhausted" });
  });

  it("expires the code after ten minutes", async () => {
    await adapter.auth.requestRecovery(EMAIL, "username");
    vi.setSystemTime(Date.now() + 601_000);
    expect(await failure(adapter.auth.verifyRecovery(EMAIL, "username", TEST_CODE))).toMatchObject({ kind: "code_expired" });
  });

  it("keeps a username code separate from a password code for the same email", async () => {
    await adapter.auth.requestRecovery(EMAIL, "password");
    expect(await failure(adapter.auth.verifyRecovery(EMAIL, "username", TEST_CODE))).toMatchObject({ kind: "invalid_code" });
    await expect(adapter.auth.verifyRecovery(EMAIL, "password", TEST_CODE)).resolves.toEqual({ username: USERNAME });
  });

  it("gives an unknown email the same invalid-code answer, revealing nothing", async () => {
    await adapter.auth.requestRecovery("nobody@example.com", "username");
    expect(await failure(adapter.auth.verifyRecovery("nobody@example.com", "username", TEST_CODE))).toMatchObject({ kind: "invalid_code", attemptsRemaining: 4 });
  });
});
