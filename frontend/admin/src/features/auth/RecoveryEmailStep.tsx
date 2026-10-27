import { type FormEvent, useId, useRef, useState } from "react";
import { Button } from "../../components/UI";
import { AuthError, RateLimitError, services } from "../../services/api";
import type { CodeRequestResult, RecoveryPurpose } from "../../services/recovery";
import { errorMessage } from "../../services/errors";
import { recoveryEmailSchema } from "../../services/schemas";
import { AuthAlert, recoveryRateLimitMessage, tryAgainLabel } from "./AuthAlert";
import { BackToLogin } from "./RecoveryFrame";
import { useCountdown } from "./useCountdown";

interface RecoveryEmailStepProps {
  purpose: RecoveryPurpose;
  title: string;
  /** Pre-fills the field, e.g. when the admin comes back to correct the address. */
  initialEmail?: string;
  onSent: (email: string, issued: CodeRequestResult) => void;
  /**
   * Goes to code entry for a code already in the inbox, without requesting one. Requesting would replace that code
   * and spend one of the account's few requests, which is how a code another administrator sent from User Management
   * used to become unusable.
   */
  onHaveCode: (email: string) => void;
}

/** Asks for the admin's email and requests a code, or goes straight to entering one already received. */
export function RecoveryEmailStep({ purpose, title, initialEmail = "", onSent, onHaveCode }: RecoveryEmailStepProps) {
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState("");
  // The address failed the client-side check: the field is marked invalid until edited.
  const [invalid, setInvalid] = useState(false);
  const alertId = useId();
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const wait = useCountdown();

  /** The address when it passes the client-side check; otherwise marks the field and returns undefined. */
  const checkedEmail = (): string | undefined => {
    setError("");
    setInvalid(false);
    const parsed = recoveryEmailSchema.safeParse(email);
    if (parsed.success) return parsed.data;
    setError(parsed.error.issues[0]?.message ?? "Enter a valid email address.");
    setInvalid(true);
    return undefined;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || wait.seconds > 0) return;
    const checked = checkedEmail();
    if (checked === undefined) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      onSent(checked, await services.auth.requestRecovery(checked, purpose));
    } catch (err) {
      if (err instanceof RateLimitError) {
        setError(recoveryRateLimitMessage(err));
        // Without a Retry-After there is nothing to count down, so the button stays usable.
        if (err.retryAfterSeconds !== undefined) wait.start(err.retryAfterSeconds);
      } else {
        setError(errorMessage(err, "We couldn't send the verification code. Please try again."));
        // An address on no account is the field's own problem, like a malformed
        // one: mark it, so the message clears when the address is corrected.
        if (err instanceof AuthError && err.kind === "email_not_found") setInvalid(true);
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <h2>{title}</h2>
      <p className="muted recovery-copy">
        Enter the primary or alternative email associated with your administrator account. We'll send a{" "}
        <span className="nowrap">6-digit</span> verification code to that address. An email that is not on an
        administrator account is refused.
      </p>
      <label className="field">
        <span className="recovery-label">Admin email</span>
        <input
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (invalid) {
              setInvalid(false);
              setError("");
            }
          }}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? alertId : undefined}
          autoComplete="email"
          placeholder="name@isu.edu.ph"
        />
      </label>
      {error && (
        <AuthAlert id={alertId} urgent={wait.seconds > 0}>
          {error}
        </AuthAlert>
      )}
      <Button type="submit" className="recovery-primary recovery-submit" loading={submitting} disabled={wait.seconds > 0}>
        {submitting ? "Sending…" : wait.seconds > 0 ? tryAgainLabel(wait.seconds) : "Send code"}
      </Button>
      {/* Sends nothing, so a rate limit or spent request budget never blocks it. */}
      <p className="muted recovery-copy">
        Already received a code, for example from another administrator?{" "}
        <button
          type="button"
          className="recovery-link"
          disabled={submitting}
          onClick={() => {
            if (inFlight.current) return;
            const checked = checkedEmail();
            if (checked !== undefined) onHaveCode(checked);
          }}
        >
          I already have a code
        </button>
      </p>
      <BackToLogin />
    </form>
  );
}
