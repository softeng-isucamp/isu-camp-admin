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

/** Why a request failed in a way the caller can only describe generally. */
export type RequestFailureKind =
  | "network" // fetch rejected on a read (GET/HEAD): nothing reached us
  | "outcome_unknown" // fetch rejected on a write: the change may or may not have been applied
  | "session" // 401
  | "permission" // 403 without a more specific code
  | "not_found" // 404 with no usable message
  | "conflict" // 409 with no usable message
  | "server" // 5xx, or a technical backend message we refuse to show
  | "invalid_response"; // a reply we could not read or that failed validation

const REQUEST_FAILURE_MESSAGES: Record<RequestFailureKind, string> = {
  network: "Couldn't reach the ISU-CAMP server. Check your connection and try again.",
  outcome_unknown: "The connection was interrupted, so we couldn't confirm whether your change was saved. Reload to check before trying again.",
  session: "Your session has ended. Sign in again to continue.",
  permission: "You don't have permission to do that.",
  not_found: "That record no longer exists. Reload to see the latest information.",
  conflict: "This change conflicts with an existing record. Reload and try again.",
  server: "The server couldn't complete the request. Please try again.",
  invalid_response: "The server sent a response the admin portal couldn't read. Please try again.",
};

/** A request that failed without a message safe to show; the text is the kind's default. */
export class RequestError extends Error {
  readonly kind: RequestFailureKind;
  readonly status?: number;
  /** Developer diagnostics (status, backend message, parse issue). Never rendered. */
  readonly detail?: string;
  /** Set when the backend named the fields at fault, as with other form refusals. */
  declare fieldErrors?: Record<string, string>;

  constructor(kind: RequestFailureKind, options: { status?: number; detail?: string; cause?: unknown; message?: string } = {}) {
    super(options.message ?? REQUEST_FAILURE_MESSAGES[kind], options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "RequestError";
    this.kind = kind;
    if (options.status !== undefined) this.status = options.status;
    if (options.detail !== undefined) this.detail = options.detail;
  }
}

/** A reply that arrived but was not the shape the portal expects; `what` names it for developers. */
export class InvalidResponseError extends RequestError {
  constructor(what: string, detail?: string) {
    super("invalid_response", { detail: detail === undefined ? what : `${what} ${detail}` });
    this.name = "InvalidResponseError";
  }
}

const TECHNICAL_MESSAGE_PATTERNS: readonly RegExp[] = [
  /^Request failed \(\d+\)/,
  /Backend returned/i,
  /Invalid database ID/,
  /^Request body is required/,
  /^[a-z]+_[a-z_]+ (must|is required)/,
  /^(latitude|longitude|status|sequence_no|path_points|allowed_modes|\w+_id) (must|is|are)\b/,
  /Traceback/,
  /psycopg/i,
  /sqlalchemy/i,
  /\(psycopg2\./,
  /^pg_(dump|restore)\b/,
];

/** Developer-oriented text (status codes, validator field names, database errors) no administrator should read. */
export const isTechnicalMessage = (text: string) => TECHNICAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(text));

/** Logs the technical cause for developers; silent under test. Never pass request bodies or passwords. */
export const reportError = (cause: unknown) => {
  if (import.meta.env.MODE === "test") return;
  console.error(cause);
};

const UNKNOWN_OUTCOME_MESSAGE = "The server didn't confirm the result, so your change may already be saved. Reload to check before trying again.";

/**
 * The text to show an administrator for a failure. `fallback` names the operation in context
 * ("Dashboard information couldn't be loaded. Please try again."). With `mutation: true`, an
 * unreadable reply says the outcome is unknown instead of claiming failure.
 */
export function errorMessage(cause: unknown, fallback: string, options: { mutation?: boolean } = {}): string {
  if (cause instanceof RequestError) {
    if (cause.kind === "server") {
      reportError(cause);
      return fallback;
    }
    if (cause.kind === "invalid_response") {
      reportError(cause);
      return options.mutation ? UNKNOWN_OUTCOME_MESSAGE : fallback;
    }
    return cause.message;
  }
  const unreadable = (cause as { name?: unknown } | null)?.name === "ZodError"
    || cause instanceof TypeError || cause instanceof SyntaxError || cause instanceof RangeError;
  if (unreadable) {
    reportError(cause);
    return options.mutation ? UNKNOWN_OUTCOME_MESSAGE : fallback;
  }
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  reportError(cause);
  return fallback;
}

/** A permission refusal refreshes the session as well as reporting the failed action. */
export const PERMISSION_DENIED = "PERMISSION_DENIED";
export const PERMISSION_DENIED_EVENT = "isu-camp:permission-denied";
export class PermissionDeniedError extends Error {
  constructor(message?: string) {
    super(message ?? "You don't have permission to do that. Ask a superadmin.");
    this.name = "PermissionDeniedError";
  }
}
