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
