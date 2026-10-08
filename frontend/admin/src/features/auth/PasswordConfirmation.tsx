import { useCallback, useState } from "react";
import { Field } from "../../components/UI";
import { services } from "../../services/api";
import { PasswordConfirmationRequiredError } from "../../services/errors";

/**
 * Re-authentication in front of a destructive action. A delete only proceeds
 * once the signed-in admin has retyped their own password, so an unattended
 * session cannot be used to remove records.
 */
export function usePasswordConfirmation() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const reset = useCallback(() => {
    setPassword("");
    setError("");
    setConfirming(false);
  }, []);

  /** Resolves true when the password was accepted and the action may proceed. */
  const confirm = useCallback(async () => {
    if (!password) {
      setError("Enter your password to confirm this deletion.");
      return false;
    }
    setConfirming(true);
    setError("");
    try {
      await services.auth.confirmPassword(password);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Password is incorrect.");
      return false;
    } finally {
      setConfirming(false);
    }
  }, [password]);

  /**
   * Re-prompts when the backend refuses a delete whose confirmation has since
   * expired. Returns true when it handled the cause.
   */
  const handleRejection = useCallback((cause: unknown) => {
    if (!(cause instanceof PasswordConfirmationRequiredError)) return false;
    setPassword("");
    setError("Your password confirmation expired. Enter it again to delete this record.");
    return true;
  }, []);

  return { password, setPassword, error, setError, confirm, confirming, reset, handleRejection };
}

export type PasswordConfirmation = ReturnType<typeof usePasswordConfirmation>;

/** The password prompt shown inside a delete confirmation dialog. */
export function PasswordConfirmationField({
  confirmation,
  disabled = false,
  onSubmit,
}: {
  confirmation: PasswordConfirmation;
  disabled?: boolean;
  /** Invoked when Enter is pressed in the field, matching the dialog's confirm button. */
  onSubmit?: () => void;
}) {
  return (
    <div className="password-confirmation">
      <Field
        label="CONFIRM YOUR PASSWORD"
        aria-label="Confirm your password"
        type="password"
        autoComplete="current-password"
        placeholder="Enter your admin password"
        required
        subhelper="This permanent deletion needs your password."
        error={confirmation.error}
        value={confirmation.password}
        disabled={disabled || confirmation.confirming}
        onChange={(event) => {
          confirmation.setPassword(event.target.value);
          if (confirmation.error) confirmation.setError("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && onSubmit) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
    </div>
  );
}
