import { type ReactNode, useEffect, useRef, useState } from "react";
import type { CodeRequestResult, RecoveryPurpose } from "../../services/recovery";
import { RecoveryCodeStep } from "./RecoveryCodeStep";
import { RecoveryEmailStep } from "./RecoveryEmailStep";
import { RecoveryFrame } from "./RecoveryFrame";

/** What the code step hands to the purpose-specific final step. */
export interface VerifiedRecovery {
  email: string;
  code: string;
  username: string;
}

interface RecoveryFlowProps {
  purpose: RecoveryPurpose;
  /** Heading and copy of the email step. */
  title: string;
  description: string;
  /**
   * The purpose-specific step shown once the code is verified. It renders inside
   * the recovery card and owns its own heading, actions and "Back to login".
   */
  renderFinal: (verified: VerifiedRecovery) => ReactNode;
}

type FlowStep =
  | { step: "email"; email: string }
  | { step: "code"; email: string; issued: CodeRequestResult }
  | { step: "final"; verified: VerifiedRecovery };

/**
 * The recovery modal shared by forgot password and forgot username: email step,
 * then code step, then `renderFinal`. All of it lives in memory, so a refresh
 * restarts the flow.
 */
export function RecoveryFlow({ purpose, title, description, renderFinal }: RecoveryFlowProps) {
  const [flow, setFlow] = useState<FlowStep>({ step: "email", email: "" });
  const content = useRef<HTMLDivElement>(null);
  const shownStep = useRef(flow.step);

  // A new step replaces the old one under the keyboard or screen reader, so move focus to its heading.
  useEffect(() => {
    if (shownStep.current === flow.step) return;
    shownStep.current = flow.step;
    const heading = content.current?.querySelector("h2");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus();
  }, [flow.step]);

  return (
    <RecoveryFrame>
      <div ref={content}>
        {flow.step === "email" && (
          <RecoveryEmailStep
            purpose={purpose}
            title={title}
            description={description}
            initialEmail={flow.email}
            onSent={(email, issued) => setFlow({ step: "code", email, issued })}
          />
        )}
        {flow.step === "code" && (
          <RecoveryCodeStep
            email={flow.email}
            purpose={purpose}
            issued={flow.issued}
            onVerified={(verified) => setFlow({ step: "final", verified: { email: flow.email, ...verified } })}
            onChangeEmail={() => setFlow({ step: "email", email: flow.email })}
          />
        )}
        {flow.step === "final" && renderFinal(flow.verified)}
      </div>
    </RecoveryFrame>
  );
}
