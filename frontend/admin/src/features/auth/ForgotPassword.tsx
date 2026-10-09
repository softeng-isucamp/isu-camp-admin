import { NewPasswordStep } from "./NewPasswordStep";
import { EMAIL_STEP_COPY, RecoveryFlow } from "./RecoveryFlow";

/** `/forgot-password`: verify a code sent to the admin's email, then choose a new password. */
export function ForgotPassword() {
  return (
    <RecoveryFlow
      purpose="password"
      title="Reset your password"
      description={EMAIL_STEP_COPY}
      renderFinal={(verified, controls) => <NewPasswordStep verified={verified} onCodeDied={controls.codeDied} />}
    />
  );
}
