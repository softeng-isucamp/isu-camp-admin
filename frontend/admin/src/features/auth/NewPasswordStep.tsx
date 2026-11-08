import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { PasswordChecklist } from "../../components/PasswordChecklist";
import { Button } from "../../components/UI";
import { PasswordField } from "../../components/PasswordField";
import { AuthError, RateLimitError, services } from "../../services/api";
import { errorMessage } from "../../services/errors";
import { resetPasswordSchema } from "../../services/schemas";
import { useReturnToLogin } from "./loginPrefill";
import type { DeadCode } from "./RecoveryCodeStep";
import type { VerifiedRecovery } from "./RecoveryFlow";
import { AuthAlert, recoveryRateLimitMessage, tryAgainLabel } from "./AuthAlert";
import { BackToLogin, SuccessIcon } from "./RecoveryFrame";
import { useCountdown } from "./useCountdown";

/** The last step of `/forgot-password`: choose a new password, then see the success screen. */
export function NewPasswordStep({ verified, onCodeDied }: { verified: VerifiedRecovery; onCodeDied: (kind: DeadCode) => void }) {
  const returnToLogin = useReturnToLogin();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  // The field a client-side check rejected; editing either field clears the error.
  const [invalidField, setInvalidField] = useState<"password" | "confirmPassword" | null>(null);
  const alertId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const inFlight = useRef(false);
  const wait = useCountdown();
  const successHeading = useRef<HTMLHeadingElement>(null);

  // The success screen replaces the form, so move focus to its heading for screen reader users.
  useEffect(() => {
    if (username !== null) successHeading.current?.focus();
  }, [username]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || wait.seconds > 0) return;
    setError("");
    setInvalidField(null);
    const parsed = resetPasswordSchema.safeParse({ code: verified.code, password, confirmPassword });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue?.message ?? "Check your new password.");
      setInvalidField(issue?.path[0] === "confirmPassword" ? "confirmPassword" : "password");
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    try {
      const result = await services.auth.resetPassword(verified.email, verified.code, parsed.data.password);
      setUsername(result.username);
    } catch (err) {
      // The server has invalidated the code: the code step, in its dead state, is where a new one is requested.
      if (err instanceof AuthError && (err.kind === "code_exhausted" || err.kind === "code_expired")) {
        onCodeDied(err.kind === "code_exhausted" ? "exhausted" : "expired");
        return;
      }
      if (err instanceof RateLimitError) {
        setError(recoveryRateLimitMessage(err));
        if (err.retryAfterSeconds !== undefined) wait.start(err.retryAfterSeconds);
      } else {
        setError(errorMessage(err, "We couldn't reset your password. Please try again.", { mutation: true }));
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  if (username !== null) {
    return (
      <>
        <div className="recovery-success">
          <SuccessIcon />
          <h2 ref={successHeading} tabIndex={-1}>Password reset successful</h2>
          <p className="muted recovery-copy">
            Your password has been reset successfully. You can now sign in with your new password.
          </p>
        </div>
        <Button className="recovery-primary" onClick={() => returnToLogin(username)}>
          Continue to login
        </Button>
      </>
    );
  }

  const matchState = !confirmPassword ? "idle" : confirmPassword === password ? "match" : "mismatch";
  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    if (invalidField) {
      setInvalidField(null);
      setError("");
    }
  };
  const invalidProps = (field: "password" | "confirmPassword") =>
    invalidField === field ? { "aria-invalid": true, "aria-describedby": alertId } : {};

  return (
    <form onSubmit={submit} noValidate>
      <h2>Create a new password</h2>
      <p className="muted recovery-copy">
        Create a new password for your administrator account. If your verification code expires before you finish, you'll need to request a new one.
      </p>
      <PasswordField
        variant="recovery"
        label="New password"
        placeholder="Enter new password"
        autoComplete="new-password"
        capsLockWarning
        value={password}
        onChange={(event) => edit(setPassword)(event.target.value)}
        {...invalidProps("password")}
      />
      <PasswordChecklist password={password} />
      <PasswordField
        variant="recovery"
        label="Confirm new password"
        toggleName="confirm password"
        placeholder="Confirm new password"
        autoComplete="new-password"
        capsLockWarning
        value={confirmPassword}
        onChange={(event) => edit(setConfirmPassword)(event.target.value)}
        {...invalidProps("confirmPassword")}
      >
        <p className={`recovery-match recovery-match-${matchState}`} role="status">
          {matchState === "match" && "✓ Passwords match"}
          {matchState === "mismatch" && "✗ Passwords do not match"}
        </p>
      </PasswordField>
      {error && (
        <AuthAlert id={alertId} urgent={wait.seconds > 0}>
          {error}
        </AuthAlert>
      )}
      <Button type="submit" className="recovery-primary recovery-submit" loading={submitting} disabled={wait.seconds > 0}>
        {submitting ? "Resetting…" : wait.seconds > 0 ? tryAgainLabel(wait.seconds) : "Reset password"}
      </Button>
      <BackToLogin />
    </form>
  );
}
