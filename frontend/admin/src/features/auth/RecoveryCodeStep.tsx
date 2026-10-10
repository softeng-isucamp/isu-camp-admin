import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../components/UI";
import { AuthError, RateLimitError, services } from "../../services/api";
import type { CodeRequestResult, RecoveryPurpose } from "../../services/recovery";
import { resetSchema } from "../../services/schemas";
import { AuthAlert, RATE_LIMIT_MESSAGE, tryAgainLabel } from "./AuthAlert";
import { OtpInput, type OtpInputHandle } from "./OtpInput";
import { BackToLogin } from "./RecoveryFrame";
import { useCountdown } from "./useCountdown";

/** Where the admin is in entering a code. `exhausted` and `expired` mean the code is dead and only a resend helps. */
type CodeStepState = "entering" | "verifying" | "exhausted" | "expired";

/** The two dead states, which a code step can also open in. */
export type DeadCode = "exhausted" | "expired";

interface VerifiedCode {
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

/** "The code expires in 10 minutes.", rounded to whole minutes and never below one. */
const expiryText = (seconds: number) => {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `The code expires in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
};

/** Collects the 6-digit code, submits it when an entry completes it, and offers a manual Verify (or Enter) and Resend. */
export function RecoveryCodeStep({ email, purpose, issued, onVerified, onChangeEmail, dead: initialDead }: RecoveryCodeStepProps) {
  const sentId = useId();
  const alertId = useId();
  const [state, setState] = useState<CodeStepState>(initialDead ?? "entering");
  const [code, setCode] = useState("");
  const [error, setError] = useState(initialDead ? deadMessage(initialDead) : "");
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | undefined>();
  const [resendMessage, setResendMessage] = useState("");
  const [resending, setResending] = useState(false);
  // The resend wait came from a rate limit rather than the normal cooldown, so its button reads "Try again".
  const [resendLimited, setResendLimited] = useState(false);
  const otp = useRef<OtpInputHandle>(null);
  const inFlight = useRef(false);
  // The issued code can no longer be accepted. Set the moment that is known, ahead of any render, so no timer's callback can still send it.
  const unusable = useRef(initialDead !== undefined);
  const verifyWait = useCountdown();
  const resendWait = useCountdown(issued.resendAfterSeconds ?? 0);
  // The code currently issued; a resend replaces it. Its lifetime is stated in the copy and tracked silently.
  const [current, setCurrent] = useState(issued);
  const [lapsed, setLapsed] = useState(false);

  // The code is dead: stop accepting digits and leave Resend as the way forward.
  const retire = (dead: DeadCode) => {
    unusable.current = true;
    otp.current?.clear();
    setState(dead);
    setError(deadMessage(dead));
    setAttemptsRemaining(undefined);
    setResendMessage("");
  };

  useEffect(() => {
    if (current.expiresInSeconds === undefined) return;
    const timer = setTimeout(() => {
      unusable.current = true;
      setLapsed(true);
    }, current.expiresInSeconds * 1000);
    return () => clearTimeout(timer);
  }, [current]);

  useEffect(() => {
    if (lapsed && state === "entering") retire("expired");
    // A verification in flight is left to the server: its answer moves the state, then this runs again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lapsed, state]);

  const verify = async (candidate: string) => {
    if (inFlight.current || unusable.current || verifyWait.seconds > 0) return;
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
      if (err instanceof AuthError && err.kind === "code_expired") {
        retire("expired");
        return;
      }
      // A wrong code that used the last attempt is as dead as one the server calls exhausted.
      if (err instanceof AuthError && (err.kind === "code_exhausted" || (err.kind === "invalid_code" && err.attemptsRemaining === 0))) {
        retire("exhausted");
        return;
      }
      setState("entering");
      if (err instanceof RateLimitError) {
        // Not a wrong code: keep what was typed and let the button count down.
        setError(RATE_LIMIT_MESSAGE);
        verifyWait.start(err.retryAfterSeconds);
      } else {
        if (err instanceof AuthError && err.kind === "invalid_code") {
          // The digits stay as editable values, marked invalid, so the admin can fix one or retype them.
          otp.current?.markRejected();
        } else {
          otp.current?.clear();
        }
        if (err instanceof AuthError && err.kind === "invalid_code" && err.attemptsRemaining !== undefined) {
          setError("Incorrect code.");
          setAttemptsRemaining(err.attemptsRemaining);
        } else {
          setError(err instanceof Error ? err.message : "Unable to verify the code.");
        }
      }
    } finally {
      inFlight.current = false;
    }
  };

  // A complete code held in the boxes while a rate-limit wait runs is sent once when the wait ends. That is the code which was rate
  // limited, one entered during the wait, or a rejected code the admin explicitly sent again with Verify and got a 429 for. A rejected
  // code that was only left on screen is never sent: the wait only starts from a verify, and nothing but a verify starts one.
  const waited = useRef(false);
  useEffect(() => {
    if (verifyWait.seconds > 0) {
      waited.current = true;
      return;
    }
    if (!waited.current) return;
    waited.current = false;
    if (state === "entering" && code.length === 6) void verify(code);
    // Only the end of the wait matters; later renders must never resend.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyWait.seconds]);

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
      unusable.current = false;
      // Expiry may have retired the code while this request was pending; the new code supersedes that.
      setError("");
      setState("entering");
      setLapsed(false);
      setCurrent(next);
      setResendMessage("A new code has been sent.");
      setResendLimited(false);
      resendWait.start(next.resendAfterSeconds ?? 0);
    } catch (err) {
      if (err instanceof RateLimitError) {
        setError(RATE_LIMIT_MESSAGE);
        setResendLimited(true);
        resendWait.start(err.retryAfterSeconds);
      } else {
        setError(err instanceof Error ? err.message : "Failed to resend code.");
      }
    } finally {
      inFlight.current = false;
      setResending(false);
    }
  };

  const verifying = state === "verifying";
  const dead = state === "exhausted" || state === "expired";
  const rateLimited = verifyWait.seconds > 0 || (resendLimited && resendWait.seconds > 0);
  const resendLabel =
    resendWait.seconds > 0 ? (resendLimited ? tryAgainLabel(resendWait.seconds) : `Resend code in ${resendWait.seconds}s`) : "Resend code";
  const resendBlocked = resendWait.seconds > 0 || resending || verifying;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void verify(code);
      }}
    >
      {/* The heading takes focus on arrival, so its description carries the code-sent confirmation to screen readers. */}
      <h2 aria-describedby={sentId}>Enter verification code</h2>
      <p className="muted recovery-copy">
        <span id={sentId}>
          If an account exists for <strong>{email}</strong>, we sent a <span className="nowrap">6-digit</span> code to it.
          {current.expiresInSeconds !== undefined && !dead && ` ${expiryText(current.expiresInSeconds)}`}
        </span>{" "}
        <button type="button" className="recovery-link" onClick={onChangeEmail} disabled={verifying || resending}>
          Change email
        </button>
      </p>
      <div className="field">
        <span className="recovery-label">Verification code</span>
        <OtpInput
          ref={otp}
          disabled={verifying || dead}
          describedBy={error ? alertId : undefined}
          onChange={(next) => {
            setCode(next);
            // Typing answers "enter the code"; a rejected code's message stays until the next attempt.
            setError((current) => (current === CODE_INCOMPLETE ? "" : current));
          }}
          onComplete={(complete) => void verify(complete)} />
        {!dead && (
          <p className="recovery-resend">
            <span>Didn't receive the code?</span>
            <Button type="button" variant="subtle" pill={false} onClick={() => void resend()} loading={resending} disabled={resendBlocked}>
              {resendLabel}
            </Button>
          </p>
        )}
        <p className="recovery-status" role="status">
          {resendMessage}
        </p>
      </div>
      {error && (
        <AuthAlert id={alertId} attemptsRemaining={attemptsRemaining} urgent={state === "exhausted" || rateLimited}>
          {error}
        </AuthAlert>
      )}
      {dead ? (
        <Button type="button" className="recovery-primary recovery-submit" onClick={() => void resend()} loading={resending} disabled={resendBlocked}>
          {resending ? "Sending…" : resendLabel}
        </Button>
      ) : (
        <Button
          type="submit"
          className="recovery-primary recovery-submit"
          loading={verifying}
          disabled={verifyWait.seconds > 0}
        >
          {verifying ? "Verifying…" : verifyWait.seconds > 0 ? tryAgainLabel(verifyWait.seconds) : "Verify"}
        </Button>
      )}
      <BackToLogin />
    </form>
  );
}
