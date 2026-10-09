import { type FormEvent, useRef, useState } from "react";
import { Button } from "../../components/UI";
import { RateLimitError, services } from "../../services/api";
import { resetPasswordSchema } from "../../services/schemas";
import { useReturnToLogin } from "./loginPrefill";
import { RecoveryFlow, type VerifiedRecovery } from "./RecoveryFlow";
import { BackToLogin } from "./RecoveryFrame";
import { useCountdown } from "./useCountdown";

/** `/forgot-password`: verify a code sent to the admin's email, then choose a new password. */
export function ForgotPassword() {
  return (
    <RecoveryFlow
      purpose="password"
      title="Reset your password"
      description="Enter your admin email to receive a six-digit code."
      renderFinal={(verified) => <NewPasswordStep verified={verified} />}
    />
  );
}

function NewPasswordStep({ verified }: { verified: VerifiedRecovery }) {
  const returnToLogin = useReturnToLogin();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const inFlight = useRef(false);
  const wait = useCountdown();

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
        <h2>Password reset successful</h2>
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

  return (
    <form onSubmit={submit} noValidate>
      <h2>Create a new password</h2>
      <p className="muted recovery-copy">Choose a strong password for the admin account.</p>
      <label className="field">
        <span className="recovery-label">NEW PASSWORD</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          placeholder="Enter new password"
        />
      </label>
      <label className="field">
        <span className="recovery-label">CONFIRM NEW PASSWORD</span>
        <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          autoComplete="new-password"
          placeholder="Confirm new password"
        />
      </label>
      <div className="recovery-hint">
        Use a strong password with at least one uppercase letter, one lowercase letter, one number, and one symbol.
      </div>
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
