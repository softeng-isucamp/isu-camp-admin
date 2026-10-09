/**
 * The rules a new password must meet. One list drives the live checklist, the
 * schema behind the submit check and the fixture backend, so they cannot drift.
 */
export interface PasswordRule {
  id: "length" | "uppercase" | "lowercase" | "number" | "symbol";
  /** Checklist wording. */
  label: string;
  /** Error wording when the rule fails. */
  message: string;
  test: (password: string) => boolean;
}

export const PASSWORD_MIN_LENGTH = 8;

export const passwordRules: readonly PasswordRule[] = [
  { id: "length", label: `At least ${PASSWORD_MIN_LENGTH} characters`, message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`, test: (p) => p.length >= PASSWORD_MIN_LENGTH },
  { id: "uppercase", label: "An uppercase letter", message: "Password must include an uppercase letter.", test: (p) => /\p{Lu}/u.test(p) },
  { id: "lowercase", label: "A lowercase letter", message: "Password must include a lowercase letter.", test: (p) => /\p{Ll}/u.test(p) },
  { id: "number", label: "A number", message: "Password must include a number.", test: (p) => /\d/.test(p) },
  { id: "symbol", label: "A symbol", message: "Password must include a symbol.", test: (p) => /[^\p{L}\p{N}\s]/u.test(p) },
];

/** The message for the first unmet rule, or undefined when the password passes. */
export const firstPasswordIssue = (password: string): string | undefined =>
  passwordRules.find((rule) => !rule.test(password))?.message;
