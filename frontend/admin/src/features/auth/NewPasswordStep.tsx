import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button } from "../../components/UI";
import eyeIcon from "../../assets/figma/login/login-icon-2.svg";
import { AuthError, RateLimitError, services } from "../../services/api";
import { passwordRules } from "../../services/passwordRules";
import { resetPasswordSchema } from "../../services/schemas";
import { CapsLockWarning, useCapsLock } from "./capsLock";
import { useReturnToLogin } from "./loginPrefill";
import type { DeadCode } from "./RecoveryCodeStep";
import type { VerifiedRecovery } from "./RecoveryFlow";
import { BackToLogin } from "./RecoveryFrame";
import { useCountdown } from "./useCountdown";

/** The last step of `/forgot-password`: choose a new password, then see the success screen. */
export function NewPasswordStep({ verified, onCodeDied }: { verified: VerifiedRecovery; onCodeDied: (kind: DeadCode) => void }) {
  const returnToLogin = useReturnToLogin();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
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
    const parsed = resetPasswordSchema.safeParse({ code: verified.code, password, confirmPassword });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your new password.");
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
      setError(err instanceof Error ? err.message : "Unable to reset password");
      if (err instanceof RateLimitError) wait.start(err.retryAfterSeconds);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  if (username !== null) {
    return (
      <>
        <div className="recovery-success-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 ref={successHeading} tabIndex={-1}>Password reset successful</h2>
        <p className="muted recovery-copy">
          Your admin password has been updated. You can now sign in using your new password.
        </p>
        <div className="recovery-spacer" />
        <Button className="recovery-primary" onClick={() => returnToLogin(username)}>
          Return to login
        </Button>
      </>
    );
  }

  const matchState = !confirmPassword ? "idle" : confirmPassword === password ? "match" : "mismatch";

  return (
    <form onSubmit={submit} noValidate>
      <h2>Create a new password</h2>
      <p className="muted recovery-copy">Choose a strong password for the admin account.</p>
      <PasswordField
        label="NEW PASSWORD"
        toggleName="new password"
        placeholder="Enter new password"
        value={password}
        onChange={setPassword}
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
        label="CONFIRM NEW PASSWORD"
        toggleName="confirm password"
        placeholder="Confirm new password"
        value={confirmPassword}
        onChange={setConfirmPassword}
      >
        <p className={`recovery-match recovery-match-${matchState}`} role="status">
          {matchState === "match" && "✓ Passwords match"}
          {matchState === "mismatch" && "✗ Passwords do not match"}
        </p>
      </PasswordField>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <Button type="submit" className="recovery-primary recovery-submit" loading={submitting} disabled={wait.seconds > 0}>
        {submitting ? "Working…" : wait.seconds > 0 ? `Reset Password in ${wait.seconds}s` : "Reset Password"}
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
  /** Rendered under the Caps Lock warning. */
  children?: ReactNode;
}

/** A labelled new-password input with its own show/hide toggle and Caps Lock warning. */
function PasswordField({ label, toggleName, placeholder, value, onChange, children }: PasswordFieldProps) {
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
          autoComplete="new-password"
          placeholder={placeholder}
        />
        <button type="button" className="recovery-password-toggle" onClick={() => setShown((on) => !on)} aria-pressed={shown} aria-label={`Show ${toggleName}`}>
          <img src={eyeIcon} alt="" />
        </button>
      </div>
      <CapsLockWarning visible={caps.capsLockOn} />
      {children}
    </div>
  );
}
