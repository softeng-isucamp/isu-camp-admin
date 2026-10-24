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

/** The backend code for an administrator-account action only a superadmin may take. */
export const SUPERADMIN_REQUIRED = "superadmin_required";

/** An administrator-account action the server refused because the signed-in account is not a superadmin. */
export class SuperadminRequiredError extends Error {
  constructor(message?: string) {
    super(message ?? "Superadmin access required");
    this.name = "SuperadminRequiredError";
  }
}

/**
 * The server asked the caller to wait; `retryAfterSeconds` drives the countdown, so the default message names no number.
 * It is absent when the server sent no valid `Retry-After`: callers must not invent a wait.
 */
export class RateLimitError extends Error {
  readonly retryAfterSeconds?: number;
  /** The server sent `code: "recovery_restricted"`: recovery as a whole is locked, not just this one request. */
  readonly restricted: boolean;

  constructor(retryAfterSeconds?: number, message?: string, restricted = false) {
    super(message ?? "Too many requests. Try again shortly.");
    this.name = "RateLimitError";
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
    this.restricted = restricted;
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

/** A refusal that names the form field it is about, as the backend's `fields` do. */
export const fieldError = (field: string, message: string) =>
  Object.assign(new Error(message), { fieldErrors: { [field]: message } });

/** Several refusals at once, one per field; the message is the first so a plain handler still reads something. */
export const fieldErrorsOf = (fieldErrors: Record<string, string>) =>
  Object.assign(new Error(Object.values(fieldErrors)[0]), { fieldErrors });

/** A permission refusal refreshes the session as well as reporting the failed action. */
export const PERMISSION_DENIED = "PERMISSION_DENIED";
export const PERMISSION_DENIED_EVENT = "isu-camp:permission-denied";
export class PermissionDeniedError extends Error {
  constructor(message?: string) {
    super(message ?? "You don't have permission to do that. Ask a superadmin.");
    this.name = "PermissionDeniedError";
  }
}
