import { useCallback, useState } from "react";
import { Field } from "../../components/UI";
import { services } from "../../services/api";
import { PasswordConfirmationRequiredError } from "../../services/errors";

/** What the prompt says about the action it guards; each caller can supply its own. */
export type PasswordConfirmationWording = {
  /** Shown when Confirm is pressed with the field empty. */
  missing: string;
  /** Shown when the backend reports the confirmation has expired. */
  expired: string;
  /** The hint under the field. */
  hint: string;
};

/** The wording of a delete, which is what most callers guard. */
export const DELETE_CONFIRMATION_WORDING: PasswordConfirmationWording = {
  missing: "Enter your password to confirm this deletion.",
  expired: "Your password confirmation expired. Enter it again to delete this record.",
  hint: "This permanent deletion needs your password.",
};

/**
 * Re-authentication in front of a destructive or sensitive action. It only
 * proceeds once the signed-in admin has retyped their own password, so an
 * unattended session cannot be used to remove records or change who may
 * manage accounts. The wording defaults to a delete's; pass another for a
 * different action. It may change between renders, so one hook can serve
 * several dialogs.
 */
export function usePasswordConfirmation(wording: PasswordConfirmationWording = DELETE_CONFIRMATION_WORDING) {
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
      setError(wording.missing);
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
  }, [password, wording.missing]);

  /**
   * Re-prompts when the backend refuses an action whose confirmation has since
   * expired. Returns true when it handled the cause.
   */
  const handleRejection = useCallback((cause: unknown) => {
    if (!(cause instanceof PasswordConfirmationRequiredError)) return false;
    setPassword("");
    setError(wording.expired);
    return true;
  }, [wording.expired]);

  return { password, setPassword, error, setError, confirm, confirming, reset, handleRejection, wording };
}

export type PasswordConfirmation = ReturnType<typeof usePasswordConfirmation>;

/** The password prompt shown inside a confirmation dialog, worded by the hook it is given. */
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
        subhelper={confirmation.wording.hint}
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
