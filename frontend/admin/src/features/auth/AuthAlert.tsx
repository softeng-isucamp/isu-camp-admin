import type { ReactNode } from "react";

/** Shown for every server rate limit. It names no number: the button that is locked counts down the live wait. */
export const RATE_LIMIT_MESSAGE = "Too many attempts. Try again when the button unlocks.";

/** Shown on the recovery screens. The button counts down only when the server said how long to wait. */
export const RECOVERY_RATE_LIMIT_MESSAGE = "Too many attempts. Please try again when the restriction ends.";

/** The label of a button locked by a rate limit. */
export const tryAgainLabel = (seconds: number) => `Try again in ${seconds}s`;

/** At or below this many attempts the "attempts left" message turns urgent. */
const URGENT_ATTEMPTS_THRESHOLD = 2;

const isUrgentAttempts = (attemptsRemaining: number) => attemptsRemaining <= URGENT_ATTEMPTS_THRESHOLD;

/** How the count is worded: "4 attempts left." on sign-in, "You have 4 attempts remaining." on the recovery screens. */
export type AttemptsWording = "left" | "remaining";

const attemptsText = (attemptsRemaining: number, wording: AttemptsWording) => {
  const noun = `attempt${attemptsRemaining === 1 ? "" : "s"}`;
  if (wording === "remaining") return attemptsRemaining <= 0 ? "No attempts remaining." : `You have ${attemptsRemaining} ${noun} remaining.`;
  return attemptsRemaining <= 0 ? "No attempts left." : `${attemptsRemaining} ${noun} left.`;
};

interface AuthAlertProps {
  /** The error sentence, e.g. "Incorrect code." */
  children: ReactNode;
  /** Appends "N attempts left."; at the urgent threshold the count turns bold and a warning icon shows. */
  attemptsRemaining?: number;
  /** The sentence the count is appended in; sign-in keeps "left". */
  attemptsWording?: AttemptsWording;
  /** Forces the urgent emphasis without a count, e.g. once every attempt is used up. */
  urgent?: boolean;
  /** Lets the field the error is about point at it with `aria-describedby`. */
  id?: string;
}

/** The one error box for login and every recovery step. Urgency adds emphasis, never a different box. */
export function AuthAlert({ children, attemptsRemaining, attemptsWording = "left", urgent = false, id }: AuthAlertProps) {
  const urgentCount = attemptsRemaining !== undefined && isUrgentAttempts(attemptsRemaining);
  const emphasised = urgent || urgentCount;
  return (
    <div className="auth-alert" role="alert" id={id}>
      {emphasised && (
        <svg className="auth-alert-icon" role="img" aria-label="Warning" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      )}
      <span>
        {children}
        {attemptsRemaining !== undefined && (
          <>
            {" "}
            {urgentCount ? <strong>{attemptsText(attemptsRemaining, attemptsWording)}</strong> : attemptsText(attemptsRemaining, attemptsWording)}
          </>
        )}
      </span>
    </div>
  );
}
