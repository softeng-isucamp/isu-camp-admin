import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import { Button } from "../../components/UI";
import { RateLimitError, services } from "../../services/api";
import type { CodeRequestResult, RecoveryPurpose } from "../../services/recovery";
import { recoveryEmailSchema } from "../../services/schemas";
import { AuthAlert, RATE_LIMIT_MESSAGE, tryAgainLabel } from "./AuthAlert";
import { BackToLogin } from "./RecoveryFrame";
import { useCountdown } from "./useCountdown";

interface RecoveryEmailStepProps {
  purpose: RecoveryPurpose;
  title: string;
  description: ReactNode;
  /** Pre-fills the field, e.g. when the admin comes back to correct the address. */
  initialEmail?: string;
  onSent: (email: string, issued: CodeRequestResult) => void;
}

/** Asks for the admin's email and requests a code. It never says whether the email has an account. */
export function RecoveryEmailStep({ purpose, title, description, initialEmail = "", onSent }: RecoveryEmailStepProps) {
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState("");
  // The address failed the client-side check: the field is marked invalid until edited.
  const [invalid, setInvalid] = useState(false);
  const alertId = useId();
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const wait = useCountdown();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || wait.seconds > 0) return;
    setError("");
    setInvalid(false);
    const parsed = recoveryEmailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid email address.");
      setInvalid(true);
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    try {
      onSent(parsed.data, await services.auth.requestRecovery(parsed.data, purpose));
    } catch (err) {
      if (err instanceof RateLimitError) {
        setError(RATE_LIMIT_MESSAGE);
        wait.start(err.retryAfterSeconds);
      } else {
        setError(err instanceof Error ? err.message : "Unable to send the verification code.");
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <h2>{title}</h2>
      <p className="muted recovery-copy">{description}</p>
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
      <BackToLogin />
    </form>
  );
}
