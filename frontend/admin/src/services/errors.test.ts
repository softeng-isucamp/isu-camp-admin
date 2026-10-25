import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AuthError,
  errorMessage,
  fieldError,
  InvalidResponseError,
  isTechnicalMessage,
  RateLimitError,
  RequestError,
} from "./errors";

const FALLBACK = "Dashboard information couldn't be loaded. Please try again.";
const UNKNOWN_OUTCOME = "The server didn't confirm the result, so your change may already be saved. Reload to check before trying again.";

describe("RequestError", () => {
  it.each([
    ["network", "Couldn't reach the ISU-CAMP server. Check your connection and try again."],
    ["outcome_unknown", "The connection was interrupted, so we couldn't confirm whether your change was saved. Reload to check before trying again."],
    ["session", "Your session has ended. Sign in again to continue."],
    ["permission", "You don't have permission to do that."],
    ["not_found", "That record no longer exists. Reload to see the latest information."],
    ["conflict", "This change conflicts with an existing record. Reload and try again."],
    ["server", "The server couldn't complete the request. Please try again."],
    ["invalid_response", "The server sent a response the admin portal couldn't read. Please try again."],
  ] as const)("says the default for %s", (kind, message) => {
    expect(new RequestError(kind).message).toBe(message);
  });

  it("keeps diagnostics out of the message", () => {
    const error = new RequestError("server", { status: 500, detail: "HTTP 500: boom", cause: new Error("boom") });
    expect(error).toMatchObject({ status: 500, detail: "HTTP 500: boom" });
    expect(error.message).not.toContain("boom");
    expect((error.cause as Error).message).toBe("boom");
  });

  it("makes InvalidResponseError a generic message with the specifics as detail", () => {
    const error = new InvalidResponseError("Backend returned a malformed user record.");
    expect(error).toBeInstanceOf(RequestError);
    expect(error.kind).toBe("invalid_response");
    expect(error.detail).toBe("Backend returned a malformed user record.");
    expect(error.message).not.toContain("Backend returned");
  });
});

describe("errorMessage", () => {
  it("replaces a server fault with the operation's own fallback", () => {
    expect(errorMessage(new RequestError("server", { detail: "HTTP 500: (psycopg2.errors)" }), FALLBACK)).toBe(FALLBACK);
  });

  it("treats an unreadable reply as a failure for a read and as an unknown outcome for a change", () => {
    const cause = new InvalidResponseError("Backend returned a malformed dashboard summary.");
    expect(errorMessage(cause, FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(cause, FALLBACK, { mutation: true })).toBe(UNKNOWN_OUTCOME);
  });

  it("passes the other request kinds through with their own message", () => {
    expect(errorMessage(new RequestError("network"), FALLBACK)).toBe("Couldn't reach the ISU-CAMP server. Check your connection and try again.");
    expect(errorMessage(new RequestError("session"), FALLBACK, { mutation: true })).toBe("Your session has ended. Sign in again to continue.");
  });

  it("hides a Zod dump", () => {
    const failure = z.object({ id: z.string() }).safeParse({ id: 4 });
    if (failure.success) throw new Error("Expected the parse to fail.");
    expect(failure.error.message).toContain("expected");
    expect(errorMessage(failure.error, FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(failure.error, FALLBACK, { mutation: true })).toBe(UNKNOWN_OUTCOME);
  });

  it.each([
    ["TypeError", new TypeError("Cannot read properties of undefined (reading 'id')")],
    ["SyntaxError", new SyntaxError("Unexpected token < in JSON at position 0")],
    ["RangeError", new RangeError("Invalid array length")],
  ])("hides a %s", (_name, cause) => {
    expect(errorMessage(cause, FALLBACK)).toBe(FALLBACK);
  });

  it("passes AuthError, RateLimitError and field errors through", () => {
    expect(errorMessage(new AuthError("invalid_credentials", "Invalid username or password"), FALLBACK)).toBe("Invalid username or password");
    expect(errorMessage(new RateLimitError(30), FALLBACK)).toBe("Too many requests. Try again shortly.");
    expect(errorMessage(fieldError("code", "Location code must be unique."), FALLBACK)).toBe("Location code must be unique.");
  });

  it("passes a plain Error with a message through", () => {
    expect(errorMessage(new Error("The last active administrator cannot be deactivated."), FALLBACK)).toBe("The last active administrator cannot be deactivated.");
  });

  it.each([
    ["a string", "boom"],
    ["null", null],
    ["undefined", undefined],
    ["an object", { message: "nope" }],
    ["an Error without a message", new Error("")],
    ["an Error with a blank message", new Error("   ")],
  ])("falls back for %s", (_name, cause) => {
    expect(errorMessage(cause, FALLBACK)).toBe(FALLBACK);
  });
});

describe("isTechnicalMessage", () => {
  it.each([
    "Request failed (500)",
    "Backend returned a malformed user record.",
    "Cannot delete Building \"7\". Invalid database ID.",
    "sequence_no must be a positive integer",
    "path_points is required",
    "latitude must be between -90 and 90",
    "pathway_id is required",
    "Request body is required",
    "Traceback (most recent call last):",
    "(psycopg2.errors.UniqueViolation) duplicate key",
    "sqlalchemy.exc.IntegrityError: boom",
    "pg_restore: error: could not execute query: relation \"building_photo\" already exists",
    "pg_dump: error: connection to server failed",
  ])("flags %s", (text) => {
    expect(isTechnicalMessage(text)).toBe(true);
  });

  it.each([
    "Invalid username or password",
    "Location code must be unique.",
    "Password must be at least 8 characters.",
    "Incorrect verification code",
    "Your current password is incorrect",
    "The last active superadmin cannot be demoted.",
    "That email address is already in use",
  ])("keeps %s", (text) => {
    expect(isTechnicalMessage(text)).toBe(false);
  });
});
