import { describe, expect, it } from "vitest";
import { USERNAME_MAX_LENGTH, usernameIssue } from "./username";

describe("usernameIssue", () => {
  it.each(["", "   "])("requires a username, not %j", (value) => {
    expect(usernameIssue(value)).toBe("Username is required.");
  });

  it("accepts a username up to 255 characters, counted after trimming", () => {
    expect(USERNAME_MAX_LENGTH).toBe(255);
    expect(usernameIssue(`  ${"u".repeat(255)}  `)).toBeUndefined();
  });

  it("refuses 256 characters, counting an emoji once as the backend does", () => {
    expect(usernameIssue("u".repeat(256))).toBe("Username must be 255 characters or fewer.");
    expect(usernameIssue("😀".repeat(256))).toBe("Username must be 255 characters or fewer.");
    expect(usernameIssue("😀".repeat(255))).toBeUndefined();
  });

  it("does not add format rules the backend does not have", () => {
    expect(usernameIssue("a b")).toBeUndefined();
    expect(usernameIssue("ab")).toBeUndefined();
  });
});
