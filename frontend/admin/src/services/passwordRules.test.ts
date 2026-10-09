import { describe, expect, it } from "vitest";
import { firstPasswordIssue, passwordRules } from "./passwordRules";

const lengthRule = passwordRules.find((rule) => rule.id === "length")!;

describe("password length rule", () => {
  it("counts each emoji as one character, not two UTF-16 code units", () => {
    // "Ab1" plus three emoji is 6 characters, so it is short even though it has 9 UTF-16 units.
    expect(lengthRule.test("Ab1😀😀😀")).toBe(false);
    expect(firstPasswordIssue("Ab1😀😀😀")).toBe("Password must be at least 8 characters.");

    // "Ab1" plus five emoji is 8 characters and meets the minimum.
    expect(lengthRule.test("Ab1😀😀😀😀😀")).toBe(true);
  });
});
