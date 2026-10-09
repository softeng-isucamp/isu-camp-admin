import { useRef, useState } from "react";
import { Button } from "../../components/UI";
import { AuthError, RateLimitError, services } from "../../services/api";
import type { CodeRequestResult, RecoveryPurpose } from "../../services/recovery";
import { resetSchema } from "../../services/schemas";
import { attemptsLeftText, isUrgentAttempts } from "./attemptsLeft";
import { OtpInput, type OtpInputHandle } from "./OtpInput";
import { BackToLogin } from "./RecoveryFrame";
import { useCountdown } from "./useCountdown";

/** Where the admin is in entering a code. Exhausted and expired codes are added alongside these. */
export type CodeStepState = "entering" | "verifying";

export interface VerifiedCode {
  code: string;
  username: string;
}

interface RecoveryCodeStepProps {
  email: string;
  purpose: RecoveryPurpose;
  /** What the request that led here reported; absent fields mean the backend sent none. */
  issued: CodeRequestResult;
  onVerified: (verified: VerifiedCode) => void;
}

const CODE_INCOMPLETE = "Enter the 6-digit verification code.";

/** Collects the 6-digit code, submits it once when complete, and offers a manual Verify and Resend. */
export function RecoveryCodeStep({ email, purpose, issued, onVerified }: RecoveryCodeStepProps) {
  const [state, setState] = useState<CodeStepState>("entering");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | undefined>();
  const [resendMessage, setResendMessage] = useState("");
  const [resending, setResending] = useState(false);
  const otp = useRef<OtpInputHandle>(null);
  const inFlight = useRef(false);
  const verifyWait = useCountdown();
  const resendWait = useCountdown(issued.resendAfterSeconds ?? 0);

  const verify = async (candidate: string) => {
    if (inFlight.current || verifyWait.seconds > 0) return;
    const parsed = resetSchema.shape.code.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? CODE_INCOMPLETE);
      return;
    }
    inFlight.current = true;
    setError("");
    setAttemptsRemaining(undefined);
    setResendMessage("");
    setState("verifying");
    try {
      const { username } = await services.auth.verifyRecovery(email, purpose, parsed.data);
      onVerified({ code: parsed.data, username });
    } catch (err) {
      setState("entering");
      if (err instanceof RateLimitError) {
        // Not a wrong code: keep what was typed and let the button count down.
        setError(err.message);
        verifyWait.start(err.retryAfterSeconds);
      } else {
        otp.current?.clear();
        if (err instanceof AuthError && err.kind === "invalid_code" && err.attemptsRemaining !== undefined) {
          setError(`Incorrect code. ${attemptsLeftText(err.attemptsRemaining)}`);
          setAttemptsRemaining(err.attemptsRemaining);
        } else {
          setError(err instanceof Error ? err.message : "Unable to verify the code.");
        }
      }
    } finally {
      inFlight.current = false;
    }
  };

  const resend = async () => {
    if (inFlight.current || resendWait.seconds > 0) return;
    inFlight.current = true;
    setResending(true);
    setError("");
    setAttemptsRemaining(undefined);
    setResendMessage("");
    try {
      const next = await services.auth.requestRecovery(email, purpose);
      otp.current?.clear();
      setResendMessage("A new 6-digit verification code has been sent.");
      resendWait.start(next.resendAfterSeconds ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend code.");
      if (err instanceof RateLimitError) resendWait.start(err.retryAfterSeconds);
    } finally {
      inFlight.current = false;
      setResending(false);
    }
  };

  const verifying = state === "verifying";
  const urgent = attemptsRemaining !== undefined && isUrgentAttempts(attemptsRemaining);

  return (
    <>
      <h2>Enter verification code</h2>
      <p className="muted recovery-copy">
        If an account exists for <strong>{email}</strong>, we sent a 6-digit verification code to it.
      </p>
      <div className="field">
        <span className="recovery-label">VERIFICATION CODE</span>
        <OtpInput ref={otp} disabled={verifying} onChange={setCode} onComplete={(complete) => void verify(complete)} />
        <small className="recovery-resend">
          <span>Didn't receive code?</span>
          <button type="button" onClick={() => void resend()} disabled={resendWait.seconds > 0 || resending || verifying}>
            {resendWait.seconds > 0 ? `Resend code in ${resendWait.seconds}s` : "Resend code"}
          </button>
        </small>
        {resendMessage && <div className="recovery-confirmation">{resendMessage}</div>}
      </div>
      {error && (
        <div className={urgent ? "error error-urgent" : "error"} role="alert">
          {error}
        </div>
      )}
      <Button
        type="button"
        className="recovery-primary recovery-submit"
        onClick={() => void verify(code)}
        loading={verifying}
        disabled={verifyWait.seconds > 0}
      >
        {verifying ? "Verifying…" : verifyWait.seconds > 0 ? `Verify in ${verifyWait.seconds}s` : "Verify"}
      </Button>
      <BackToLogin />
    </>
  );
}
