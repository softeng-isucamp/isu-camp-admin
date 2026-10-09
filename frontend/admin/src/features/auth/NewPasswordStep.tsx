import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button } from "../../components/UI";
import { AuthError, RateLimitError, services } from "../../services/api";
import { passwordRules } from "../../services/passwordRules";
import { resetPasswordSchema } from "../../services/schemas";
import { CapsLockWarning, useCapsLock } from "./capsLock";
import { useReturnToLogin } from "./loginPrefill";
import type { DeadCode } from "./RecoveryCodeStep";
import type { VerifiedRecovery } from "./RecoveryFlow";
import { AuthAlert, RATE_LIMIT_MESSAGE, tryAgainLabel } from "./AuthAlert";
import { PasswordVisibilityIcon } from "./PasswordVisibilityIcon";
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
        setError(RATE_LIMIT_MESSAGE);
        wait.start(err.retryAfterSeconds);
      } else {
        setError(err instanceof Error ? err.message : "Unable to reset password");
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
            Your admin password has been updated. You can now sign in using your new password.
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
  const errorFor = (field: "password" | "confirmPassword") => (invalidField === field ? alertId : undefined);

  return (
    <form onSubmit={submit} noValidate>
      <h2>Create a new password</h2>
      <p className="muted recovery-copy">Choose a strong password for the admin account.</p>
      <PasswordField
        label="New password"
        toggleName="new password"
        placeholder="Enter new password"
        value={password}
        onChange={edit(setPassword)}
        errorId={errorFor("password")}
      />
      <ul className="recovery-rules" aria-label="Password requirements">
        {passwordRules.map((rule) => {
          const met = rule.test(password);
          return (
            <li key={rule.id} className={met ? "rule-met" : "rule-unmet"} aria-label={`${met ? "Met" : "Not met"}: ${rule.label}`}>
              <span aria-hidden="true">{met ? "✓" : "○"}</span>
              {rule.label}
            </li>
          );
        })}
      </ul>
      <PasswordField
        label="Confirm new password"
        toggleName="confirm password"
        placeholder="Confirm new password"
        value={confirmPassword}
        onChange={edit(setConfirmPassword)}
        errorId={errorFor("confirmPassword")}
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

interface PasswordFieldProps {
  label: string;
  /** Names the show/hide button: "Show {toggleName}". */
  toggleName: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  /** The alert describing this field's error; marks the input invalid while set. */
  errorId?: string;
  /** Rendered under the Caps Lock warning. */
  children?: ReactNode;
}

/** A labelled new-password input with its own show/hide toggle and Caps Lock warning. */
function PasswordField({ label, toggleName, placeholder, value, onChange, errorId, children }: PasswordFieldProps) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const caps = useCapsLock();
  return (
    <div className="field">
      <label className="recovery-label" htmlFor={id}>{label}</label>
      <div className="recovery-password">
        <input
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={caps.onKeyDown}
          onKeyUp={caps.onKeyUp}
          onBlur={caps.onBlur}
          aria-invalid={errorId ? true : undefined}
          aria-describedby={errorId}
          autoComplete="new-password"
          placeholder={placeholder}
        />
        <button type="button" className="recovery-password-toggle" onClick={() => setShown((on) => !on)} aria-pressed={shown} aria-label={`Show ${toggleName}`}>
          <PasswordVisibilityIcon shown={shown} />
        </button>
      </div>
      <CapsLockWarning visible={caps.capsLockOn} />
      {children}
    </div>
  );
}
