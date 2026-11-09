import { describe, expect, it } from "vitest";
import cases from "./passwordRuleCases.json";
import { firstPasswordIssue, passwordRules } from "./passwordRules";

// The backend's tests/password_rules.py checks its own rule list against this same table.
describe("password rules", () => {
  it.each(cases)("fails exactly the listed rules for $note $password", ({ password, fails }) => {
    expect(passwordRules.filter((rule) => !rule.test(password)).map((rule) => rule.id)).toEqual(fails);
  });

  it("lists the five rules in checklist order", () => {
    expect(passwordRules.map((rule) => rule.id)).toEqual(["length", "uppercase", "lowercase", "number", "symbol"]);
  });

  it.each([
    ["", "Password must be at least 8 characters."],
    ["abcdefgh", "Password must include an uppercase letter."],
    ["ABCDEFGH", "Password must include a lowercase letter."],
    ["Abcdefgh", "Password must include a number."],
    ["Abcdefg1", "Password must include a symbol."],
  ])("reports the first unmet rule for %j", (password, message) => {
    expect(firstPasswordIssue(password)).toBe(message);
  });

  it("refuses a password of spaces only with its own message, though the length rule counts the spaces", () => {
    expect(passwordRules[0].test("        ")).toBe(true);
    expect(firstPasswordIssue("        ")).toBe("Password can't be only spaces.");
    expect(firstPasswordIssue(" \t ")).toBe("Password can't be only spaces.");
  });

  it("does not treat a password that merely contains spaces as spaces only", () => {
    expect(firstPasswordIssue("Abc def1")).toBe("Password must include a symbol.");
  });

  it("reports nothing for a password that meets every rule", () => {
    expect(firstPasswordIssue("Abcdef1!")).toBeUndefined();
  });
});
