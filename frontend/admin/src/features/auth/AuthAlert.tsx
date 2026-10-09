import type { ReactNode } from "react";
import { attemptsLeftText, isUrgentAttempts } from "./attemptsLeft";

interface AuthAlertProps {
  /** The error sentence, e.g. "Incorrect code." */
  children: ReactNode;
  /** Appends "N attempts left."; at the urgent threshold the count turns bold and a warning icon shows. */
  attemptsRemaining?: number;
  /** Forces the urgent emphasis without a count, e.g. once every attempt is used up. */
  urgent?: boolean;
}

/** The one error box for login and every recovery step. Urgency adds emphasis, never a different box. */
export function AuthAlert({ children, attemptsRemaining, urgent = false }: AuthAlertProps) {
  const urgentCount = attemptsRemaining !== undefined && isUrgentAttempts(attemptsRemaining);
  const emphasised = urgent || urgentCount;
  return (
    <div className="auth-alert" role="alert">
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
            {urgentCount ? <strong>{attemptsLeftText(attemptsRemaining)}</strong> : attemptsLeftText(attemptsRemaining)}
          </>
        )}
      </span>
    </div>
  );
}
