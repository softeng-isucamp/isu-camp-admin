/**
 * Service errors that callers narrow on with `instanceof`.
 *
 * They live outside `api.ts` so a test that mocks the service layer still
 * shares one class identity with the code under test.
 */

/** The backend code for a delete that needs the password confirmed again. */
export const PASSWORD_CONFIRMATION_REQUIRED = "password_confirmation_required";

/** A destructive request the backend refused until the password is confirmed. */
export class PasswordConfirmationRequiredError extends Error {
  constructor(message?: string) {
    super(message ?? "Confirm your password to delete this record.");
    this.name = "PasswordConfirmationRequiredError";
  }
}

/** The server asked the caller to wait; `retryAfterSeconds` drives the countdown. */
export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message?: string) {
    super(message ?? `Too many requests. Please wait ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Why an auth request failed, for pages to branch on instead of parsing text.
 * Rate limits are not a kind: they stay `RateLimitError`.
 */
export type AuthErrorKind = "invalid_credentials" | "invalid_code" | "code_exhausted" | "code_expired" | "weak_password";

/** A failed sign-in or recovery step, with the attempts the server says remain. */
export class AuthError extends Error {
  readonly kind: AuthErrorKind;
  /** Absent when the backend does not send a count; never guess one. */
  readonly attemptsRemaining?: number;

  constructor(kind: AuthErrorKind, message: string, attemptsRemaining?: number) {
    super(message);
    this.name = "AuthError";
    this.kind = kind;
    if (attemptsRemaining !== undefined) this.attemptsRemaining = attemptsRemaining;
  }
}
