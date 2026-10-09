import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../components/UI";
import { AuthError, RateLimitError, services } from "../../services/api";
import type { CodeRequestResult, RecoveryPurpose } from "../../services/recovery";
import { resetSchema } from "../../services/schemas";
import { attemptsLeftText, isUrgentAttempts } from "./attemptsLeft";
import { OtpInput, type OtpInputHandle } from "./OtpInput";
import { BackToLogin } from "./RecoveryFrame";
import { useCountdown } from "./useCountdown";

/** Where the admin is in entering a code. `exhausted` and `expired` mean the code is dead and only a resend helps. */
export type CodeStepState = "entering" | "verifying" | "exhausted" | "expired";

/** The two dead states, which a code step can also open in. */
export type DeadCode = "exhausted" | "expired";

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
  /** Goes back to the email step, keeping the address for editing. */
  onChangeEmail: () => void;
  /** Open already dead, for an admin sent back because a later step found the code used up or expired. */
  dead?: DeadCode;
}

const CODE_INCOMPLETE = "Enter the 6-digit verification code.";
const EXHAUSTED_MESSAGE = "You have used all your attempts. Request a new code to continue.";
const EXPIRED_MESSAGE = "This code has expired. Request a new code to continue.";

const deadMessage = (dead: DeadCode) => (dead === "exhausted" ? EXHAUSTED_MESSAGE : EXPIRED_MESSAGE);

const formatRemaining = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** Collects the 6-digit code, submits it once when complete, and offers a manual Verify and Resend. */
export function RecoveryCodeStep({ email, purpose, issued, onVerified, onChangeEmail, dead: initialDead }: RecoveryCodeStepProps) {
  const sentId = useId();
  const [state, setState] = useState<CodeStepState>(initialDead ?? "entering");
  const [code, setCode] = useState("");
  const [error, setError] = useState(initialDead ? deadMessage(initialDead) : "");
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | undefined>();
  const [resendMessage, setResendMessage] = useState("");
  const [resending, setResending] = useState(false);
  const otp = useRef<OtpInputHandle>(null);
  const inFlight = useRef(false);
  // Codes the server rejected for the code currently issued. Auto-submit skips them; the Verify button is an explicit retry.
  const rejected = useRef(new Set<string>());
  const verifyWait = useCountdown();
  const resendWait = useCountdown(issued.resendAfterSeconds ?? 0);
  // The expiry timer only exists when the server reported a lifetime; `timed` tells "no timer" from "ran out".
  const [timed, setTimed] = useState(issued.expiresInSeconds !== undefined);
  const expiry = useCountdown(issued.expiresInSeconds ?? 0);

  // The code is dead: stop accepting digits and leave Resend as the way forward.
  const retire = (dead: DeadCode) => {
    otp.current?.clear();
    setState(dead);
    setError(deadMessage(dead));
  };

  useEffect(() => {
    if (timed && expiry.seconds <= 0 && state === "entering") retire("expired");
    // A verification in flight is left to the server: its answer moves the state, then this runs again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, expiry.seconds, state]);

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
      if (err instanceof AuthError && (err.kind === "code_exhausted" || err.kind === "code_expired")) {
        expiry.start(0);
        retire(err.kind === "code_exhausted" ? "exhausted" : "expired");
        return;
      }
      setState("entering");
      if (err instanceof RateLimitError) {
        // Not a wrong code: keep what was typed and let the button count down.
        setError(err.message);
        verifyWait.start(err.retryAfterSeconds);
      } else {
        otp.current?.clear();
        if (err instanceof AuthError && err.kind === "invalid_code") rejected.current.add(parsed.data);
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
      rejected.current.clear();
      // Expiry may have retired the code while this request was pending; the new code supersedes that.
      setError("");
      setState("entering");
      setTimed(next.expiresInSeconds !== undefined);
      expiry.start(next.expiresInSeconds ?? 0);
      setResendMessage("A new code has been sent.");
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
  const dead = state === "exhausted" || state === "expired";
  const urgent = state === "exhausted" || (attemptsRemaining !== undefined && isUrgentAttempts(attemptsRemaining));
  const resendLabel = resendWait.seconds > 0 ? `Resend code in ${resendWait.seconds}s` : "Resend code";
  const resendBlocked = resendWait.seconds > 0 || resending || verifying;

  return (
    <>
      {/* The heading takes focus on arrival, so its description carries the code-sent confirmation to screen readers. */}
      <h2 aria-describedby={sentId}>Enter verification code</h2>
      <p className="muted recovery-copy">
        <span id={sentId}>
          If an account exists for <strong>{email}</strong>, we sent a 6-digit verification code to it.
        </span>{" "}
        <button type="button" className="recovery-link" onClick={onChangeEmail} disabled={verifying || resending}>
          Change email
        </button>
      </p>
      <div className="field">
        <span className="recovery-label">VERIFICATION CODE</span>
        <OtpInput ref={otp} disabled={verifying || dead} onChange={setCode} onComplete={(complete) => {
            if (!rejected.current.has(complete)) void verify(complete);
          }} />
        {timed && !dead && expiry.seconds > 0 && (
          <small className="recovery-timer" role="timer">
            Code expires in {formatRemaining(expiry.seconds)}
          </small>
        )}
        {!dead && (
          <small className="recovery-resend">
            <span>Didn't receive code?</span>
            <Button type="button" variant="subtle" pill={false} onClick={() => void resend()} loading={resending} disabled={resendBlocked}>
              {resendLabel}
            </Button>
          </small>
        )}
        <div className="recovery-confirmation" role="status">
          {resendMessage}
        </div>
      </div>
      {error && (
        <div className={urgent ? "error error-urgent" : "error"} role="alert">
          {error}
        </div>
      )}
      {dead ? (
        <Button type="button" className="recovery-primary recovery-submit" onClick={() => void resend()} loading={resending} disabled={resendBlocked}>
          {resending ? "Sending…" : resendLabel}
        </Button>
      ) : (
        <Button
          type="button"
          className="recovery-primary recovery-submit"
          onClick={() => void verify(code)}
          loading={verifying}
          disabled={verifyWait.seconds > 0}
        >
          {verifying ? "Verifying…" : verifyWait.seconds > 0 ? `Verify in ${verifyWait.seconds}s` : "Verify"}
        </Button>
      )}
      <BackToLogin />
    </>
  );
}
