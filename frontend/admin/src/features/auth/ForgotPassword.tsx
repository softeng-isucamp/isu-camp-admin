import { NewPasswordStep } from "./NewPasswordStep";
import { RecoveryFlow } from "./RecoveryFlow";

/** `/forgot-password`: verify a code sent to the admin's email, then choose a new password. */
export function ForgotPassword() {
  return (
    <RecoveryFlow
      purpose="password"
      title="Reset your password"
      renderFinal={(verified, controls) => <NewPasswordStep verified={verified} onCodeDied={controls.codeDied} />}
    />
  );
}
