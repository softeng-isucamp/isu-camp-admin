import { type FormEvent, useRef, useState } from "react";
import { Button } from "../../components/UI";
import { RateLimitError, services } from "../../services/api";
import type { CodeRequestResult, RecoveryPurpose } from "../../services/recovery";
import { recoveryEmailSchema } from "../../services/schemas";
import { BackToLogin } from "./RecoveryFrame";
import { useCountdown } from "./useCountdown";

interface RecoveryEmailStepProps {
  purpose: RecoveryPurpose;
  title: string;
  description: string;
  /** Pre-fills the field, e.g. when the admin comes back to correct the address. */
  initialEmail?: string;
  onSent: (email: string, issued: CodeRequestResult) => void;
}

/** Asks for the admin's email and requests a code. It never says whether the email has an account. */
export function RecoveryEmailStep({ purpose, title, description, initialEmail = "", onSent }: RecoveryEmailStepProps) {
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const wait = useCountdown();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || wait.seconds > 0) return;
    setError("");
    const parsed = recoveryEmailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid email address.");
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    try {
      onSent(parsed.data, await services.auth.requestRecovery(parsed.data, purpose));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send the verification code.");
      if (err instanceof RateLimitError) wait.start(err.retryAfterSeconds);
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
        <span className="recovery-label">ADMIN EMAIL</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          placeholder="name@isu.edu.ph"
        />
      </label>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <Button type="submit" className="recovery-primary recovery-submit" loading={submitting} disabled={wait.seconds > 0}>
        {submitting ? "Working…" : wait.seconds > 0 ? `Send code in ${wait.seconds}s` : "Send Code →"}
      </Button>
      <BackToLogin />
    </form>
  );
}
