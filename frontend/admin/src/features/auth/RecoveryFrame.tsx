import type { PropsWithChildren } from "react";
import { Link } from "react-router-dom";
import { Card } from "../../components/UI";

/** Where the admin is in a recovery flow: the labels of every step, and the index of the current one. */
export interface RecoveryProgress {
  steps: string[];
  current: number;
}

/** A compact step cue, e.g. Email, Code, New password. The current step carries aria-current="step". */
function RecoveryProgressCue({ steps, current }: RecoveryProgress) {
  return (
    <ol className="recovery-progress" aria-label="Recovery progress">
      {steps.map((label, index) => (
        <li
          key={label}
          className={index < current ? "is-done" : index === current ? "is-current" : undefined}
          aria-current={index === current ? "step" : undefined}
        >
          <span className="recovery-progress-dot" aria-hidden="true">{index < current ? "✓" : index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

/** The recovery card on the branded background. Every recovery step renders inside it. */
export function RecoveryFrame({ children, progress }: PropsWithChildren<{ progress?: RecoveryProgress }>) {
  return (
    <div className="auth-page">
      <div className="ambient" />
      <Card className="recovery-modal">
        {progress && <RecoveryProgressCue {...progress} />}
        {children}
      </Card>
    </div>
  );
}

/** The check mark that heads both final screens. */
export function SuccessIcon() {
  return (
    <div className="recovery-success-icon">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
  );
}

/** The exit every recovery step offers; use it as the last child of a step. */
export function BackToLogin() {
  return (
    <Link className="back-link" to="/login">
      Back to login
    </Link>
  );
}
